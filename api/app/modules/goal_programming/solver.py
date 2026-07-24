from __future__ import annotations

import logging
from collections import defaultdict

import pulp

from app.modules.goal_programming.models import GoalProgrammingRequest
from app.modules.lp.models import ConstraintSense
from app.schemas.common import SolveStatus
from app.schemas.result import IterationStep, ModuleResult, NamedTable, SolutionBlock

logger = logging.getLogger(__name__)


def solve(req: GoalProgrammingRequest) -> ModuleResult:
    names = set()
    for g in req.goals:
        names.update(g.coeffs)
    for c in req.hard_constraints:
        names.update(c.coeffs)
    var_names = req.variable_names or sorted(names)

    # Group goals by priority (preemptive: P1 then P2 …)
    by_prio: dict[int, list] = defaultdict(list)
    for g in req.goals:
        by_prio[g.priority].append(g)
    priorities = sorted(by_prio.keys())

    x_vals: dict[str, float] = {n: 0.0 for n in var_names}
    d_pos_vals: dict[str, float] = {}
    d_neg_vals: dict[str, float] = {}
    iterations: list[IterationStep] = []
    frozen_dev: dict[str, float] = {}  # goal_id -> achieved unwanted weighted deviation

    for prio in priorities:
        goals = by_prio[prio]
        prob = pulp.LpProblem(f"gp_P{prio}", pulp.LpMinimize)
        x = {n: pulp.LpVariable(n, lowBound=0) for n in var_names}
        d_pos = {}
        d_neg = {}

        for g in req.goals:
            d_pos[g.id] = pulp.LpVariable(f"dplus_{g.id}", lowBound=0)
            d_neg[g.id] = pulp.LpVariable(f"dminus_{g.id}", lowBound=0)
            expr = pulp.lpSum(g.coeffs.get(n, 0.0) * x[n] for n in var_names)
            prob += expr + d_neg[g.id] - d_pos[g.id] == g.target, f"goal_{g.id}"

        for c in req.hard_constraints:
            expr = pulp.lpSum(c.coeffs.get(n, 0.0) * x[n] for n in var_names)
            if c.sense == ConstraintSense.le:
                prob += expr <= c.rhs, c.id
            elif c.sense == ConstraintSense.ge:
                prob += expr >= c.rhs, c.id
            else:
                prob += expr == c.rhs, c.id

        # Freeze higher-priority achievements
        for g_id, val in frozen_dev.items():
            g = next(gg for gg in req.goals if gg.id == g_id)
            # Keep weighted unwanted deviation at previous optimum
            prob += (
                g.weight_pos * d_pos[g.id] + g.weight_neg * d_neg[g.id] <= val + 1e-6,
                f"freeze_{g_id}",
            )

        obj_terms = [
            g.weight_pos * d_pos[g.id] + g.weight_neg * d_neg[g.id] for g in goals
        ]
        prob += pulp.lpSum(obj_terms)

        status = prob.solve(pulp.PULP_CBC_CMD(msg=False))
        if pulp.LpStatus[status] != "Optimal":
            return ModuleResult(
                module="goal_programming",
                status=SolveStatus.infeasible,
                solution=SolutionBlock(variables={n: 0.0 for n in var_names}, metrics={}),
                warnings=[f"Estado de PuLP en prioridad P{prio}: {pulp.LpStatus[status]}"],
                iterations=iterations or None,
                sensitivity=None,
                graph=None,
                tables=None,
            )

        x_vals = {n: float(pulp.value(x[n]) or 0.0) for n in var_names}
        for g in req.goals:
            d_pos_vals[g.id] = float(pulp.value(d_pos[g.id]) or 0.0)
            d_neg_vals[g.id] = float(pulp.value(d_neg[g.id]) or 0.0)

        level_obj = float(pulp.value(prob.objective) or 0.0)
        for g in goals:
            frozen_dev[g.id] = g.weight_pos * d_pos_vals[g.id] + g.weight_neg * d_neg_vals[g.id]

        tab_rows: list[list[float | str]] = [["Variable", "Valor"]]
        for n in var_names:
            tab_rows.append([n, float(x_vals[n])])
        for g in req.goals:
            tab_rows.append([f"d+_{g.id}", float(d_pos_vals[g.id])])
            tab_rows.append([f"d-_{g.id}", float(d_neg_vals[g.id])])

        iterations.append(
            IterationStep(
                index=prio,
                method="preemptive_gp",
                title=f"Prioridad P{prio} — desviación = {level_obj:.6g}",
                tableau=tab_rows,
                meta={
                    "priority": prio,
                    "objective": level_obj,
                    "goals": [g.id for g in goals],
                },
            )
        )

    variables = dict(x_vals)
    for g in req.goals:
        variables[f"d+_{g.id}"] = d_pos_vals[g.id]
        variables[f"d-_{g.id}"] = d_neg_vals[g.id]

    total_dev = sum(
        g.weight_pos * d_pos_vals[g.id] + g.weight_neg * d_neg_vals[g.id] for g in req.goals
    )
    rows = [
        [
            g.id,
            g.target,
            d_pos_vals[g.id],
            d_neg_vals[g.id],
            g.priority,
            "sí" if d_pos_vals[g.id] < 1e-8 and d_neg_vals[g.id] < 1e-8 else "no",
        ]
        for g in req.goals
    ]

    result = ModuleResult(
        module="goal_programming",
        status=SolveStatus.optimal,
        solution=SolutionBlock(
            variables=variables,
            objective_value=float(total_dev),
            objective_sense="min",
            metrics={"total_deviation": float(total_dev), "priorities": float(len(priorities))},
        ),
        tables=[
            NamedTable(
                name="metas",
                columns=["meta", "objetivo", "d_mas", "d_menos", "prioridad", "cumplida"],
                rows=rows,
            )
        ],
        iterations=iterations,
        sensitivity=None,
        graph=None,
        warnings=["GP preemptivo: optimiza P1, luego P2 sin empeorar P1, etc."],
    )
    logger.info("module=%s status=%s", result.module, result.status.value)
    return result
