from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class KnapsackItem(BaseModel):
    id: str
    weight: float = Field(gt=0)
    value: float


class DynamicProgrammingRequest(BaseModel):
    problem: Literal["knapsack", "stagecoach"]
    # knapsack
    capacity: float | None = None
    items: list[KnapsackItem] | None = None
    # stagecoach: stages of nodes with costs[from][to]
    stages: list[list[str]] | None = None
    costs: dict[str, dict[str, float]] | None = None
    origin: str | None = None
    destination: str | None = None
