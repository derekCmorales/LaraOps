from __future__ import annotations

import logging

import numpy as np

from app.modules.quality_control.models import QualityControlRequest
from app.schemas.common import SolveStatus
from app.schemas.result import GraphXY, ModuleResult, NamedTable, SolutionBlock

logger = logging.getLogger(__name__)

# Constants for n=2..10 approx (A2, D3, D4) for Xbar-R; d2 for sigma estimate
_A2 = {2: 1.880, 3: 1.023, 4: 0.729, 5: 0.577, 6: 0.483, 7: 0.419, 8: 0.373, 9: 0.337, 10: 0.308}
_D3 = {2: 0.0, 3: 0.0, 4: 0.0, 5: 0.0, 6: 0.0, 7: 0.076, 8: 0.136, 9: 0.184, 10: 0.223}
_D4 = {2: 3.267, 3: 2.575, 4: 2.282, 5: 2.115, 6: 2.004, 7: 1.924, 8: 1.864, 9: 1.816, 10: 1.777}
_D2 = {2: 1.128, 3: 1.693, 4: 2.059, 5: 2.326, 6: 2.534, 7: 2.704, 8: 2.847, 9: 2.970, 10: 3.078}


def solve(req: QualityControlRequest) -> ModuleResult:
    if req.chart == "xbar_r":
        return _xbar_r(req)
    if req.chart == "p":
        return _p_chart(req)
    if req.chart == "c":
        return _c_chart(req)
    return _u_chart(req)


def _xbar_r(req: QualityControlRequest) -> ModuleResult:
    if not req.samples:
        raise ValueError("samples required for xbar_r")
    n = len(req.samples[0])
    if n not in _A2:
        raise ValueError("subgroup size n must be between 2 and 10")
    xb = [float(np.mean(s)) for s in req.samples]
    r = [float(np.max(s) - np.min(s)) for s in req.samples]
    xbar_bar = float(np.mean(xb))
    r_bar = float(np.mean(r))
    ucl_x = xbar_bar + _A2[n] * r_bar
    lcl_x = xbar_bar - _A2[n] * r_bar
    ucl_r = _D4[n] * r_bar
    lcl_r = _D3[n] * r_bar
    out = [i for i, v in enumerate(xb) if v > ucl_x or v < lcl_x]
    warnings: list[str] = []
    # Western Electric rule 1 already via OOC; rule 2: 2 of 3 beyond 2-sigma of CL
    # Simple Nelson rule: 7 consecutive on same side of CL
    side = [1 if v > xbar_bar else (-1 if v < xbar_bar else 0) for v in xb]
    run = 1
    for i in range(1, len(side)):
        if side[i] != 0 and side[i] == side[i - 1]:
            run += 1
            if run >= 7:
                warnings.append(
                    f"Regla Western Electric/Nelson: ≥7 puntos consecutivos al mismo lado del CL (desde subgrupo {i - 5})"
                )
                break
        else:
            run = 1

    metrics = {
        "xbar_bar": xbar_bar,
        "R_bar": r_bar,
        "UCL_x": ucl_x,
        "LCL_x": lcl_x,
        "UCL_R": ucl_r,
        "LCL_R": lcl_r,
        "out_of_control": float(len(out)),
        "sigma_hat": float(r_bar / _D2[n]),
    }
    if req.USL is not None and req.LSL is not None:
        sigma = r_bar / _D2[n]
        if sigma > 1e-12:
            cp = (req.USL - req.LSL) / (6.0 * sigma)
            cpu = (req.USL - xbar_bar) / (3.0 * sigma)
            cpl = (xbar_bar - req.LSL) / (3.0 * sigma)
            cpk = min(cpu, cpl)
            metrics.update({"Cp": float(cp), "Cpk": float(cpk), "Cpu": float(cpu), "Cpl": float(cpl)})
            if cpk < 1.0:
                warnings.append(f"Cpk={cpk:.3f} < 1: proceso potencialmente incapaz respecto a USL/LSL")
        else:
            warnings.append("No se calcula Cp/Cpk: sigma estimada ≈ 0")

    xs = list(range(1, len(xb) + 1))
    graph = GraphXY(
        type="xy",
        series=[
            {"name": "xbar", "x": xs, "y": xb},
            {"name": "UCL", "x": xs, "y": [ucl_x] * len(xs)},
            {"name": "CL", "x": xs, "y": [xbar_bar] * len(xs)},
            {"name": "LCL", "x": xs, "y": [lcl_x] * len(xs)},
        ],
        x_label="Subgrupo",
        y_label="Media muestral (X̄)",
        title="Carta de control X̄",
        subtitle=f"LC = {xbar_bar:.4f} · LSC = {ucl_x:.4f} · LIC = {lcl_x:.4f}",
        kind="control",
    )
    return ModuleResult(
        module="quality_control",
        status=SolveStatus.ok,
        solution=SolutionBlock(
            variables={f"xbar_{i+1}": v for i, v in enumerate(xb)},
            metrics=metrics,
        ),
        graph=graph,
        tables=[
            NamedTable(
                name="xbar_r",
                columns=["subgrupo", "xbar", "R", "fuera_de_control"],
                rows=[[i + 1, xb[i], r[i], i in out] for i in range(len(xb))],
            )
        ],
        warnings=warnings,
        iterations=None,
        sensitivity=None,
    )

def _p_chart(req: QualityControlRequest) -> ModuleResult:
    if not req.defectives or not req.sample_sizes:
        raise ValueError("defectives and sample_sizes required for p-chart")
    if len(req.defectives) != len(req.sample_sizes):
        raise ValueError("defectives and sample_sizes length mismatch")
    p = [d / n for d, n in zip(req.defectives, req.sample_sizes, strict=True)]
    pbar = sum(req.defectives) / sum(req.sample_sizes)
    rows = []
    ooc = 0
    ys = []
    ucls = []
    lcls = []
    for i, (pi, n) in enumerate(zip(p, req.sample_sizes, strict=True)):
        sigma = np.sqrt(pbar * (1 - pbar) / n)
        ucl = min(1.0, pbar + 3 * sigma)
        lcl = max(0.0, pbar - 3 * sigma)
        flag = pi > ucl or pi < lcl
        ooc += int(flag)
        rows.append([i + 1, pi, ucl, lcl, flag])
        ys.append(pi)
        ucls.append(ucl)
        lcls.append(lcl)
    xs = list(range(1, len(p) + 1))
    return ModuleResult(
        module="quality_control",
        status=SolveStatus.ok,
        solution=SolutionBlock(
            variables={f"p_{i+1}": v for i, v in enumerate(p)},
            metrics={"p_bar": float(pbar), "out_of_control": float(ooc)},
        ),
        graph=GraphXY(
            type="xy",
            series=[
                {"name": "p", "x": xs, "y": ys},
                {"name": "UCL", "x": xs, "y": ucls},
                {"name": "CL", "x": xs, "y": [pbar] * len(xs)},
                {"name": "LCL", "x": xs, "y": lcls},
            ],
            x_label="Muestra",
            y_label="Proporción defectuosa (p)",
            title="Carta de control p",
            subtitle=f"p̄ = {pbar:.4f} · fuera de control: {ooc}",
            kind="control",
        ),
        tables=[NamedTable(name="p_chart", columns=["muestra", "p", "LSC", "LIC", "fuera_de_control"], rows=rows)],
        warnings=[],
        iterations=None,
        sensitivity=None,
    )


def _c_chart(req: QualityControlRequest) -> ModuleResult:
    if not req.counts:
        raise ValueError("counts required for c-chart")
    cbar = float(np.mean(req.counts))
    ucl = cbar + 3 * np.sqrt(cbar)
    lcl = max(0.0, cbar - 3 * np.sqrt(cbar))
    ooc = sum(1 for c in req.counts if c > ucl or c < lcl)
    xs = list(range(1, len(req.counts) + 1))
    return ModuleResult(
        module="quality_control",
        status=SolveStatus.ok,
        solution=SolutionBlock(
            variables={f"c_{i+1}": float(c) for i, c in enumerate(req.counts)},
            metrics={"c_bar": cbar, "UCL": float(ucl), "LCL": float(lcl), "out_of_control": float(ooc)},
        ),
        graph=GraphXY(
            type="xy",
            series=[
                {"name": "c", "x": xs, "y": [float(c) for c in req.counts]},
                {"name": "UCL", "x": xs, "y": [float(ucl)] * len(xs)},
                {"name": "CL", "x": xs, "y": [cbar] * len(xs)},
                {"name": "LCL", "x": xs, "y": [float(lcl)] * len(xs)},
            ],
            x_label="Muestra",
            y_label="Número de defectos (c)",
            title="Carta de control c",
            subtitle=f"c̄ = {cbar:.4f} · fuera de control: {ooc}",
            kind="control",
        ),
        tables=[
            NamedTable(
                name="c_chart",
                columns=["muestra", "c", "fuera_de_control"],
                rows=[[i + 1, c, c > ucl or c < lcl] for i, c in enumerate(req.counts)],
            )
        ],
        warnings=[],
        iterations=None,
        sensitivity=None,
    )


def _u_chart(req: QualityControlRequest) -> ModuleResult:
    if not req.counts or not req.inspection_units:
        raise ValueError("counts and inspection_units required for u-chart")
    u = [c / n for c, n in zip(req.counts, req.inspection_units, strict=True)]
    ubar = sum(req.counts) / sum(req.inspection_units)
    rows = []
    ooc = 0
    for i, (ui, n) in enumerate(zip(u, req.inspection_units, strict=True)):
        sigma = np.sqrt(ubar / n)
        ucl = ubar + 3 * sigma
        lcl = max(0.0, ubar - 3 * sigma)
        flag = ui > ucl or ui < lcl
        ooc += int(flag)
        rows.append([i + 1, ui, ucl, lcl, flag])
    xs = list(range(1, len(u) + 1))
    return ModuleResult(
        module="quality_control",
        status=SolveStatus.ok,
        solution=SolutionBlock(
            variables={f"u_{i+1}": v for i, v in enumerate(u)},
            metrics={"u_bar": float(ubar), "out_of_control": float(ooc)},
        ),
        graph=GraphXY(
            type="xy",
            series=[
                {"name": "u", "x": xs, "y": u},
                {
                    "name": "UCL",
                    "x": xs,
                    "y": [r[2] for r in rows],
                },
                {"name": "CL", "x": xs, "y": [float(ubar)] * len(xs)},
                {
                    "name": "LCL",
                    "x": xs,
                    "y": [r[3] for r in rows],
                },
            ],
            x_label="Muestra",
            y_label="Defectos por unidad (u)",
            title="Carta de control u",
            subtitle=f"ū = {ubar:.4f} · fuera de control: {ooc}",
            kind="control",
        ),
        tables=[NamedTable(name="u_chart", columns=["muestra", "u", "LSC", "LIC", "fuera_de_control"], rows=rows)],
        warnings=[],
        iterations=None,
        sensitivity=None,
    )
