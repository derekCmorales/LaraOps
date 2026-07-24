from __future__ import annotations

import logging
import math
from typing import Any

from app.modules.queues.models import QueuesRequest
from app.schemas.common import SolveStatus
from app.schemas.result import GraphXY, ModuleResult, NamedTable, SolutionBlock

logger = logging.getLogger(__name__)

INF = float("inf")


def solve(req: QueuesRequest) -> ModuleResult:
    lam = req.lambda_
    mu = req.mu
    warnings: list[str] = []

    metrics, pn = _dispatch(req, lam, mu, warnings)

    tables: list[NamedTable] = []
    graph = None
    if pn is not None and req.include_pn:
        tables.append(
            NamedTable(
                name="Pn",
                columns=["n", "Pn"],
                rows=[[i, float(p)] for i, p in enumerate(pn)],
            )
        )
        graph = GraphXY(
            type="xy",
            series=[{"name": "Pn", "x": list(range(len(pn))), "y": [float(p) for p in pn]}],
            x_label="n (clientes en el sistema)",
            y_label="Probabilidad Pn",
            title="Distribución de probabilidad del número de clientes",
            subtitle=f"Modelo {req.model}",
            kind="bar",
        )

    _apply_costs(req, metrics, warnings)

    variables = {
        k: float(v)
        for k, v in metrics.items()
        if isinstance(v, (int, float)) and math.isfinite(float(v))
    }

    if req.optimize_s:
        cost_table = _optimize_servers(req, lam, mu, warnings)
        if cost_table is not None:
            tables.append(cost_table)

    result = ModuleResult(
        module="queues",
        status=SolveStatus.ok,
        solution=SolutionBlock(variables=variables, metrics=metrics),
        iterations=None,
        sensitivity=None,
        graph=graph,
        tables=tables or None,
        warnings=warnings,
    )
    logger.info("module=%s status=%s", result.module, result.status.value)
    return result


def _dispatch(
    req: QueuesRequest, lam: float, mu: float, warnings: list[str]
) -> tuple[dict[str, float], list[float] | None]:
    if req.model == "M/M/1":
        return _mm1(lam, mu, req.include_pn, warnings)
    if req.model == "M/M/s":
        s = int(req.s)  # type: ignore[arg-type]
        return _mms(lam, mu, s, req.include_pn, warnings)
    if req.model == "M/M/1/K":
        K = int(req.K)  # type: ignore[arg-type]
        return _mm1k(lam, mu, K, warnings)
    if req.model == "M/M/s/N":
        s = int(req.s)  # type: ignore[arg-type]
        N = int(req.N)  # type: ignore[arg-type]
        return _mmsn(lam, mu, s, N, warnings)
    if req.model == "M/M/s/K":
        s = int(req.s)  # type: ignore[arg-type]
        K = int(req.K)  # type: ignore[arg-type]
        return _mmsk(lam, mu, s, K, warnings)
    if req.model == "M/G/1":
        sigma = float(req.service_std_dev)  # type: ignore[arg-type]
        return _mg1(lam, mu, sigma, warnings)
    # M/D/1
    return _md1(lam, mu, warnings)


def _mm1(
    lam: float, mu: float, include_pn: bool, warnings: list[str]
) -> tuple[dict[str, float], list[float] | None]:
    rho = lam / mu
    if rho >= 1:
        warnings.append(
            "rho >= 1: el sistema M/M/1 es inestable (la cola crece sin límite); "
            "L, Lq, W y Wq tienden a infinito"
        )
        return {"L": INF, "Lq": INF, "W": INF, "Wq": INF, "rho": rho, "P0": 0.0}, None
    p0 = 1.0 - rho
    lq = rho**2 / (1.0 - rho)
    L = rho / (1.0 - rho)
    W = 1.0 / (mu - lam)
    wq = lam / (mu * (mu - lam))
    pn = [p0 * (rho**n) for n in range(0, 21)] if include_pn else None
    return {"L": L, "Lq": lq, "W": W, "Wq": wq, "rho": rho, "P0": p0}, pn


def _mms(
    lam: float, mu: float, s: int, include_pn: bool, warnings: list[str]
) -> tuple[dict[str, float], list[float] | None]:
    rho = lam / (s * mu)
    if rho >= 1:
        warnings.append(
            f"rho >= 1: el sistema M/M/{s} es inestable (lambda >= s*mu); "
            "L, Lq, W y Wq tienden a infinito"
        )
        return {"L": INF, "Lq": INF, "W": INF, "Wq": INF, "rho": rho, "P0": 0.0}, None
    sum_term = sum((lam / mu) ** n / math.factorial(n) for n in range(s))
    last = (lam / mu) ** s / (math.factorial(s) * (1.0 - rho))
    p0 = 1.0 / (sum_term + last)
    lq = p0 * ((lam / mu) ** s) * rho / (math.factorial(s) * (1.0 - rho) ** 2)
    L = lq + lam / mu
    wq = lq / lam
    W = wq + 1.0 / mu
    pn = None
    if include_pn:
        pn = []
        for n in range(0, max(s + 15, 21)):
            if n < s:
                pn.append(p0 * (lam / mu) ** n / math.factorial(n))
            else:
                pn.append(p0 * (lam / mu) ** n / (math.factorial(s) * s ** (n - s)))
    return {"L": L, "Lq": lq, "W": W, "Wq": wq, "rho": rho, "P0": p0}, pn


def _mm1k(lam: float, mu: float, K: int, warnings: list[str]) -> tuple[dict[str, float], list[float]]:
    r = lam / mu
    if abs(r - 1.0) < 1e-12:
        p0 = 1.0 / (K + 1)
        pn = [p0] * (K + 1)
    else:
        p0 = (1.0 - r) / (1.0 - r ** (K + 1))
        pn = [p0 * (r**n) for n in range(K + 1)]
    L = sum(n * pn[n] for n in range(K + 1))
    lam_eff = lam * (1.0 - pn[K])
    lq = L - (lam_eff / mu)
    W = L / lam_eff if lam_eff > 1e-12 else INF
    wq = lq / lam_eff if lam_eff > 1e-12 else INF
    rho = 1.0 - p0
    warnings.append("rho reportado como 1-P0 (utilización del servidor) para capacidad finita")
    return {
        "L": L,
        "Lq": lq,
        "W": W,
        "Wq": wq,
        "rho": rho,
        "P0": p0,
        "lambda_eff": lam_eff,
    }, pn


def _mmsn(
    lam: float, mu: float, s: int, N: int, warnings: list[str]
) -> tuple[dict[str, float], list[float]]:
    pn_unnorm = [1.0]
    for n in range(1, N + 1):
        if n <= s:
            pn_unnorm.append(pn_unnorm[-1] * (N - n + 1) * lam / (n * mu))
        else:
            pn_unnorm.append(pn_unnorm[-1] * (N - n + 1) * lam / (s * mu))
    total = sum(pn_unnorm)
    pn = [x / total for x in pn_unnorm]
    p0 = pn[0]
    L = sum(n * pn[n] for n in range(N + 1))
    lam_eff = lam * sum((N - n) * pn[n] for n in range(N + 1))
    busy = sum(min(n, s) * pn[n] for n in range(N + 1))
    lq = L - busy
    W = L / lam_eff if lam_eff > 1e-12 else INF
    wq = lq / lam_eff if lam_eff > 1e-12 else INF
    rho = busy / s
    if N <= s:
        warnings.append("N <= s: la cola nunca se forma en esta población finita (Lq = 0)")
    return {
        "L": L,
        "Lq": lq,
        "W": W,
        "Wq": wq,
        "rho": rho,
        "P0": p0,
        "lambda_eff": lam_eff,
    }, pn


def _mmsk(lam: float, mu: float, s: int, K: int, warnings: list[str]) -> tuple[dict[str, float], list[float]]:
    if K < s:
        raise ValueError("K debe ser mayor o igual que s en M/M/s/K")
    r = lam / mu
    pn_unnorm = [1.0]
    for n in range(1, K + 1):
        if n <= s:
            pn_unnorm.append(pn_unnorm[-1] * r / n)
        else:
            pn_unnorm.append(pn_unnorm[-1] * r / s)
    total = sum(pn_unnorm)
    pn = [x / total for x in pn_unnorm]
    p0 = pn[0]
    L = sum(n * pn[n] for n in range(K + 1))
    lam_eff = lam * (1.0 - pn[K])
    busy = lam_eff / mu
    lq = L - busy
    W = L / lam_eff if lam_eff > 1e-12 else INF
    wq = lq / lam_eff if lam_eff > 1e-12 else INF
    rho = busy / s
    return {
        "L": L,
        "Lq": lq,
        "W": W,
        "Wq": wq,
        "rho": rho,
        "P0": p0,
        "lambda_eff": lam_eff,
    }, pn


def _mg1(lam: float, mu: float, sigma: float, warnings: list[str]) -> tuple[dict[str, float], None]:
    rho = lam / mu
    if rho >= 1:
        warnings.append(
            "rho >= 1: el sistema M/G/1 es inestable; L, Lq, W y Wq tienden a infinito"
        )
        return {"L": INF, "Lq": INF, "W": INF, "Wq": INF, "rho": rho, "P0": 0.0}, None
    lq = (lam**2 * sigma**2 + rho**2) / (2.0 * (1.0 - rho))
    L = lq + rho
    wq = lq / lam
    W = wq + 1.0 / mu
    p0 = 1.0 - rho
    warnings.append(
        "M/G/1 usa la fórmula de Pollaczek-Khinchine; no existe distribución Pn de forma cerrada"
    )
    return {"L": L, "Lq": lq, "W": W, "Wq": wq, "rho": rho, "P0": p0}, None


def _md1(lam: float, mu: float, warnings: list[str]) -> tuple[dict[str, float], None]:
    metrics, _ = _mg1(lam, mu, 0.0, warnings)
    return metrics, None


def _apply_costs(req: QueuesRequest, metrics: dict[str, float], warnings: list[str]) -> None:
    if req.cost_waiting_per_unit_time is None and req.cost_server_per_unit_time is None:
        return
    if metrics.get("L") == INF:
        warnings.append("No se calculan costos: el sistema es inestable (L = infinito)")
        return
    s_used = req.s if req.s is not None else 1
    cw = req.cost_waiting_per_unit_time or 0.0
    cs = req.cost_server_per_unit_time or 0.0
    cost_waiting = cw * metrics["L"]
    cost_server = cs * s_used
    metrics["cost_waiting"] = float(cost_waiting)
    metrics["cost_server"] = float(cost_server)
    metrics["cost_total"] = float(cost_waiting + cost_server)


def _optimize_servers(
    req: QueuesRequest, lam: float, mu: float, warnings: list[str]
) -> NamedTable | None:
    if req.model not in ("M/M/s", "M/M/s/K", "M/M/s/N"):
        warnings.append("optimize_s solo aplica a modelos multi-servidor (M/M/s, M/M/s/K, M/M/s/N)")
        return None
    if req.cost_waiting_per_unit_time is None or req.cost_server_per_unit_time is None:
        warnings.append(
            "optimize_s requiere cost_waiting_per_unit_time y cost_server_per_unit_time"
        )
        return None

    cw = req.cost_waiting_per_unit_time
    cs = req.cost_server_per_unit_time
    s_min = max(1, math.ceil(lam / mu) if req.model != "M/M/s/N" else 1)
    s_max = req.s_max or max(s_min + 10, (req.s or s_min) + 10)

    rows: list[list[Any]] = []
    best_s = None
    best_cost = INF
    local_warnings: list[str] = []
    for s_try in range(1, s_max + 1):
        try:
            if req.model == "M/M/s":
                m, _ = _mms(lam, mu, s_try, False, local_warnings)
            elif req.model == "M/M/s/K":
                K = int(req.K)  # type: ignore[arg-type]
                if K < s_try:
                    continue
                m, _ = _mmsk(lam, mu, s_try, K, local_warnings)
            else:
                N = int(req.N)  # type: ignore[arg-type]
                if s_try > N:
                    continue
                m, _ = _mmsn(lam, mu, s_try, N, local_warnings)
        except ValueError:
            continue
        if m.get("L") == INF:
            continue
        cost_waiting = cw * m["L"]
        cost_server = cs * s_try
        cost_total = cost_waiting + cost_server
        rows.append([s_try, m["L"], m["Lq"], m["W"], m["Wq"], m["rho"], cost_waiting, cost_server, cost_total, False])
        if cost_total < best_cost:
            best_cost = cost_total
            best_s = s_try

    if best_s is None:
        warnings.append("No fue posible optimizar s: ningún valor evaluado resultó estable")
        return None

    for row in rows:
        row[-1] = row[0] == best_s

    warnings.append(f"Número óptimo de servidores recomendado: s = {best_s} (costo total = {best_cost:.4g})")

    return NamedTable(
        name="cost_by_s",
        columns=[
            "servidores",
            "L",
            "Lq",
            "W",
            "Wq",
            "rho",
            "costo_espera",
            "costo_servidor",
            "costo_total",
            "óptimo",
        ],
        rows=rows,
    )
