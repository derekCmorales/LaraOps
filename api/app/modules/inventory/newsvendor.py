from __future__ import annotations

from scipy.stats import norm

from app.modules.inventory.models import InventoryRequest
from app.schemas.common import SolveStatus
from app.schemas.result import ModuleResult, NamedTable, SolutionBlock


def solve_newsvendor(req: InventoryRequest) -> ModuleResult:
    mean = req.mean_demand or 0.0
    std = req.std_demand or 0.0
    Cu = req.Cu or 0.0
    Co = req.Co or 0.0
    warnings: list[str] = []

    if Cu + Co <= 0:
        raise ValueError("Cu + Co must be > 0")
    critical_ratio = Cu / (Cu + Co)

    if std <= 0:
        z = 0.0
        q_star = mean
        expected_shortage = 0.0
        expected_overstock = 0.0
        warnings.append("std_demand = 0: se usa la demanda media como cantidad óptima")
    else:
        z = float(norm.ppf(critical_ratio))
        q_star = mean + z * std
        # Standard normal loss function L(z) = phi(z) - z * (1 - Phi(z))
        loss = norm.pdf(z) - z * (1.0 - norm.cdf(z))
        expected_shortage = std * loss
        expected_overstock = (q_star - mean) + expected_shortage

    expected_cost = Cu * expected_shortage + Co * expected_overstock

    metrics = {
        "critical_ratio": float(critical_ratio),
        "z": float(z),
        "Q_star": float(q_star),
        "expected_shortage": float(expected_shortage),
        "expected_overstock": float(expected_overstock),
        "expected_cost": float(expected_cost),
    }

    result = ModuleResult(
        module="inventory",
        status=SolveStatus.ok,
        solution=SolutionBlock(variables={"Q": float(q_star)}, metrics=metrics),
        iterations=None,
        sensitivity=None,
        graph=None,
        tables=[
            NamedTable(
                name="newsvendor_summary",
                columns=["métrica", "valor"],
                rows=[[k, v] for k, v in metrics.items()],
            )
        ],
        warnings=warnings,
    )
    return result
