from __future__ import annotations

import logging

import numpy as np
from scipy.optimize import minimize

from app.modules.quadratic_programming.graph_contour import build_qp_contour_graph
from app.modules.quadratic_programming.models import QuadraticProgrammingRequest
from app.schemas.common import SolveStatus
from app.schemas.result import ModuleResult, NamedTable, SolutionBlock

logger = logging.getLogger(__name__)


def solve(req: QuadraticProgrammingRequest) -> ModuleResult:
    Q = np.asarray(req.Q, dtype=float)
    c = np.asarray(req.c, dtype=float)
    n = len(c)
    if Q.shape != (n, n):
        raise ValueError("Q must be n×n matching c")
    names = req.variable_names or [f"x{i+1}" for i in range(n)]
    sign = 1.0 if req.sense == "min" else -1.0

    def fun(x: np.ndarray) -> float:
        return float(sign * (0.5 * x @ Q @ x + c @ x))

    def jac(x: np.ndarray) -> np.ndarray:
        return sign * (Q @ x + c)

    constraints = []
    if req.A_ub and req.b_ub:
        A = np.asarray(req.A_ub, dtype=float)
        b = np.asarray(req.b_ub, dtype=float)

        def cons_fun(x: np.ndarray, A=A, b=b) -> np.ndarray:
            return b - A @ x

        constraints.append({"type": "ineq", "fun": cons_fun})

    bounds = req.bounds or [(0.0, None)] * n
    x0 = np.array([(lo if lo is not None else 0.0) for lo, _ in bounds], dtype=float)

    res = minimize(fun, x0, jac=jac, bounds=bounds, constraints=constraints, method="SLSQP")
    if not res.success:
        return ModuleResult(
            module="quadratic_programming",
            status=SolveStatus.infeasible,
            solution=SolutionBlock(variables={n: 0.0 for n in names}, metrics={}),
            warnings=[res.message],
        )

    x = res.x
    obj = float(0.5 * x @ Q @ x + c @ x)
    if req.sense == "max":
        obj = -obj
    variables = {names[i]: float(x[i]) for i in range(n)}
    graph = None
    if req.include_graph and n == 2:
        graph = build_qp_contour_graph(req, variables, obj)

    return ModuleResult(
        module="quadratic_programming",
        status=SolveStatus.optimal,
        solution=SolutionBlock(
            variables=variables,
            objective_value=obj,
            objective_sense=req.sense,
            metrics={"kkt_grad_norm": float(np.linalg.norm(jac(x)))},
        ),
        graph=graph,
        tables=[
            NamedTable(
                name="solution",
                columns=["variable", "valor"],
                rows=[[k, v] for k, v in variables.items()],
            )
        ],
        warnings=[],
    )
