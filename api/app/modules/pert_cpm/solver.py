from __future__ import annotations

import logging
import math
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
        raise PertCpmError("Agrega al menos una actividad.")

    acts = {a.id: a for a in req.activities}
    if len(acts) != len(req.activities):
        raise PertCpmError("Hay actividades con el mismo nombre.")

    for a in req.activities:
        for p in a.predecessors:
            if p not in acts:
                raise PertCpmError(f"La actividad «{a.id}» depende de «{p}», que no existe.")

    duration: dict[str, float] = {}
    te: dict[str, float] = {}
    variance: dict[str, float] = {}
    for a in req.activities:
        if req.mode == "cpm":
            if a.duration is None or not math.isfinite(a.duration) or a.duration < 0:
                raise PertCpmError(f"La actividad «{a.id}» necesita una duración mayor o igual que 0.")
            duration[a.id] = float(a.duration)
            te[a.id] = float(a.duration)
            variance[a.id] = 0.0
        else:
            if a.a is None or a.m is None or a.b is None:
                raise PertCpmError(
                    f"La actividad «{a.id}» necesita los tres tiempos de PERT: optimista (a), más probable (m) y pesimista (b)."
                )
            if a.a < 0 or not (a.a <= a.m <= a.b):
                raise PertCpmError(f"En «{a.id}» los tiempos deben cumplir 0 ≤ a ≤ m ≤ b.")
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
            raise PertCpmError("La aceleración solo aplica en modo CPM.")
        target = req.crash_target
        if target is None or target < 0:
            raise PertCpmError("Indica una duración objetivo mayor o igual que 0 para la aceleración.")
        duration, total_crash_cost, crash_steps, warnings, crash_infeasible = _crash_project(
            acts, duration, target
        )

    order = _topo_sort(acts)
    sched = _schedule(acts, duration, order)
    project_duration = sched["project_duration"]
    if req.crash and req.crash_target is not None and project_duration > req.crash_target + 1e-6:
        crash_infeasible = True
        if not warnings:
            warnings.append(
                f"No se puede llegar a la duración objetivo {_fmt_qty(req.crash_target)}. "
                f"La menor duración alcanzable es {_fmt_qty(project_duration)}."
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

    enumerated = _enumerate_critical_paths(acts, successors, critical, order)
    critical_path = _pick_critical_path(enumerated["paths"], variance)
    if enumerated["paths"] and (len(enumerated["paths"]) > 1 or enumerated["truncated"]):
        if enumerated["truncated"]:
            warnings.append(
                "Hay muchas rutas críticas; se listan solo algunas. En PERT, la probabilidad usa la de mayor varianza entre las revisadas."
            )
        elif req.mode == "pert":
            warnings.append("Hay varias rutas críticas. La probabilidad de PERT usa la de mayor varianza.")
        else:
            warnings.append("Hay varias rutas críticas. Se muestra la primera en orden alfabético.")

    if req.mode == "pert":
        schedule_columns = [
            "actividad",
            "optimista",
            "probable",
            "pesimista",
            "te",
            "varianza",
            "es",
            "ef",
            "ls",
            "lf",
            "holgura",
            "critica",
        ]
        schedule_rows = []
        for aid in order:
            act = acts[aid]
            schedule_rows.append(
                [
                    aid,
                    act.a,
                    act.m,
                    act.b,
                    te[aid],
                    variance[aid],
                    es[aid],
                    ef[aid],
                    ls[aid],
                    lf[aid],
                    slack[aid],
                    critical[aid],
                ]
            )
    else:
        schedule_columns = ["actividad", "duracion", "es", "ef", "ls", "lf", "holgura", "critica"]
        schedule_rows = [
            [aid, duration[aid], es[aid], ef[aid], ls[aid], lf[aid], slack[aid], critical[aid]] for aid in order
        ]

    gantt_rows = [[aid, es[aid], ef[aid], slack[aid], critical[aid]] for aid in order]

    metrics: dict[str, float] = {"project_duration": project_duration}
    if not enumerated["truncated"]:
        metrics["critical_path_count"] = float(len(enumerated["paths"]))
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
                raise PertCpmError("La probabilidad debe estar entre 0 y 1, sin incluir los extremos.")
            z = float(norm.ppf(p))
            metrics["target_probability"] = p
            metrics["duration_for_probability"] = float(project_te + z * project_std)

    if req.crash:
        metrics["crash_total_cost"] = total_crash_cost
        metrics["crash_target"] = float(req.crash_target or 0.0)
        normal_cost = sum(float(a.normal_cost or 0.0) for a in req.activities)
        metrics["normal_cost_sum"] = normal_cost
        metrics["project_cost"] = normal_cost + total_crash_cost

    nodes = [
        {
            "id": aid,
            "critical": critical[aid],
            "duration": duration[aid],
            "es": es[aid],
            "ef": ef[aid],
            "ls": ls[aid],
            "lf": lf[aid],
            "slack": slack[aid],
        }
        for aid in order
    ]
    edges = []
    for a in req.activities:
        for p in a.predecessors:
            edges.append({"source": p, "target": a.id, "critical": critical[p] and critical[a.id]})

    tables = [
        NamedTable(
            name="schedule",
            columns=schedule_columns,
            rows=schedule_rows,
        ),
        NamedTable(
            name="critical_path",
            columns=["orden", "actividad"],
            rows=[[i + 1, aid] for i, aid in enumerate(critical_path)],
        ),
        NamedTable(
            name="gantt",
            columns=["actividad", "inicio", "fin", "holgura", "critica"],
            rows=gantt_rows,
        ),
    ]
    if len(enumerated["paths"]) > 1:
        tables.append(
            NamedTable(
                name="critical_paths",
                columns=["ruta", "duracion", "varianza"],
                rows=[
                    [
                        " → ".join(path),
                        sum(duration[aid] for aid in path),
                        sum(variance[aid] for aid in path),
                    ]
                    for path in enumerated["paths"]
                ],
            )
        )
    if req.crash:
        tables.append(
            NamedTable(
                name="durations_after_crash",
                columns=["actividad", "normal", "acelerada", "recorte"],
                rows=[
                    [
                        aid,
                        float(acts[aid].duration if acts[aid].duration is not None else duration[aid]),
                        duration[aid],
                        float(acts[aid].duration if acts[aid].duration is not None else duration[aid]) - duration[aid],
                    ]
                    for aid in order
                ],
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
            title="Red del proyecto (actividades en nodos)",
            subtitle="Cada nodo muestra ES, EF, LS, LF y duración. Magenta = ruta crítica.",
        )

    status = SolveStatus.infeasible if crash_infeasible else SolveStatus.ok
    result = ModuleResult(
        module="pert_cpm",
        status=status,
        solution=SolutionBlock(
            variables={aid: duration[aid] for aid in order},
            objective_value=project_duration,
            objective_sense=None,
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


def _fmt_qty(n: float) -> str:
    if abs(n - round(n)) < 1e-8:
        return str(int(round(n)))
    return str(round(n * 10000) / 10000)


def _crash_slope(a: Activity, duration: float) -> float | None:
    if a.crash_time is None or a.normal_cost is None or a.crash_cost is None:
        return None
    normal = float(a.duration if a.duration is not None else duration)
    span = normal - float(a.crash_time)
    if span <= 1e-12:
        return None
    return (float(a.crash_cost) - float(a.normal_cost)) / span


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
        has_any = a.crash_time is not None or a.normal_cost is not None or a.crash_cost is not None
        if not has_any:
            continue
        if a.crash_time is None or a.normal_cost is None or a.crash_cost is None:
            raise PertCpmError(
                f"La actividad «{a.id}» necesita tiempo crash, costo normal y costo crash para poder acelerarse."
            )
        normal = float(a.duration if a.duration is not None else duration.get(a.id, 0.0))
        if a.crash_time < 0 or a.crash_time > normal + 1e-9:
            raise PertCpmError(f"En «{a.id}» el tiempo crash debe estar entre 0 y la duración normal.")
        if a.crash_cost < a.normal_cost:
            raise PertCpmError(f"En «{a.id}» el costo crash debe ser mayor o igual que el costo normal.")

    step_i = 0
    while True:
        sched = _schedule(acts, duration, order)
        t = float(sched["project_duration"])
        critical: dict[str, bool] = sched["critical"]
        successors: dict[str, list[str]] = sched["successors"]
        if t <= target + 1e-9:
            break
        slopes: dict[str, float] = {}
        for aid, a in acts.items():
            if not critical[aid]:
                continue
            slope = _crash_slope(a, duration[aid])
            if slope is None or a.crash_time is None:
                continue
            if duration[aid] - float(a.crash_time) <= 1e-12:
                continue
            slopes[aid] = slope
        cut = _cheapest_critical_cut(acts, critical, successors, slopes)
        if not cut:
            warnings.append(
                f"No se puede llegar a la duración objetivo {_fmt_qty(target)}. La menor duración alcanzable es {_fmt_qty(t)}."
            )
            infeasible = True
            break
        avoiding = _longest_complete_path_avoiding(acts, duration, order, set(cut))
        slack_limit = float("inf") if avoiding < 0 else t - avoiding
        room = min(duration[aid] - float(acts[aid].crash_time or duration[aid]) for aid in cut)
        amount = min(room, t - target, slack_limit)
        if amount <= 1e-8:
            warnings.append(
                f"No se puede llegar a la duración objetivo {_fmt_qty(target)}. La menor duración alcanzable es {_fmt_qty(t)}."
            )
            infeasible = True
            break
        cost_inc = 0.0
        for aid in cut:
            duration[aid] -= amount
            cost_inc += slopes.get(aid, 0.0) * amount
        total_cost += cost_inc
        step_i += 1
        names = cut[0] if len(cut) == 1 else " y ".join(cut)
        steps.append(
            IterationStep(
                index=step_i,
                method="crash",
                title=f"Acelerar {names} en {_fmt_qty(amount)} (costo +{_fmt_qty(cost_inc)})",
                tableau=None,
                meta={
                    "activity": ", ".join(cut),
                    "amount": amount,
                    "slope": slopes.get(cut[0], 0.0) if len(cut) == 1 else cost_inc / amount,
                    "cost_increment": cost_inc,
                    "project_duration_before": t,
                },
            )
        )
        if step_i > 500:
            warnings.append("Se alcanzó el límite de iteraciones de aceleración.")
            infeasible = True
            break

    return duration, total_cost, steps, warnings, infeasible


def _cheapest_critical_cut(
    acts: dict[str, Activity],
    critical: dict[str, bool],
    successors: dict[str, list[str]],
    slopes: dict[str, float],
) -> list[str] | None:
    crit = [aid for aid in acts if critical[aid]]
    if not crit:
        return None
    crit_set = set(crit)
    inf = 1e15
    graph: dict[str, list[list]] = {}

    def add_node(node: str) -> None:
        graph.setdefault(node, [])

    def add_edge(u: str, v: str, cap: float) -> None:
        add_node(u)
        add_node(v)
        fu = graph[u]
        fv = graph[v]
        fu.append([v, len(fv), cap])
        fv.append([u, len(fu) - 1, 0.0])

    source, sink = "__s", "__t"
    add_node(source)
    add_node(sink)
    for aid in crit:
        slope = slopes.get(aid)
        add_edge(f"{aid}#in", f"{aid}#out", inf if slope is None else max(0.0, slope))
        preds = [p for p in acts[aid].predecessors if p in crit_set]
        if not preds:
            add_edge(source, f"{aid}#in", inf)
        for pred in preds:
            add_edge(f"{pred}#out", f"{aid}#in", inf)
        succs = [s for s in successors.get(aid, []) if s in crit_set]
        if not succs:
            add_edge(f"{aid}#out", sink, inf)

    flow = _max_flow(graph, source, sink)
    if flow >= inf / 10:
        return None
    reach = _residual_reachable(graph, source)
    cut = sorted(aid for aid in crit if f"{aid}#in" in reach and f"{aid}#out" not in reach and aid in slopes)
    return cut or None


def _max_flow(graph: dict[str, list[list]], source: str, sink: str) -> float:
    flow = 0.0
    guard_limit = len(graph) * len(graph) + 5
    for _ in range(guard_limit):
        prev: dict[str, tuple[str, int]] = {source: (source, -1)}
        queue = deque([source])
        found = False
        while queue:
            u = queue.popleft()
            if u == sink:
                found = True
                break
            for ei, edge in enumerate(graph.get(u, [])):
                if edge[2] <= 1e-12 or edge[0] in prev:
                    continue
                prev[edge[0]] = (u, ei)
                queue.append(edge[0])
        if not found or sink not in prev:
            break
        amount = float("inf")
        v = sink
        while v != source:
            node, ei = prev[v]
            amount = min(amount, graph[node][ei][2])
            v = node
        v = sink
        while v != source:
            node, ei = prev[v]
            edge = graph[node][ei]
            edge[2] -= amount
            graph[edge[0]][edge[1]][2] += amount
            v = node
        flow += amount
    return flow


def _residual_reachable(graph: dict[str, list[list]], source: str) -> set[str]:
    seen = {source}
    queue = deque([source])
    while queue:
        u = queue.popleft()
        for edge in graph.get(u, []):
            if edge[2] <= 1e-12 or edge[0] in seen:
                continue
            seen.add(edge[0])
            queue.append(edge[0])
    return seen


def _longest_complete_path_avoiding(
    acts: dict[str, Activity],
    duration: dict[str, float],
    order: list[str],
    avoid: set[str],
) -> float:
    best: dict[str, float] = {}
    successors: dict[str, list[str]] = defaultdict(list)
    for a in acts.values():
        for p in a.predecessors:
            successors[p].append(a.id)
    for aid in order:
        if aid in avoid:
            continue
        preds = acts[aid].predecessors
        if not preds:
            best[aid] = duration[aid]
            continue
        reachable = [p for p in preds if p in best]
        if not reachable:
            continue
        best[aid] = duration[aid] + max(best[p] for p in reachable)
    longest = -1.0
    found = False
    for aid, length in best.items():
        if successors[aid]:
            continue
        found = True
        longest = max(longest, length)
    return longest if found else -1.0


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
        raise PertCpmError("Hay un ciclo en la red de actividades.")
    return order


def _enumerate_critical_paths(
    acts: dict[str, Activity],
    successors: dict[str, list[str]],
    critical: dict[str, bool],
    order: list[str],
) -> dict:
    limit = 24
    paths: list[list[str]] = []
    truncated = False
    visits = 0
    starts = [aid for aid in order if critical[aid] and not any(critical.get(p) for p in acts[aid].predecessors)]
    if not starts:
        starts = [aid for aid in order if critical[aid]]

    def dfs(path: list[str]) -> None:
        nonlocal truncated, visits
        if truncated:
            return
        visits += 1
        if visits > 4000 or len(paths) >= limit:
            truncated = True
            return
        nxt = sorted(v for v in successors.get(path[-1], []) if critical[v])
        if not nxt:
            paths.append(list(path))
            return
        for v in nxt:
            dfs([*path, v])

    for start in sorted(starts):
        dfs([start])
    return {"paths": paths, "truncated": truncated}


def _pick_critical_path(paths: list[list[str]], variance: dict[str, float]) -> list[str]:
    if not paths:
        return []

    def score(path: list[str]) -> float:
        return sum(variance.get(aid, 0.0) for aid in path)

    best = paths[0]
    best_var = score(best)
    best_key = "\0".join(best)
    for path in paths[1:]:
        var = score(path)
        key = "\0".join(path)
        if var > best_var + 1e-12 or (abs(var - best_var) <= 1e-12 and key < best_key):
            best = path
            best_var = var
            best_key = key
    return best
