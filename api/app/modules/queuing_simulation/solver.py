from __future__ import annotations

import logging
import random
from collections import deque

from app.modules.queuing_simulation.models import QueuingSimulationRequest
from app.schemas.common import SolveStatus
from app.schemas.result import GraphXY, ModuleResult, NamedTable, SolutionBlock

logger = logging.getLogger(__name__)


def solve(req: QueuingSimulationRequest) -> ModuleResult:
    rng = random.Random(req.seed)
    t = 0.0
    next_arrival = rng.expovariate(req.arrival_rate)
    server_free = [0.0] * req.num_servers
    queue: deque[float] = deque()  # arrival times waiting
    served = 0
    rejected = 0
    wait_sum = 0.0
    system_time_sum = 0.0
    busy_time = 0.0
    area_queue = 0.0
    area_system = 0.0
    last_t = 0.0
    samples_t: list[float] = []
    samples_q: list[float] = []

    def in_system() -> int:
        busy = sum(1 for f in server_free if f > t)
        return busy + len(queue)

    while t < req.simulation_time:
        next_dep = min((f for f in server_free if f > t), default=float("inf"))
        next_event = min(next_arrival, next_dep)

        # Accumulate areas
        dt = next_event - last_t
        if dt > 0 and last_t >= req.warmup:
            area_queue += len(queue) * dt
            area_system += in_system() * dt
            busy_time += sum(1 for f in server_free if f > last_t) * dt

        t = next_event
        last_t = t
        if t > req.simulation_time:
            break

        if abs(t - next_arrival) < 1e-12 or t == next_arrival:
            # arrival
            if req.capacity is not None and in_system() >= req.capacity:
                rejected += 1
            else:
                # try assign server
                assigned = False
                for i, free_at in enumerate(server_free):
                    if free_at <= t:
                        service = rng.expovariate(req.service_rate)
                        start = t
                        server_free[i] = start + service
                        if t >= req.warmup:
                            wait_sum += 0.0
                            system_time_sum += service
                            served += 1
                        assigned = True
                        break
                if not assigned:
                    queue.append(t)
            next_arrival = t + rng.expovariate(req.arrival_rate)
        else:
            # departure — free a server that finishes now, pull from queue
            for i, free_at in enumerate(server_free):
                if abs(free_at - t) < 1e-9 or free_at == t:
                    if queue:
                        arr = queue.popleft()
                        service = rng.expovariate(req.service_rate)
                        wait = t - arr
                        if t >= req.warmup:
                            wait_sum += wait
                            system_time_sum += wait + service
                            served += 1
                        server_free[i] = t + service
                    else:
                        server_free[i] = t  # idle
                    break

        if int(t) != int(last_t) or not samples_t:
            samples_t.append(t)
            samples_q.append(float(len(queue)))

    horizon = max(req.simulation_time - req.warmup, 1e-9)
    metrics = {
        "served": float(served),
        "rejected": float(rejected),
        "Lq": area_queue / horizon,
        "L": area_system / horizon,
        "Wq": wait_sum / served if served else 0.0,
        "W": system_time_sum / served if served else 0.0,
        "utilization": busy_time / (horizon * req.num_servers),
    }

    variables = {k: float(v) for k, v in metrics.items()}

    result = ModuleResult(
        module="queuing_simulation",
        status=SolveStatus.ok,
        solution=SolutionBlock(variables=variables, metrics=metrics),
        graph=GraphXY(
            type="xy",
            series=[{"name": "longitud_cola", "x": samples_t, "y": samples_q}],
            x_label="Tiempo simulado",
            y_label="Clientes en cola",
            title="Evolución de la longitud de cola",
            subtitle=f"Servidores = {req.num_servers} · horizonte = {req.simulation_time}",
        ),
        tables=[
            NamedTable(
                name="resumen",
                columns=["métrica", "valor"],
                rows=[[k, v] for k, v in metrics.items()],
            )
        ],
        warnings=["Simulación de eventos discretos tipo M/M/s (aproximada; una réplica)."],
    )
    logger.info("module=%s status=%s", result.module, result.status.value)
    return result
