from __future__ import annotations

import logging

import numpy as np
from scipy.stats import binom, hypergeom

from app.modules.acceptance_sampling.models import AcceptanceSamplingRequest
from app.schemas.common import SolveStatus
from app.schemas.result import GraphXY, ModuleResult, NamedTable, SolutionBlock

logger = logging.getLogger(__name__)


def solve(req: AcceptanceSamplingRequest) -> ModuleResult:
    warnings: list[str] = []
    n = req.n
    c = req.c

    if req.plan == "design":
        n, c, design_note = _design_plan(
            req.N, float(req.AQL), float(req.LTPD), req.producer_risk, req.consumer_risk
        )
        warnings.append(design_note)

    assert n is not None and c is not None
    if n > req.N:
        raise ValueError("sample size n cannot exceed lot size N")
    if c >= n:
        raise ValueError("acceptance number c must be < n")

    if req.p_points is not None:
        ps = [float(p) for p in req.p_points]
        if any(p < 0 or p > 1 for p in ps):
            raise ValueError("p_points must be in [0,1]")
    else:
        ps = np.linspace(0.0, req.p_max, req.n_curve).tolist()

    pa = [_pa_hypergeom(req.N, n, c, p) for p in ps]
    aoq = [p * pa_i * (req.N - n) / req.N for p, pa_i in zip(ps, pa)]
    ati = [n + (1.0 - pa_i) * (req.N - n) for pa_i in pa]

    aoql = max(aoq) if aoq else 0.0
    aoql_p = ps[int(np.argmax(aoq))] if aoq else 0.0

    metrics = {
        "N": float(req.N),
        "n": float(n),
        "c": float(c),
        "AOQL": float(aoql),
        "AOQL_p": float(aoql_p),
        "Pa_at_0.05": _pa_hypergeom(req.N, n, c, 0.05),
        "Pa_at_0.10": _pa_hypergeom(req.N, n, c, 0.10),
    }
    if req.AQL is not None:
        metrics["Pa_at_AQL"] = _pa_hypergeom(req.N, n, c, float(req.AQL))
        metrics["producer_risk_realized"] = 1.0 - metrics["Pa_at_AQL"]
    if req.LTPD is not None:
        metrics["Pa_at_LTPD"] = _pa_hypergeom(req.N, n, c, float(req.LTPD))
        metrics["consumer_risk_realized"] = metrics["Pa_at_LTPD"]

    rows = [[p, pa_i, aoq_i, ati_i] for p, pa_i, aoq_i, ati_i in zip(ps, pa, aoq, ati)]

    result = ModuleResult(
        module="acceptance_sampling",
        status=SolveStatus.ok,
        solution=SolutionBlock(
            variables={"AOQL": float(aoql), "n": float(n), "c": float(c)},
            metrics=metrics,
        ),
        graph=GraphXY(
            type="xy",
            series=[
                {"name": "OC_Pa", "x": ps, "y": pa},
                {"name": "AOQ", "x": ps, "y": aoq},
            ],
            x_label="Fracción defectuosa (p)",
            y_label="Pa / AOQ",
            title="Curva OC y calidad promedio de salida (AOQ)",
            subtitle=f"n = {n}, c = {c} · AOQL ≈ {aoql:.4g}",
        ),
        tables=[
            NamedTable(name="oc_aoq", columns=["p", "Pa", "AOQ", "ATI"], rows=rows),
            NamedTable(
                name="summary",
                columns=["métrica", "valor"],
                rows=[[k, v] for k, v in metrics.items()],
            ),
        ],
        warnings=warnings
        + ["La curva OC usa hipergeométrica (lote finito); M = redondeo(p·N) defectuosos en el lote"],
    )
    logger.info("module=%s status=%s", result.module, result.status.value)
    return result


def _design_plan(
    N: int, AQL: float, LTPD: float, alpha: float, beta: float
) -> tuple[int, int, str]:
    """Search small (n,c) satisfying Pa(AQL) >= 1-alpha and Pa(LTPD) <= beta."""
    best: tuple[int, int] | None = None
    for n in range(1, min(N, 200) + 1):
        for c in range(0, n):
            pa_aql = _pa_hypergeom(N, n, c, AQL)
            pa_ltpd = _pa_hypergeom(N, n, c, LTPD)
            if pa_aql >= 1.0 - alpha and pa_ltpd <= beta:
                if best is None or n < best[0] or (n == best[0] and c < best[1]):
                    best = (n, c)
        if best is not None and n > best[0] + 20:
            break
    if best is None:
        # Fallback binomial approximation enlarge
        for n in range(5, min(N, 500) + 1):
            for c in range(0, min(n, 20)):
                if binom.cdf(c, n, AQL) >= 1 - alpha and binom.cdf(c, n, LTPD) <= beta:
                    best = (n, c)
                    break
            if best:
                break
    if best is None:
        raise ValueError("No se encontró plan (n,c) que cumpla AQL/LTPD/α/β en el rango buscado")
    n, c = best
    return n, c, f"Diseño inverso: n={n}, c={c} (α={alpha}, β={beta}, AQL={AQL}, LTPD={LTPD})"


def _pa_hypergeom(N: int, n: int, c: int, p: float) -> float:
    if p <= 0:
        return 1.0
    if p >= 1:
        return 1.0 if c >= n else 0.0
    M = int(round(p * N))
    M = max(0, min(N, M))
    try:
        return float(hypergeom.cdf(c, N, M, n))
    except ValueError:
        return float(binom.cdf(c, n, p))
