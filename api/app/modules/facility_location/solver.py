from __future__ import annotations

import logging
from collections import defaultdict, deque

from app.modules.facility_location.models import FacilityLocationRequest
from app.schemas.common import SolveStatus
from app.schemas.result import ModuleResult, NamedTable, SolutionBlock

logger = logging.getLogger(__name__)


def solve(req: FacilityLocationRequest) -> ModuleResult:
    if req.mode == "center_of_gravity":
        return _cog(req)
    return _line_balance(req)


def _cog(req: FacilityLocationRequest) -> ModuleResult:
    if not req.points:
        raise ValueError("points required for center_of_gravity")
    num_x = sum(float(p["x"]) * float(p["volume"]) for p in req.points)
    num_y = sum(float(p["y"]) * float(p["volume"]) for p in req.points)
    den = sum(float(p["volume"]) for p in req.points)
    if den <= 0:
        raise ValueError("total volume must be > 0")
    cx, cy = num_x / den, num_y / den
    return ModuleResult(
        module="facility_location",
        status=SolveStatus.ok,
        solution=SolutionBlock(
            variables={"x": cx, "y": cy},
            metrics={"x": cx, "y": cy, "total_volume": float(den)},
        ),
        tables=[
            NamedTable(
                name="sites",
                columns=["nombre", "x", "y", "volumen"],
                rows=[[p.get("name", ""), p["x"], p["y"], p["volume"]] for p in req.points],
            )
        ],
        warnings=[],
    )


def _line_balance(req: FacilityLocationRequest) -> ModuleResult:
    if not req.tasks or req.cycle_time is None:
        raise ValueError("tasks and cycle_time required for line_balance")
    ct = float(req.cycle_time)
    tasks = {t["id"]: t for t in req.tasks}
    preds = {t["id"]: list(t.get("predecessors", [])) for t in req.tasks}
    # Kahn topo
    indeg = {i: len(preds[i]) for i in tasks}
    succ: dict[str, list[str]] = defaultdict(list)
    for i, ps in preds.items():
        for p in ps:
            succ[p].append(i)
    ready = deque([i for i, d in indeg.items() if d == 0])
    order = []
    while ready:
        # pick longest time among ready (ranked positional weight lite)
        u = max(ready, key=lambda i: float(tasks[i]["time"]))
        ready = deque([x for x in ready if x != u])
        order.append(u)
        for v in succ[u]:
            indeg[v] -= 1
            if indeg[v] == 0:
                ready.append(v)

    stations: list[list[str]] = [[]]
    loads = [0.0]
    for tid in order:
        t = float(tasks[tid]["time"])
        if loads[-1] + t <= ct + 1e-9:
            stations[-1].append(tid)
            loads[-1] += t
        else:
            stations.append([tid])
            loads.append(t)

    total_time = sum(float(tasks[t]["time"]) for t in tasks)
    n_st = len(stations)
    efficiency = total_time / (n_st * ct) if n_st * ct > 0 else 0.0
    rows = [[i + 1, ",".join(st), loads[i], ct - loads[i]] for i, st in enumerate(stations)]
    return ModuleResult(
        module="facility_location",
        status=SolveStatus.ok,
        solution=SolutionBlock(
            variables={f"station_{i+1}": float(len(st)) for i, st in enumerate(stations)},
            metrics={
                "num_stations": float(n_st),
                "cycle_time": ct,
                "efficiency": float(efficiency),
                "total_task_time": float(total_time),
            },
        ),
        tables=[
            NamedTable(
                name="stations",
                columns=["estación", "tareas", "carga", "ocioso"],
                rows=rows,
            )
        ],
        warnings=[],
    )
