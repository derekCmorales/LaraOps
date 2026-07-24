from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class TransportRequest(BaseModel):
    supply: dict[str, float]  # source -> supply
    demand: dict[str, float]  # dest -> demand
    costs: dict[str, dict[str, float]]  # costs[source][dest]
    method: Literal["northwest", "vogel", "least_cost", "modi_auto"] = "modi_auto"
    objective: Literal["minimize", "maximize"] = "minimize"
    forbidden_routes: list[tuple[str, str]] = Field(
        default_factory=list,
        description="Routes (source, dest) that cannot be used",
    )
