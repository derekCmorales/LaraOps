from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.cors import allow_origin_regex, allow_origins
from app.routers import (
    acceptance_sampling,
    aggregate_planning,
    assignment,
    breakeven,
    decision_analysis,
    dynamic_programming,
    eoq,
    facility_location,
    forecasting,
    game_theory,
    goal_programming,
    health,
    ilp,
    inventory,
    job_scheduling,
    lp,
    markov,
    mrp,
    networks,
    nonlinear_programming,
    pert_cpm,
    quadratic_programming,
    quality_control,
    queuing_simulation,
    queues,
    statistics,
    transport,
)

app = FastAPI(title="LaraOps API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=allow_origins(),
    allow_origin_regex=allow_origin_regex(),
    allow_methods=["*"],
    allow_headers=["*"],
)

ROUTES = [
    (eoq, "/api/v1/modules/eoq", "eoq"),
    (lp, "/api/v1/modules/lp", "lp"),
    (ilp, "/api/v1/modules/ilp", "ilp"),
    (transport, "/api/v1/modules/transport", "transport"),
    (assignment, "/api/v1/modules/assignment", "assignment"),
    (pert_cpm, "/api/v1/modules/pert_cpm", "pert_cpm"),
    (queues, "/api/v1/modules/queues", "queues"),
    (inventory, "/api/v1/modules/inventory", "inventory"),
    (forecasting, "/api/v1/modules/forecasting", "forecasting"),
    (decision_analysis, "/api/v1/modules/decision_analysis", "decision_analysis"),
    (game_theory, "/api/v1/modules/game_theory", "game_theory"),
    (networks, "/api/v1/modules/networks", "networks"),
    (markov, "/api/v1/modules/markov", "markov"),
    (quality_control, "/api/v1/modules/quality_control", "quality_control"),
    (goal_programming, "/api/v1/modules/goal_programming", "goal_programming"),
    (dynamic_programming, "/api/v1/modules/dynamic_programming", "dynamic_programming"),
    (mrp, "/api/v1/modules/mrp", "mrp"),
    (breakeven, "/api/v1/modules/breakeven", "breakeven"),
    (statistics, "/api/v1/modules/statistics", "statistics"),
    (acceptance_sampling, "/api/v1/modules/acceptance_sampling", "acceptance_sampling"),
    (queuing_simulation, "/api/v1/modules/queuing_simulation", "queuing_simulation"),
    (quadratic_programming, "/api/v1/modules/quadratic_programming", "quadratic_programming"),
    (nonlinear_programming, "/api/v1/modules/nonlinear_programming", "nonlinear_programming"),
    (job_scheduling, "/api/v1/modules/job_scheduling", "job_scheduling"),
    (aggregate_planning, "/api/v1/modules/aggregate_planning", "aggregate_planning"),
    (facility_location, "/api/v1/modules/facility_location", "facility_location"),
]

app.include_router(health.router)
for mod, prefix, tag in ROUTES:
    app.include_router(mod.router, prefix=prefix, tags=[tag])
