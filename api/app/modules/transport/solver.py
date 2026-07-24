from __future__ import annotations

import logging
from copy import deepcopy

from app.modules.transport.models import TransportRequest
from app.schemas.common import SolveStatus
from app.schemas.result import (
    GraphMatrix,
    IterationStep,
    ModuleResult,
    SensitivityBlock,
    SolutionBlock,
)

logger = logging.getLogger(__name__)

_BIG_M = 1e9


def _transport_tableau(
    alloc: dict[str, dict[str, float]],
    costs: dict[str, dict[str, float]],
    sources: list[str],
    dests: list[str],
    supply_rem: dict[str, float] | None = None,
    demand_rem: dict[str, float] | None = None,
    u: dict[str, float | None] | None = None,
    v: dict[str, float | None] | None = None,
) -> list[list[float | str]]:
    header: list[float | str] = [""] + list(dests)
    if supply_rem is not None:
        header.append("Oferta")
    rows: list[list[float | str]] = [header]
    for i in sources:
        row: list[float | str] = [i]
        for j in dests:
            a, c = alloc[i][j], costs[i][j]
            row.append(f"{a:g} ({c:g})" if a > 1e-12 else c)
        if supply_rem is not None:
            row.append(float(supply_rem.get(i, 0)))
        rows.append(row)
    if demand_rem is not None:
        dem: list[float | str] = ["Demanda"]
        for j in dests:
            dem.append(float(demand_rem.get(j, 0)))
        if supply_rem is not None:
            dem.append("")
        rows.append(dem)
    if u is not None:
        urow: list[float | str] = ["uᵢ"]
        for i in sources:
            urow.append(float(u[i]) if u.get(i) is not None else "")
        if supply_rem is not None:
            urow.append("")
        rows.append(urow)
    if v is not None:
        vrow: list[float | str] = ["vⱼ"]
        for j in dests:
            vrow.append(float(v[j]) if v.get(j) is not None else "")
        if supply_rem is not None:
            vrow.append("")
        rows.append(vrow)
    return rows


def solve(req: TransportRequest) -> ModuleResult:
    supply = dict(req.supply)
    demand = dict(req.demand)
    costs = {i: dict(j) for i, j in req.costs.items()}
    warnings: list[str] = []
    iterations: list[IterationStep] = []

    # Forbidden routes → huge cost
    for src, dst in req.forbidden_routes:
        if src not in costs:
            costs[src] = {}
        costs[src][dst] = _BIG_M
        warnings.append(f"Ruta prohibida {src}->{dst} (costo M)")

    # Maximize: convert to minimization of negated costs
    if req.objective == "maximize":
        for i in costs:
            for j in costs[i]:
                if costs[i][j] < _BIG_M / 2:
                    costs[i][j] = -costs[i][j]
        warnings.append("Maximización convertida a minimización de costos negados")

    total_s = sum(supply.values())
    total_d = sum(demand.values())
    if abs(total_s - total_d) > 1e-9:
        if total_s < total_d:
            dummy = "_dummy_source"
            supply[dummy] = total_d - total_s
            costs[dummy] = {j: 0.0 for j in demand}
            warnings.append(f"Se balanceó con origen ficticio {dummy}")
        else:
            dummy = "_dummy_dest"
            demand[dummy] = total_s - total_d
            for i in costs:
                costs[i][dummy] = 0.0
            warnings.append(f"Se balanceó con destino ficticio {dummy}")

    sources = list(supply.keys())
    dests = list(demand.keys())
    # Ensure full cost matrix
    for i in sources:
        costs.setdefault(i, {})
        for j in dests:
            costs[i].setdefault(j, _BIG_M if (i, j) in req.forbidden_routes else 0.0)

    init = req.method
    if init == "northwest":
        alloc, iters = _northwest(supply, demand, sources, dests)
    elif init == "least_cost":
        alloc, iters = _least_cost(supply, demand, costs, sources, dests)
    else:
        # vogel or modi_auto
        alloc, iters = _vogel(supply, demand, costs, sources, dests)
    iterations.extend(iters)

    if req.method == "modi_auto" or init in ("vogel", "least_cost", "northwest"):
        # Always improve with MODI for modi_auto; for pure initial methods skip unless modi_auto
        if req.method == "modi_auto":
            alloc, modi_iters = _modi_improve(alloc, costs, sources, dests)
            iterations.extend(modi_iters)

    # Degeneracy warning
    basics = sum(1 for i in sources for j in dests if alloc[i][j] > 1e-12)
    needed = len(sources) + len(dests) - 1
    if basics < needed:
        warnings.append(f"Solución degenerada: {basics} celdas básicas < m+n-1={needed}")

    sensitivity, alt_opt = _compute_sensitivity(alloc, costs, sources, dests)
    if alt_opt:
        warnings.append(
            "Óptimos múltiples: hay celdas vacías con costo reducido ≈ 0 "
            f"({', '.join(alt_opt[:5])}{'…' if len(alt_opt) > 5 else ''})"
        )

    # Report objective in original sense
    shipments = {
        f"{i}->{j}": float(alloc[i][j])
        for i in sources
        for j in dests
        if alloc[i][j] > 1e-12 and not str(i).startswith("_dummy") and not str(j).startswith("_dummy")
    }
    # Include dummy flows too for balance transparency
    for i in sources:
        for j in dests:
            if alloc[i][j] > 1e-12:
                key = f"{i}->{j}"
                shipments.setdefault(key, float(alloc[i][j]))

    total_cost_internal = sum(alloc[i][j] * costs[i][j] for i in sources for j in dests)
    if req.objective == "maximize":
        # Recover original utility (negated again, excluding big-M)
        total_reported = 0.0
        for i in sources:
            for j in dests:
                c_orig = req.costs.get(i, {}).get(j)
                if c_orig is None:
                    continue
                total_reported += alloc[i][j] * c_orig
        objective_value = float(total_reported)
        sense = "max"
    else:
        objective_value = float(total_cost_internal)
        sense = "min"

    values = [[float(alloc[i][j]) for j in dests] for i in sources]
    graph = GraphMatrix(
        type="matrix",
        row_labels=sources,
        col_labels=dests,
        values=values,
        title="Matriz de envíos (transporte)",
        subtitle="Cantidad enviada de cada origen a cada destino",
        value_label="Cantidad enviada",
    )

    result = ModuleResult(
        module="transport",
        status=SolveStatus.optimal,
        solution=SolutionBlock(
            variables=shipments,
            objective_value=objective_value,
            objective_sense=sense,
            metrics={"total_cost": float(objective_value), "basic_cells": float(basics)},
        ),
        iterations=iterations,
        sensitivity=sensitivity,
        graph=graph,
        tables=None,
        warnings=warnings,
    )
    logger.info("module=%s status=%s", result.module, result.status.value)
    return result


def _compute_sensitivity(
    alloc: dict[str, dict[str, float]],
    costs: dict[str, dict[str, float]],
    sources: list[str],
    dests: list[str],
) -> tuple[SensitivityBlock, list[str]]:
    basics = [(i, j) for i in sources for j in dests if alloc[i][j] > 1e-12]
    needed = len(sources) + len(dests) - 1
    work = deepcopy(alloc)
    if len(basics) < needed:
        for i in sources:
            for j in dests:
                if work[i][j] <= 1e-12:
                    work[i][j] = 1e-9
                    basics.append((i, j))
                    if len(basics) >= needed:
                        break
            if len(basics) >= needed:
                break

    u: dict[str, float | None] = {i: None for i in sources}
    v: dict[str, float | None] = {j: None for j in dests}
    u[sources[0]] = 0.0
    changed = True
    guard = 0
    while changed and guard < 200:
        changed = False
        guard += 1
        for i, j in basics:
            if u[i] is not None and v[j] is None:
                v[j] = costs[i][j] - u[i]
                changed = True
            elif v[j] is not None and u[i] is None:
                u[i] = costs[i][j] - v[j]
                changed = True

    reduced: list[dict] = []
    alt: list[str] = []
    if any(u[i] is None for i in sources) or any(v[j] is None for j in dests):
        return SensitivityBlock(), alt

    for i in sources:
        for j in dests:
            dij = float(costs[i][j] - u[i] - v[j])  # type: ignore[operator]
            if alloc[i][j] <= 1e-12:
                reduced.append(
                    {
                        "variable": f"{i}->{j}",
                        "reduced_cost": dij,
                        "u_i": float(u[i]),  # type: ignore[arg-type]
                        "v_j": float(v[j]),  # type: ignore[arg-type]
                    }
                )
                if abs(dij) < 1e-8:
                    alt.append(f"{i}->{j}")

    return SensitivityBlock(reduced_costs=reduced), alt


def _empty_alloc(sources: list[str], dests: list[str]) -> dict[str, dict[str, float]]:
    return {i: {j: 0.0 for j in dests} for i in sources}


def _northwest(
    supply: dict[str, float],
    demand: dict[str, float],
    sources: list[str],
    dests: list[str],
) -> tuple[dict[str, dict[str, float]], list[IterationStep]]:
    s = dict(supply)
    d = dict(demand)
    alloc = _empty_alloc(sources, dests)
    iterations: list[IterationStep] = []
    i = j = 0
    step = 0
    while i < len(sources) and j < len(dests):
        qty = min(s[sources[i]], d[dests[j]])
        alloc[sources[i]][dests[j]] = qty
        s[sources[i]] -= qty
        d[dests[j]] -= qty
        iterations.append(
            IterationStep(
                index=step,
                method="northwest",
                title=f"Esquina noroeste ({sources[i]},{dests[j]})={qty}",
                tableau=_transport_tableau(alloc, costs, sources, dests, s, d),
                meta={"i": sources[i], "j": dests[j], "qty": qty},
            )
        )
        step += 1
        if s[sources[i]] < 1e-12:
            i += 1
        if d[dests[j]] < 1e-12:
            j += 1
    return alloc, iterations


def _least_cost(
    supply: dict[str, float],
    demand: dict[str, float],
    costs: dict[str, dict[str, float]],
    sources: list[str],
    dests: list[str],
) -> tuple[dict[str, dict[str, float]], list[IterationStep]]:
    s = dict(supply)
    d = dict(demand)
    alloc = _empty_alloc(sources, dests)
    iterations: list[IterationStep] = []
    step = 0
    active_i = set(sources)
    active_j = set(dests)
    while active_i and active_j:
        best = None
        best_c = float("inf")
        for i in active_i:
            for j in active_j:
                c = costs[i][j]
                if c < best_c:
                    best_c = c
                    best = (i, j)
        assert best is not None
        i, j = best
        qty = min(s[i], d[j])
        alloc[i][j] += qty
        s[i] -= qty
        d[j] -= qty
        iterations.append(
            IterationStep(
                index=step,
                method="least_cost",
                title=f"Costo mínimo ({i},{j})={qty} c={best_c}",
                tableau=_transport_tableau(alloc, costs, sources, dests, s, d),
                meta={"i": i, "j": j, "qty": qty, "cost": best_c},
            )
        )
        step += 1
        if s[i] < 1e-12:
            active_i.discard(i)
        if d[j] < 1e-12:
            active_j.discard(j)
    return alloc, iterations


def _vogel(
    supply: dict[str, float],
    demand: dict[str, float],
    costs: dict[str, dict[str, float]],
    sources: list[str],
    dests: list[str],
) -> tuple[dict[str, dict[str, float]], list[IterationStep]]:
    s = dict(supply)
    d = dict(demand)
    alloc = _empty_alloc(sources, dests)
    iterations: list[IterationStep] = []
    active_i = set(sources)
    active_j = set(dests)
    step = 0

    while active_i and active_j:
        row_pen: dict[str, float] = {}
        for i in active_i:
            vals = sorted(costs[i][j] for j in active_j)
            row_pen[i] = vals[1] - vals[0] if len(vals) > 1 else vals[0]
        col_pen: dict[str, float] = {}
        for j in active_j:
            vals = sorted(costs[i][j] for i in active_i)
            col_pen[j] = vals[1] - vals[0] if len(vals) > 1 else vals[0]

        best_row = max(row_pen, key=lambda k: row_pen[k])
        best_col = max(col_pen, key=lambda k: col_pen[k])
        if row_pen[best_row] >= col_pen[best_col]:
            i = best_row
            j = min(active_j, key=lambda jj: costs[i][jj])
        else:
            j = best_col
            i = min(active_i, key=lambda ii: costs[ii][j])

        qty = min(s[i], d[j])
        alloc[i][j] += qty
        s[i] -= qty
        d[j] -= qty
        iterations.append(
            IterationStep(
                index=step,
                method="vogel",
                title=f"Vogel ({i},{j})={qty}",
                tableau=_transport_tableau(alloc, costs, sources, dests, s, d),
                meta={"i": i, "j": j, "qty": qty, "row_pen": row_pen, "col_pen": col_pen},
            )
        )
        step += 1
        if s[i] < 1e-12:
            active_i.discard(i)
        if d[j] < 1e-12:
            active_j.discard(j)

    return alloc, iterations


def _modi_improve(
    alloc: dict[str, dict[str, float]],
    costs: dict[str, dict[str, float]],
    sources: list[str],
    dests: list[str],
    max_iters: int = 50,
) -> tuple[dict[str, dict[str, float]], list[IterationStep]]:
    alloc = deepcopy(alloc)
    iterations: list[IterationStep] = []

    for t in range(max_iters):
        basics = [(i, j) for i in sources for j in dests if alloc[i][j] > 1e-12]
        needed = len(sources) + len(dests) - 1
        if len(basics) < needed:
            for i in sources:
                for j in dests:
                    if (i, j) not in basics:
                        alloc[i][j] = 1e-9
                        basics.append((i, j))
                        if len(basics) >= needed:
                            break
                if len(basics) >= needed:
                    break

        u: dict[str, float | None] = {i: None for i in sources}
        v: dict[str, float | None] = {j: None for j in dests}
        u[sources[0]] = 0.0
        changed = True
        guard = 0
        while changed and guard < 100:
            changed = False
            guard += 1
            for i, j in basics:
                if u[i] is not None and v[j] is None:
                    v[j] = costs[i][j] - u[i]
                    changed = True
                elif v[j] is not None and u[i] is None:
                    u[i] = costs[i][j] - v[j]
                    changed = True

        if any(u[i] is None for i in sources) or any(v[j] is None for j in dests):
            break

        best = None
        best_val = 0.0
        for i in sources:
            for j in dests:
                if alloc[i][j] > 1e-12:
                    continue
                dij = costs[i][j] - u[i] - v[j]  # type: ignore[operator]
                if dij < best_val - 1e-9:
                    best_val = dij
                    best = (i, j)

        iterations.append(
            IterationStep(
                index=t,
                method="modi",
                title=f"Ciclo MODI {t}",
                tableau=_transport_tableau(alloc, costs, sources, dests, u=u, v=v),
                meta={
                    "u": {k: float(val) if val is not None else None for k, val in u.items()},
                    "v": {k: float(val) if val is not None else None for k, val in v.items()},
                    "enter": best,
                    "delta": best_val,
                },
            )
        )

        if best is None:
            for i in sources:
                for j in dests:
                    if alloc[i][j] < 1e-8:
                        alloc[i][j] = 0.0
            break

        enter_i, enter_j = best
        path = _find_cycle(alloc, sources, dests, enter_i, enter_j)
        if not path:
            break
        minus_cells = path[1::2]
        theta = min(alloc[i][j] for i, j in minus_cells)
        for idx, (i, j) in enumerate(path):
            if idx % 2 == 0:
                alloc[i][j] += theta
            else:
                alloc[i][j] -= theta
                if alloc[i][j] < 1e-8:
                    alloc[i][j] = 0.0
    return alloc, iterations


def _find_cycle(
    alloc: dict[str, dict[str, float]],
    sources: list[str],
    dests: list[str],
    start_i: str,
    start_j: str,
) -> list[tuple[str, str]]:
    basics = {(i, j) for i in sources for j in dests if alloc[i][j] > 1e-12}
    basics.add((start_i, start_j))

    def search(path: list[tuple[str, str]], horizontal: bool) -> list[tuple[str, str]] | None:
        i, j = path[-1]
        if len(path) >= 4 and (i, j) == (start_i, start_j):
            return path[:-1]
        if horizontal:
            for jj in dests:
                if jj == j:
                    continue
                if (i, jj) in basics and (i, jj) not in path[1:]:
                    res = search([*path, (i, jj)], False)
                    if res:
                        return res
        else:
            for ii in sources:
                if ii == i:
                    continue
                if (ii, j) in basics and (ii, j) not in path[1:]:
                    res = search([*path, (ii, j)], True)
                    if res:
                        return res
        return None

    return search([(start_i, start_j)], True) or []
