from __future__ import annotations

from typing import Any

import numpy as np

from app.modules.lp.models import LPRequest
from app.schemas.result import SensitivityBlock


def compute_sensitivity(
    *,
    A: np.ndarray,
    b_original: np.ndarray,
    c_internal: np.ndarray,
    basic: list[int],
    var_names: list[str],
    constraint_ids: list[str],
    n_decision: int,
    maximize: bool,
    c_user: np.ndarray,
    warnings: list[str],
) -> SensitivityBlock:
    """Shadow prices, reduced costs, and basic ranging from final basis."""
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

    shadow_prices = []
    for i, cid in enumerate(constraint_ids):
        sp = float(y[i]) if maximize else float(-y[i])
        shadow_prices.append({"constraint_id": cid, "shadow_price": sp})

    reduced_costs = []
    for j, name in enumerate(var_names):
        rc = float(reduced[j])
        if not maximize:
            rc = -rc
        reduced_costs.append({"variable": name, "reduced_cost": rc})

    objective_ranges: list[dict[str, Any]] = []
    rhs_ranges: list[dict[str, Any]] = []
    try:
        nonbasic = [j for j in range(A.shape[1]) if j not in basic]
        for j in range(n_decision):
            coeff = float(c_user[j])
            if j not in basic:
                rc = float(reduced[j])
                if maximize:
                    # optimality: reduced <= 0; increasing c_j raises reduced
                    inc = max(0.0, -rc)
                    dec = 1e12
                else:
                    inc = 1e12
                    dec = max(0.0, -rc)
                objective_ranges.append(
                    {
                        "variable": var_names[j],
                        "coeff": coeff,
                        "allowable_increase": float(inc),
                        "allowable_decrease": float(dec),
                    }
                )
            else:
                row = basic.index(j)
                inc = 1e12
                dec = 1e12
                for nj in nonbasic:
                    aij = float((B_inv @ A[:, nj])[row])
                    rc_n = float(reduced[nj])
                    if maximize:
                        # rc_n' = rc_n - Δ * aij <= 0
                        if aij > 1e-12:
                            dec = min(dec, rc_n / aij)  # Δ negative direction careful
                        elif aij < -1e-12:
                            inc = min(inc, rc_n / aij)
                    else:
                        if aij > 1e-12:
                            inc = min(inc, -rc_n / aij)
                        elif aij < -1e-12:
                            dec = min(dec, -rc_n / aij)
                # Clamp negative artifacts
                inc = max(0.0, abs(inc)) if np.isfinite(inc) else 1e12
                dec = max(0.0, abs(dec)) if np.isfinite(dec) else 1e12
                objective_ranges.append(
                    {
                        "variable": var_names[j],
                        "coeff": coeff,
                        "allowable_increase": float(inc),
                        "allowable_decrease": float(dec),
                    }
                )

        x_b = B_inv @ b_original
        for i, cid in enumerate(constraint_ids):
            col = B_inv[:, i]
            inc = 1e12
            dec = 1e12
            for r in range(len(basic)):
                if col[r] > 1e-12:
                    dec = min(dec, float(x_b[r] / col[r]))
                elif col[r] < -1e-12:
                    inc = min(inc, float(-x_b[r] / col[r]))
            rhs_ranges.append(
                {
                    "constraint_id": cid,
                    "rhs": float(b_original[i]),
                    "allowable_increase": float(inc) if np.isfinite(inc) else 1e12,
                    "allowable_decrease": float(dec) if np.isfinite(dec) else 1e12,
                }
            )
    except Exception:
        warnings.append("Partial sensitivity: ranging skipped due to numerical issues.")

    return SensitivityBlock(
        shadow_prices=shadow_prices,
        reduced_costs=reduced_costs,
        objective_ranges=objective_ranges,
        rhs_ranges=rhs_ranges,
    )
