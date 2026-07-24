from __future__ import annotations

from pydantic import BaseModel, Field


class BreakevenAlternative(BaseModel):
    name: str
    fixed_cost: float = Field(gt=0)
    variable_cost: float = Field(ge=0)
    price: float | None = Field(default=None, gt=0)


class BreakevenRequest(BaseModel):
    fixed_cost: float = Field(gt=0)
    variable_cost: float = Field(ge=0)
    price: float = Field(gt=0)
    graph_points: int = Field(default=40, ge=5, le=200)
    volume: float | None = Field(default=None, gt=0)
    target_profit: float | None = Field(default=None)
    alternatives: list[BreakevenAlternative] = Field(default_factory=list)
