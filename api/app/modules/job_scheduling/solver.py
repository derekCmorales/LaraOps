from __future__ import annotations

import logging

from app.modules.job_scheduling.models import JobSchedulingRequest
from app.schemas.common import SolveStatus
from app.schemas.result import GraphGantt, ModuleResult, NamedTable, SolutionBlock

logger = logging.getLogger(__name__)


def solve(req: JobSchedulingRequest) -> ModuleResult:
    jobs = list(req.jobs)
    if req.rule == "spt":
        seq = sorted(jobs, key=lambda j: sum(j.times))
    elif req.rule == "edd":
        seq = sorted(jobs, key=lambda j: j.due_date if j.due_date is not None else float("inf"))
    else:
        # Johnson's rule for 2 machines
        if any(len(j.times) != 2 for j in jobs):
            raise ValueError("Johnson requiere exactamente 2 máquinas por trabajo")
        left = sorted([j for j in jobs if j.times[0] <= j.times[1]], key=lambda j: j.times[0])
        right = sorted(
            [j for j in jobs if j.times[0] > j.times[1]], key=lambda j: j.times[1], reverse=True
        )
        seq = left + right

    n_machines = max(len(j.times) for j in seq)
    machine_ready = [0.0] * n_machines
    bars = []
    completion: dict[str, float] = {}
    flow_sum = 0.0
    tardiness_sum = 0.0
    makespan = 0.0
    rows = []

    for job in seq:
        start = machine_ready[0]
        t = start
        for m, pt in enumerate(job.times):
            t = max(t, machine_ready[m])
            bars.append(
                {"id": f"{job.id}_M{m+1}", "job": job.id, "machine": m + 1, "start": t, "end": t + pt}
            )
            t = t + pt
            machine_ready[m] = t
        completion[job.id] = t
        flow_sum += t - start
        makespan = max(makespan, t)
        tard = max(0.0, t - job.due_date) if job.due_date is not None else 0.0
        tardiness_sum += tard
        rows.append([job.id, start, t, tard])

    metrics = {
        "makespan": makespan,
        "mean_flow_time": flow_sum / len(seq),
        "total_tardiness": tardiness_sum,
        "n_jobs": float(len(seq)),
    }
    return ModuleResult(
        module="job_scheduling",
        status=SolveStatus.ok,
        solution=SolutionBlock(
            variables={j.id: float(i) for i, j in enumerate(seq)},
            objective_value=makespan,
            objective_sense="min",
            metrics=metrics,
        ),
        graph=GraphGantt(
            type="gantt",
            bars=[{"id": b["id"], "start": b["start"], "end": b["end"], "critical": False} for b in bars],
            title="Diagrama de Gantt de trabajos",
            subtitle=f"Regla {req.rule.upper()} · tiempo total = {makespan:.2f}",
            x_label="Tiempo",
        ),
        tables=[
            NamedTable(name="sequence", columns=["orden", "trabajo"], rows=[[i, j.id] for i, j in enumerate(seq)]),
            NamedTable(name="jobs", columns=["trabajo", "inicio", "fin", "retraso"], rows=rows),
        ],
        warnings=[],
    )
