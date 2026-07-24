from __future__ import annotations

import logging
from collections import defaultdict

from app.modules.mrp.models import MrpRequest
from app.schemas.common import SolveStatus
from app.schemas.result import GraphNetwork, ModuleResult, NamedTable, SolutionBlock

logger = logging.getLogger(__name__)


def solve(req: MrpRequest) -> ModuleResult:
    horizon = max((len(v) for v in req.gross_requirements.values()), default=0)
    if horizon == 0:
        raise ValueError("gross_requirements must include at least one period")

    children: dict[str, list[tuple[str, float]]] = defaultdict(list)
    for b in req.bom:
        children[b.parent].append((b.component, b.qty_per))

    order = _topo_items(req.items, children)
    warnings: list[str] = []

    def _pad(item: str, src: dict[str, list[float]]) -> list[float]:
        raw = list(src.get(item, [0.0] * horizon))
        raw = raw + [0.0] * max(0, horizon - len(raw))
        return raw[:horizon]

    gross: dict[str, list[float]] = {i: _pad(i, req.gross_requirements) for i in req.items}
    scheduled: dict[str, list[float]] = {i: _pad(i, req.scheduled_receipts) for i in req.items}
    planned_receipts: dict[str, list[float]] = {i: [0.0] * horizon for i in req.items}
    planned_releases: dict[str, list[float]] = {i: [0.0] * horizon for i in req.items}
    projected_oh: dict[str, list[float]] = {}
    net_req: dict[str, list[float]] = {}

    for item in order:
        oh = float(req.on_hand.get(item, 0.0))
        ss = float(req.safety_stock.get(item, 0.0))
        lt = int(req.lead_times.get(item, 0))
        lot = float(req.lot_size.get(item, 0.0))
        proj = []
        nets = []
        for t in range(horizon):
            available = oh + scheduled[item][t]
            gr = gross[item][t]
            # Net requirement considering safety stock
            net = max(0.0, gr + ss - available)
            nets.append(net)
            receipt = 0.0
            if net > 0:
                if req.lot_for_lot or lot <= 0:
                    receipt = net
                else:
                    import math

                    receipt = math.ceil(net / lot) * lot
                planned_receipts[item][t] = receipt
                release_t = t - lt
                if release_t < 0:
                    warnings.append(
                        f"{item}: liberación planeada cae en periodo pasado (t={release_t + 1}) "
                        f"para recepción en t={t + 1}; lead time={lt}"
                    )
                    planned_releases[item][t] += receipt
                else:
                    planned_releases[item][release_t] += receipt
                oh = available + receipt - gr
            else:
                oh = available - gr
            # After meeting demand, projected OH should still respect safety conceptually
            proj.append(oh)
        projected_oh[item] = proj
        net_req[item] = nets

        for child, qty in children.get(item, []):
            for t in range(horizon):
                if planned_releases[item][t] > 0:
                    gross[child][t] += planned_releases[item][t] * qty

    tables = []
    variables: dict[str, float] = {}
    for item in req.items:
        # Classic MRP row orientation: rows = metrics, cols = periods
        classic_rows = [
            ["gross_requirements", *[gross[item][t] for t in range(horizon)]],
            ["scheduled_receipts", *[scheduled[item][t] for t in range(horizon)]],
            ["projected_on_hand", *[projected_oh[item][t] for t in range(horizon)]],
            ["net_requirements", *[net_req[item][t] for t in range(horizon)]],
            ["planned_order_receipts", *[planned_receipts[item][t] for t in range(horizon)]],
            ["planned_order_releases", *[planned_releases[item][t] for t in range(horizon)]],
        ]
        tables.append(
            NamedTable(
                name=f"mrp_{item}"[:31],
                columns=["fila", *[f"P{t+1}" for t in range(horizon)]],
                rows=classic_rows,
            )
        )
        for t in range(horizon):
            variables[f"{item}_PORel_t{t+1}"] = planned_releases[item][t]

    # BOM graph
    nodes = [{"id": i} for i in req.items]
    edges = [{"source": b.parent, "target": b.component, "qty": b.qty_per} for b in req.bom]
    graph = (
        GraphNetwork(
            type="network",
            nodes=nodes,
            edges=edges,
            title="Estructura de materiales (BOM)",
            subtitle="Cada arco indica cantidad del componente por unidad del padre",
        )
        if edges
        else None
    )

    total_releases = sum(sum(v) for v in planned_releases.values())
    result = ModuleResult(
        module="mrp",
        status=SolveStatus.ok,
        solution=SolutionBlock(
            variables=variables,
            metrics={"horizon": float(horizon), "total_planned_releases": float(total_releases)},
            objective_sense="min",
        ),
        tables=tables,
        iterations=None,
        sensitivity=None,
        graph=graph,
        warnings=warnings,
    )
    logger.info("module=%s status=%s", result.module, result.status.value)
    return result


def _topo_items(items: list[str], children: dict[str, list[tuple[str, float]]]) -> list[str]:
    indeg = {i: 0 for i in items}
    succ: dict[str, list[str]] = defaultdict(list)
    for parent, chs in children.items():
        for child, _ in chs:
            if child in indeg and parent in indeg:
                succ[parent].append(child)
                indeg[child] += 1
    from collections import deque

    q = deque([i for i, d in indeg.items() if d == 0])
    order = []
    while q:
        u = q.popleft()
        order.append(u)
        for v in succ[u]:
            indeg[v] -= 1
            if indeg[v] == 0:
                q.append(v)
    for i in items:
        if i not in order:
            order.append(i)
    return order
