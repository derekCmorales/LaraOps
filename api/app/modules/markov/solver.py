from __future__ import annotations

import logging

import numpy as np

from app.modules.markov.models import MarkovRequest
from app.schemas.common import SolveStatus
from app.schemas.result import GraphNetwork, ModuleResult, NamedTable, SolutionBlock

logger = logging.getLogger(__name__)

_TOL = 1e-6


def solve(req: MarkovRequest) -> ModuleResult:
    n = len(req.states)
    P = np.array(req.transition, dtype=float)
    if P.shape != (n, n):
        raise ValueError("transition must be n x n")
    row_sums = P.sum(axis=1)
    bad_rows = [i for i in range(n) if abs(row_sums[i] - 1.0) > _TOL]
    if bad_rows:
        detail = ", ".join(f"{req.states[i]} (sum={row_sums[i]:g})" for i in bad_rows)
        raise ValueError(f"transition rows must sum to 1; offending rows: {detail}")
    if (P < -_TOL).any():
        raise ValueError("transition probabilities must be non-negative")

    if req.initial is None:
        pi0 = np.ones(n) / n
    else:
        if len(req.initial) != n:
            raise ValueError("initial length must match states")
        pi0 = np.array(req.initial, dtype=float)
        pi0 = pi0 / pi0.sum()

    if req.rewards is not None and len(req.rewards) != n:
        raise ValueError("rewards length must match states")

    warnings: list[str] = []

    # Steady state: pi P = pi, sum pi = 1
    A = P.T - np.eye(n)
    A[-1, :] = 1.0
    b = np.zeros(n)
    b[-1] = 1.0
    try:
        steady = np.linalg.solve(A, b)
    except np.linalg.LinAlgError:
        steady, *_ = np.linalg.lstsq(A, b, rcond=None)
        warnings.append(
            "La cadena puede no ser ergódica (sin estado estacionario único); se usa aproximación por mínimos cuadrados"
        )

    absorbing = [i for i in range(n) if P[i, i] > 1.0 - _TOL]
    transient = [i for i in range(n) if i not in absorbing]
    if absorbing and len(absorbing) > 1:
        warnings.append(
            "Se detectaron varios estados absorbentes: la distribución a largo plazo depende del estado inicial; "
            "consulte las probabilidades de absorción"
        )

    # Transient distribution pi(t) for t = 0..steps
    rows = []
    pi = pi0.copy()
    for t in range(req.steps + 1):
        rows.append([t, *[float(x) for x in pi]])
        pi = pi @ P

    n_power = req.n_power if req.n_power is not None else req.steps
    Pn = np.linalg.matrix_power(P, n_power)

    variables = {req.states[i]: float(steady[i]) for i in range(n)}
    metrics = {f"steady_{req.states[i]}": float(steady[i]) for i in range(n)}
    metrics["steps"] = float(req.steps)
    metrics["n_power"] = float(n_power)
    metrics["is_absorbing_chain"] = 1.0 if absorbing else 0.0
    metrics["num_absorbing_states"] = float(len(absorbing))

    tables = [
        NamedTable(name="transient", columns=["t", *req.states], rows=rows),
        NamedTable(
            name="steady_state",
            columns=["estado", "probabilidad"],
            rows=[[req.states[i], float(steady[i])] for i in range(n)],
        ),
        NamedTable(
            name="transition_power_n",
            columns=["estado", *req.states],
            rows=[[req.states[i], *[float(x) for x in Pn[i]]] for i in range(n)],
        ),
    ]

    if req.rewards is not None:
        long_run_reward = float(sum(steady[i] * req.rewards[i] for i in range(n)))
        metrics["long_run_expected_reward"] = long_run_reward
        tables.append(
            NamedTable(
                name="rewards",
                columns=["estado", "recompensa", "peso_estacionario", "contribución"],
                rows=[
                    [req.states[i], float(req.rewards[i]), float(steady[i]), float(steady[i] * req.rewards[i])]
                    for i in range(n)
                ],
            )
        )

    if absorbing and transient:
        Q = P[np.ix_(transient, transient)]
        R = P[np.ix_(transient, absorbing)]
        try:
            N = np.linalg.inv(np.eye(len(transient)) - Q)
        except np.linalg.LinAlgError as exc:
            raise ValueError("fundamental matrix (I-Q) is singular; check the transition matrix") from exc
        B = N @ R
        expected_steps = N @ np.ones(len(transient))

        transient_names = [req.states[i] for i in transient]
        absorbing_names = [req.states[i] for i in absorbing]

        tables.append(
            NamedTable(
                name="fundamental_matrix",
                columns=["estado", *transient_names],
                rows=[[transient_names[r], *[float(x) for x in N[r]]] for r in range(len(transient))],
            )
        )
        tables.append(
            NamedTable(
                name="absorption_probabilities",
                columns=["estado", *absorbing_names],
                rows=[[transient_names[r], *[float(x) for x in B[r]]] for r in range(len(transient))],
            )
        )
        tables.append(
            NamedTable(
                name="expected_steps_to_absorption",
                columns=["estado", "pasos_esperados"],
                rows=[[transient_names[r], float(expected_steps[r])] for r in range(len(transient))],
            )
        )
        for r, i in enumerate(transient):
            metrics[f"expected_steps_{req.states[i]}"] = float(expected_steps[r])

        if req.rewards is not None:
            reward_transient = np.array([req.rewards[i] for i in transient])
            expected_reward_to_absorption = N @ reward_transient
            tables.append(
                NamedTable(
                    name="expected_reward_to_absorption",
                    columns=["estado", "recompensa_esperada"],
                    rows=[
                        [transient_names[r], float(expected_reward_to_absorption[r])]
                        for r in range(len(transient))
                    ],
                )
            )

    graph = GraphNetwork(
        type="network",
        nodes=[{"id": req.states[i], "absorbing": i in absorbing} for i in range(n)],
        edges=[
            {"source": req.states[i], "target": req.states[j], "probability": float(P[i, j])}
            for i in range(n)
            for j in range(n)
            if P[i, j] > 1e-9
        ],
        title="Diagrama de estados de la cadena de Markov",
        subtitle="Las etiquetas en los arcos son probabilidades de transición",
    )

    result = ModuleResult(
        module="markov",
        status=SolveStatus.ok,
        solution=SolutionBlock(variables=variables, metrics=metrics),
        iterations=None,
        sensitivity=None,
        graph=graph,
        tables=tables,
        warnings=warnings,
    )
    logger.info("module=%s status=%s", result.module, result.status.value)
    return result
