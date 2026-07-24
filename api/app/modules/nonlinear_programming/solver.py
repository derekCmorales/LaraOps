from __future__ import annotations

import logging

import numpy as np
from scipy.optimize import minimize

from app.modules.nonlinear_programming.models import NonlinearProgrammingRequest
from app.schemas.common import SolveStatus
from app.schemas.result import GraphXY, ModuleResult, NamedTable, SolutionBlock

logger = logging.getLogger(__name__)


def solve(req: NonlinearProgrammingRequest) -> ModuleResult:
    q = np.asarray(req.quadratic_diag, dtype=float)
    lin = np.asarray(req.linear, dtype=float)
    x0 = np.asarray(req.x0, dtype=float)
    n = len(x0)
    if len(q) != n or len(lin) != n:
        raise ValueError("quadratic_diag, linear, x0 must have same length")
    names = req.variable_names or [f"x{i+1}" for i in range(n)]
    sign = 1.0 if req.sense == "min" else -1.0

    path: list[np.ndarray] = [x0.copy()]

    def fun(x: np.ndarray) -> float:
        return float(sign * (np.sum(q * x * x) + np.sum(lin * x)))

    def callback(xk: np.ndarray) -> None:
        path.append(xk.copy())

    bounds = req.bounds or [(None, None)] * n
    constraints = []
    if req.A_ub and req.b_ub:
        A = np.asarray(req.A_ub, dtype=float)
        b = np.asarray(req.b_ub, dtype=float)
        if A.shape[0] != len(b) or A.shape[1] != n:
            raise ValueError("A_ub must be m x n and b_ub length m")
        constraints.append({"type": "ineq", "fun": lambda x, A=A, b=b: b - A @ x})
    res = minimize(fun, x0, method="SLSQP" if constraints else "L-BFGS-B", bounds=bounds, constraints=constraints, callback=callback)
    x = res.x
    obj = float(np.sum(q * x * x) + np.sum(lin * x))
    variables = {names[i]: float(x[i]) for i in range(n)}

    series = []
    if n >= 1:
        series.append(
            {
                "name": "x1_path",
                "x": list(range(len(path))),
                "y": [float(p[0]) for p in path],
            }
        )

    return ModuleResult(
        module="nonlinear_programming",
        status=SolveStatus.optimal if res.success else SolveStatus.infeasible,
        solution=SolutionBlock(
            variables=variables,
            objective_value=obj if req.sense == "min" else -obj,
            objective_sense=req.sense,
            metrics={"nit": float(res.nit), "success": 1.0 if res.success else 0.0},
        ),
        graph=GraphXY(
            type="xy",
            series=series,
            x_label="Iteración",
            y_label="Valor de x₁",
            title="Trayectoria de convergencia",
            subtitle=f"Iteraciones = {res.nit}",
        )
        if series
        else None,
        tables=[
            NamedTable(
                name="solution",
                columns=["variable", "valor"],
                rows=[[k, v] for k, v in variables.items()],
            )
        ],
        warnings=[] if res.success else [res.message or "El optimizador no convergió"],
    )
