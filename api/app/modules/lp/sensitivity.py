from __future__ import annotations

from typing import Any

import numpy as np

from app.modules.lp.models import ConstraintSense, LPConstraint
from app.schemas.result import SensitivityBlock

INF = 1e12
INF_THRESHOLD = 1e9


def _format_rhs_bound(value: float) -> float | str:
    if value >= INF_THRESHOLD:
        return "M"
    return float(value)


def compute_sensitivity(
    *,
    A: np.ndarray,
    b_original: np.ndarray,
    c_internal: np.ndarray,
    basic: list[int],
    var_names: list[str],
    constraint_ids: list[str],
    constraints: list[LPConstraint],
    variables: dict[str, float],
    n_decision: int,
    maximize: bool,
    c_user: np.ndarray,
    warnings: list[str],
) -> SensitivityBlock:
    """Shadow prices, reduced costs, ranging, and QM-style constraint analysis."""
    try:
        B = A[:, basic]
        B_inv = np.linalg.inv(B)
    except np.linalg.LinAlgError:
        warnings.append(
            "Sensitivity ranging numerically unstable; returning shadow prices and reduced costs only."
        )
        B_inv = np.linalg.pinv(A[:, basic])

    c_b = c_internal[basic]
    y = c_b @ B_inv
    reduced = c_internal - y @ A

    shadow_prices: list[dict[str, Any]] = []
    shadow_by_id: dict[str, float] = {}
    for i, cid in enumerate(constraint_ids):
        sp = float(y[i]) if maximize else float(-y[i])
        shadow_prices.append({"constraint_id": cid, "shadow_price": sp})
        shadow_by_id[cid] = sp

    reduced_costs: list[dict[str, Any]] = []
    for j, name in enumerate(var_names):
        rc = float(reduced[j])
        if not maximize:
            rc = -rc
        reduced_costs.append({"variable": name, "reduced_cost": rc})

    objective_ranges: list[dict[str, Any]] = []
    rhs_ranges: list[dict[str, Any]] = []
    constraint_analysis: list[dict[str, Any]] = []

    try:
        nonbasic = [j for j in range(A.shape[1]) if j not in basic]
        for j in range(n_decision):
            coeff = float(c_user[j])
            if j not in basic:
                rc = float(reduced[j])
                if maximize:
                    inc = max(0.0, -rc)
                    dec = INF
                else:
                    inc = INF
                    dec = max(0.0, -rc)
            else:
                row = basic.index(j)
                inc = INF
                dec = INF
                for nj in nonbasic:
                    aij = float((B_inv @ A[:, nj])[row])
                    rc_n = float(reduced[nj])
                    if maximize:
                        if aij > 1e-12:
                            dec = min(dec, rc_n / aij)
                        elif aij < -1e-12:
                            inc = min(inc, rc_n / aij)
                    else:
                        if aij > 1e-12:
                            inc = min(inc, -rc_n / aij)
                        elif aij < -1e-12:
                            dec = min(dec, -rc_n / aij)
                inc = max(0.0, abs(inc)) if np.isfinite(inc) else INF
                dec = max(0.0, abs(dec)) if np.isfinite(dec) else INF

            inc_f = float(inc) if np.isfinite(inc) else INF
            dec_f = float(dec) if np.isfinite(dec) else INF
            objective_ranges.append(
                {
                    "variable": var_names[j],
                    "coeff": coeff,
                    "allowable_increase": inc_f,
                    "allowable_decrease": dec_f,
                    "min_coef": float(coeff - dec_f),
                    "max_coef": float(coeff + inc_f),
                }
            )

        x_b = B_inv @ b_original
        for i, cid in enumerate(constraint_ids):
            col = B_inv[:, i]
            inc = INF
            dec = INF
            for r in range(len(basic)):
                if col[r] > 1e-12:
                    dec = min(dec, float(x_b[r] / col[r]))
                elif col[r] < -1e-12:
                    inc = min(inc, float(-x_b[r] / col[r]))
            inc_f = float(inc) if np.isfinite(inc) else INF
            dec_f = float(dec) if np.isfinite(dec) else INF
            norm_rhs = float(b_original[i])
            rhs_ranges.append(
                {
                    "constraint_id": cid,
                    "rhs": norm_rhs,
                    "allowable_increase": inc_f,
                    "allowable_decrease": dec_f,
                }
            )

        cons_by_id = {c.id: c for c in constraints}
        for i, cid in enumerate(constraint_ids):
            cons = cons_by_id.get(cid)
            if cons is None:
                continue
            lhs = sum(
                float(cons.coeffs.get(v, 0.0)) * float(variables.get(v, 0.0)) for v in var_names
            )
            sense = cons.sense.value
            user_rhs = float(cons.rhs)
            if sense == ConstraintSense.le.value:
                slack = user_rhs - lhs
            elif sense == ConstraintSense.ge.value:
                slack = lhs - user_rhs
            else:
                slack = abs(lhs - user_rhs)

            rr = rhs_ranges[i]
            norm_rhs = float(rr["rhs"])
            dec_f = float(rr["allowable_decrease"])
            inc_f = float(rr["allowable_increase"])
            norm_min = norm_rhs - dec_f
            norm_max = norm_rhs + inc_f

            if abs(user_rhs + norm_rhs) > 1e-6 and user_rhs < 0:
                disp_min = -norm_max
                disp_max = -norm_min
            else:
                disp_min = norm_min
                disp_max = norm_max

            constraint_analysis.append(
                {
                    "constraint_id": cid,
                    "lhs": float(lhs),
                    "sense": sense,
                    "rhs": user_rhs,
                    "slack_or_surplus": float(slack),
                    "shadow_price": float(shadow_by_id.get(cid, 0.0)),
                    "allowable_min_rhs": _format_rhs_bound(float(disp_min)),
                    "allowable_max_rhs": _format_rhs_bound(float(disp_max)),
                }
            )
    except Exception:
        warnings.append("Partial sensitivity: ranging skipped due to numerical issues.")

    return SensitivityBlock(
        shadow_prices=shadow_prices,
        reduced_costs=reduced_costs,
        objective_ranges=objective_ranges,
        rhs_ranges=rhs_ranges,
        constraint_analysis=constraint_analysis,
    )
