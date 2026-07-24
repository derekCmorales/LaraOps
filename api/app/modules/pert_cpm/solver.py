from __future__ import annotations

import logging
from collections import defaultdict, deque

from scipy.stats import norm

from app.modules.pert_cpm.models import Activity, PertCpmRequest
from app.schemas.common import SolveStatus
from app.schemas.result import (
    GraphGantt,
    GraphNetwork,
    IterationStep,
    ModuleResult,
    NamedTable,
    SolutionBlock,
)

logger = logging.getLogger(__name__)


class PertCpmError(ValueError):
    pass


def solve(req: PertCpmRequest) -> ModuleResult:
    if not req.activities:
        raise PertCpmError("empty activities")

    acts = {a.id: a for a in req.activities}
    if len(acts) != len(req.activities):
        raise PertCpmError("duplicate activity ids")

    for a in req.activities:
        for p in a.predecessors:
            if p not in acts:
                raise PertCpmError(f"unknown predecessor {p} for {a.id}")

    duration: dict[str, float] = {}
    te: dict[str, float] = {}
    variance: dict[str, float] = {}
    for a in req.activities:
        if req.mode == "cpm":
            if a.duration is None or a.duration < 0:
                raise PertCpmError(f"activity {a.id} requires duration >= 0")
            duration[a.id] = float(a.duration)
            te[a.id] = float(a.duration)
            variance[a.id] = 0.0
        else:
            if a.a is None or a.m is None or a.b is None:
                raise PertCpmError(f"activity {a.id} requires a,m,b")
            if not (a.a <= a.m <= a.b):
                raise PertCpmError(f"activity {a.id} requires a<=m<=b")
            te_val = (a.a + 4 * a.m + a.b) / 6.0
            var_val = ((a.b - a.a) / 6.0) ** 2
            duration[a.id] = te_val
            te[a.id] = te_val
            variance[a.id] = var_val

    crash_steps: list[IterationStep] = []
    total_crash_cost = 0.0
    warnings: list[str] = []
    crash_infeasible = False

    if req.crash:
        if req.mode != "cpm":
            raise PertCpmError("crashing is only supported in CPM mode")
        target = req.crash_target
        if target is None:
            raise PertCpmError("crash=True requires crash_target")
        duration, total_crash_cost, crash_steps, warnings, crash_infeasible = _crash_project(
            acts, duration, target
        )

    order = _topo_sort(acts)
    sched = _schedule(acts, duration, order)
    project_duration = sched["project_duration"]
    if req.crash and req.crash_target is not None and project_duration > req.crash_target + 1e-6:
        crash_infeasible = True
        if "Cannot crash further" not in " ".join(warnings):
            warnings.append(
                f"Cannot reach crash_target {req.crash_target}; best duration {project_duration}"
            )
    es, ef, ls, lf, slack, critical = (
        sched["es"],
        sched["ef"],
        sched["ls"],
        sched["lf"],
        sched["slack"],
        sched["critical"],
    )
    successors = sched["successors"]

    critical_path = _primary_critical_path(acts, successors, critical, order)
    if _count_critical_paths(acts, successors, critical) > 1:
        warnings.append("Existen varias rutas críticas; se seleccionó la secuencia lexicográficamente menor")

    schedule_rows = []
    for aid in order:
        schedule_rows.append(
            [
                aid,
                es[aid],
                ef[aid],
                ls[aid],
                lf[aid],
                slack[aid],
                critical[aid],
                te[aid] if req.mode == "pert" else duration[aid],
                variance[aid] if req.mode == "pert" else "",
            ]
        )

    gantt_rows = [[aid, es[aid], ef[aid], critical[aid]] for aid in order]

    metrics: dict[str, float] = {"project_duration": project_duration}
    if req.mode == "pert":
        project_te = sum(te[aid] for aid in critical_path)
        project_var = sum(variance[aid] for aid in critical_path)
        project_std = project_var**0.5
        metrics["project_te"] = project_te
        metrics["project_variance"] = project_var
        metrics["project_std"] = project_std
        if req.target_time is not None and project_std > 1e-12:
            metrics["prob_meet_target"] = float(norm.cdf((req.target_time - project_te) / project_std))
        elif req.target_time is not None:
            metrics["prob_meet_target"] = 1.0 if req.target_time >= project_te else 0.0
        if req.target_probability is not None:
            p = float(req.target_probability)
            if not 0.0 < p < 1.0:
                raise PertCpmError("target_probability must be in (0,1)")
            z = float(norm.ppf(p))
            metrics["target_probability"] = p
            metrics["duration_for_probability"] = float(project_te + z * project_std)

    if req.crash:
        metrics["crash_total_cost"] = total_crash_cost
        metrics["crash_target"] = float(req.crash_target or 0.0)
        normal_cost = sum(float(a.normal_cost or 0.0) for a in req.activities)
        metrics["normal_cost_sum"] = normal_cost
        metrics["project_cost"] = normal_cost + total_crash_cost

    nodes = [{"id": aid, "critical": critical[aid]} for aid in order]
    edges = []
    for a in req.activities:
        for p in a.predecessors:
            edges.append({"source": p, "target": a.id, "critical": critical[p] and critical[a.id]})

    tables = [
        NamedTable(
            name="schedule",
            columns=["id", "IT", "FT", "ITa", "FTa", "holgura", "crítica", "te", "varianza"],
            rows=schedule_rows,
        ),
        NamedTable(
            name="critical_path",
            columns=["orden", "id"],
            rows=[[i, aid] for i, aid in enumerate(critical_path)],
        ),
        NamedTable(
            name="gantt",
            columns=["id", "inicio", "fin", "crítica"],
            rows=gantt_rows,
        ),
    ]
    if req.crash:
        tables.append(
            NamedTable(
                name="durations_after_crash",
                columns=["id", "duration"],
                rows=[[aid, duration[aid]] for aid in order],
            )
        )

    if req.graph_kind == "gantt":
        graph: GraphNetwork | GraphGantt = GraphGantt(
            type="gantt",
            bars=[
                {
                    "id": aid,
                    "start": es[aid],
                    "end": ef[aid],
                    "critical": critical[aid],
                    "slack": slack[aid],
                }
                for aid in order
            ],
            title="Diagrama de Gantt del proyecto",
            subtitle="Magenta = ruta crítica · gris = holgura",
            x_label="Tiempo",
        )
    else:
        graph = GraphNetwork(
            type="network",
            nodes=nodes,
            edges=edges,
            title="Red del proyecto (PERT/CPM)",
            subtitle="Magenta = actividades o arcos de la ruta crítica",
        )

    status = SolveStatus.infeasible if crash_infeasible else SolveStatus.ok
    result = ModuleResult(
        module="pert_cpm",
        status=status,
        solution=SolutionBlock(
            variables={aid: duration[aid] for aid in order},
            objective_value=project_duration,
            objective_sense="min",
            metrics=metrics,
        ),
        iterations=crash_steps or None,
        sensitivity=None,
        graph=graph,
        tables=tables,
        warnings=warnings,
    )
    logger.info("module=%s status=%s", result.module, result.status.value)
    return result


def _schedule(
    acts: dict[str, Activity],
    duration: dict[str, float],
    order: list[str],
) -> dict:
    es: dict[str, float] = {}
    ef: dict[str, float] = {}
    for aid in order:
        preds = acts[aid].predecessors
        es[aid] = max((ef[p] for p in preds), default=0.0)
        ef[aid] = es[aid] + duration[aid]

    project_duration = max(ef.values()) if ef else 0.0

    ls: dict[str, float] = {}
    lf: dict[str, float] = {}
    successors: dict[str, list[str]] = defaultdict(list)
    for a in acts.values():
        for p in a.predecessors:
            successors[p].append(a.id)

    for aid in reversed(order):
        succs = successors[aid]
        lf[aid] = min((ls[s] for s in succs), default=project_duration)
        ls[aid] = lf[aid] - duration[aid]

    slack = {aid: ls[aid] - es[aid] for aid in acts}
    critical = {aid: slack[aid] <= 1e-9 for aid in acts}
    return {
        "es": es,
        "ef": ef,
        "ls": ls,
        "lf": lf,
        "slack": slack,
        "critical": critical,
        "successors": successors,
        "project_duration": project_duration,
    }


def _crash_project(
    acts: dict[str, Activity],
    duration: dict[str, float],
    target: float,
) -> tuple[dict[str, float], float, list[IterationStep], list[str], bool]:
    duration = dict(duration)
    warnings: list[str] = []
    steps: list[IterationStep] = []
    total_cost = 0.0
    infeasible = False
    order = _topo_sort(acts)

    for a in acts.values():
        if a.crash_time is None or a.normal_cost is None or a.crash_cost is None:
            continue
        if a.crash_time < 0 or a.crash_time > float(a.duration or 0):
            raise PertCpmError(f"activity {a.id} requires 0 <= crash_time <= duration")
        if a.crash_cost < a.normal_cost:
            raise PertCpmError(f"activity {a.id} crash_cost must be >= normal_cost")

    step_i = 0
    while True:
        sched = _schedule(acts, duration, order)
        t = sched["project_duration"]
        critical = sched["critical"]
        if t <= target + 1e-9:
            break

        candidates: list[tuple[float, str, float]] = []
        for aid, a in acts.items():
            if not critical[aid]:
                continue
            if a.crash_time is None or a.normal_cost is None or a.crash_cost is None:
                continue
            room = duration[aid] - float(a.crash_time)
            if room <= 1e-12:
                continue
            normal_dur = float(a.duration or duration[aid])
            span = normal_dur - float(a.crash_time)
            if span <= 1e-12:
                continue
            slope = (float(a.crash_cost) - float(a.normal_cost)) / span
            candidates.append((slope, aid, min(1.0, room)))

        if not candidates:
            warnings.append(
                f"Cannot crash further to target {target}; stopped at duration {t}"
            )
            infeasible = True
            break

        candidates.sort(key=lambda x: (x[0], x[1]))
        slope, aid, amount = candidates[0]
        duration[aid] -= amount
        cost_inc = slope * amount
        total_cost += cost_inc
        step_i += 1
        steps.append(
            IterationStep(
                index=step_i,
                method="crash",
                title=f"Acelerar {aid} en {amount}",
                tableau=None,
                meta={
                    "activity": aid,
                    "amount": amount,
                    "slope": slope,
                    "cost_increment": cost_inc,
                    "project_duration_before": t,
                },
            )
        )
        if step_i > 500:
            warnings.append("Se alcanzó el límite de iteraciones de aceleración")
            infeasible = True
            break

    return duration, total_cost, steps, warnings, infeasible


def _topo_sort(acts: dict[str, Activity]) -> list[str]:
    indeg = {aid: 0 for aid in acts}
    succ: dict[str, list[str]] = defaultdict(list)
    for a in acts.values():
        for p in a.predecessors:
            succ[p].append(a.id)
            indeg[a.id] += 1
    q = deque(sorted([aid for aid, d in indeg.items() if d == 0]))
    order: list[str] = []
    while q:
        u = q.popleft()
        order.append(u)
        for v in sorted(succ[u]):
            indeg[v] -= 1
            if indeg[v] == 0:
                q.append(v)
    if len(order) != len(acts):
        raise PertCpmError("cycle detected in activity network")
    return order


def _primary_critical_path(
    acts: dict[str, Activity],
    successors: dict[str, list[str]],
    critical: dict[str, bool],
    order: list[str],
) -> list[str]:
    starts = [aid for aid in order if critical[aid] and not acts[aid].predecessors]
    if not starts:
        starts = [aid for aid in order if critical[aid]]
    best: list[str] | None = None

    def dfs(path: list[str]) -> None:
        nonlocal best
        u = path[-1]
        crit_succ = [v for v in successors[u] if critical[v]]
        if not crit_succ:
            if best is None or path < best:
                best = list(path)
            return
        for v in sorted(crit_succ):
            dfs([*path, v])

    for s in sorted(starts):
        dfs([s])
    return best or []


def _count_critical_paths(
    acts: dict[str, Activity],
    successors: dict[str, list[str]],
    critical: dict[str, bool],
) -> int:
    starts = [aid for aid, a in acts.items() if critical[aid] and not a.predecessors]
    count = 0

    def dfs(u: str) -> None:
        nonlocal count
        crit_succ = [v for v in successors[u] if critical[v]]
        if not crit_succ:
            count += 1
            return
        for v in crit_succ:
            dfs(v)

    for s in starts:
        dfs(s)
    return count
