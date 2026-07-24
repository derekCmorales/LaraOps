from __future__ import annotations

from app.modules.queuing_simulation.models import QueuingSimulationRequest
from app.modules.queuing_simulation.solver import solve as solve_qss
from app.modules.quadratic_programming.models import QuadraticProgrammingRequest
from app.modules.quadratic_programming.solver import solve as solve_qp
from app.modules.nonlinear_programming.models import NonlinearProgrammingRequest
from app.modules.nonlinear_programming.solver import solve as solve_nlp
from app.modules.job_scheduling.models import Job, JobSchedulingRequest
from app.modules.job_scheduling.solver import solve as solve_job
from app.modules.aggregate_planning.models import AggregatePlanningRequest
from app.modules.aggregate_planning.solver import solve as solve_ap
from app.modules.facility_location.models import FacilityLocationRequest
from app.modules.facility_location.solver import solve as solve_fl
from app.modules.acceptance_sampling.models import AcceptanceSamplingRequest
from app.modules.acceptance_sampling.solver import solve as solve_asa
from app.schemas.common import SolveStatus
from tests.conftest import assert_allclose


def test_queuing_simulation_runs():
    r = solve_qss(
        QueuingSimulationRequest(
            arrival_rate=4, service_rate=5, num_servers=1, simulation_time=200, warmup=20, seed=1
        )
    )
    assert r.status == SolveStatus.ok
    assert r.solution.metrics["served"] > 0


def test_quadratic_programming():
    # min x^2 + y^2  (Q=2I so 0.5 x'Qx = x'x)
    r = solve_qp(
        QuadraticProgrammingRequest(
            Q=[[2, 0], [0, 2]],
            c=[0, 0],
            bounds=[(-1, 1), (-1, 1)],
            include_graph=True,
        )
    )
    assert r.status == SolveStatus.optimal
    assert_allclose(r.solution.variables["x1"], 0.0, atol=1e-4)
    assert_allclose(r.solution.variables["x2"], 0.0, atol=1e-4)
    assert r.graph is not None
    assert len(r.graph.series) >= 1


def test_nonlinear_programming():
    r = solve_nlp(
        NonlinearProgrammingRequest(
            quadratic_diag=[1, 1],
            linear=[0, 0],
            x0=[1.0, -1.0],
        )
    )
    assert r.status == SolveStatus.optimal
    assert abs(r.solution.variables["x1"]) < 1e-3


def test_job_scheduling_spt():
    r = solve_job(
        JobSchedulingRequest(
            rule="spt",
            jobs=[
                Job(id="A", times=[5], due_date=10),
                Job(id="B", times=[2], due_date=8),
                Job(id="C", times=[4], due_date=12),
            ],
        )
    )
    assert r.status == SolveStatus.ok
    assert r.solution.metrics["makespan"] == 11.0


def test_aggregate_planning_mixed():
    r = solve_ap(
        AggregatePlanningRequest(
            demand=[100, 120, 90],
            initial_workforce=10,
            production_per_worker=10,
            cost_hire=100,
            cost_fire=150,
            cost_hold=2,
            cost_shortage=20,
            strategy="mixed",
        )
    )
    assert r.status == SolveStatus.optimal
    assert r.solution.objective_value is not None


def test_facility_center_of_gravity():
    r = solve_fl(
        FacilityLocationRequest(
            mode="center_of_gravity",
            points=[
                {"name": "A", "x": 0, "y": 0, "volume": 10},
                {"name": "B", "x": 10, "y": 0, "volume": 10},
            ],
        )
    )
    assert r.status == SolveStatus.ok
    assert_allclose(r.solution.variables["x"], 5.0, atol=1e-6)


def test_asa_design():
    r = solve_asa(
        AcceptanceSamplingRequest(
            plan="design",
            N=1000,
            AQL=0.01,
            LTPD=0.08,
            producer_risk=0.05,
            consumer_risk=0.10,
        )
    )
    assert r.status == SolveStatus.ok
    assert r.solution.variables["n"] >= 1
    assert "c" in r.solution.variables
