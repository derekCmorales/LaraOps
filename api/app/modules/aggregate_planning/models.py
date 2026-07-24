from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class AggregatePlanningRequest(BaseModel):
    demand: list[float] = Field(min_length=1)
    initial_workforce: float = Field(gt=0)
    initial_inventory: float = Field(default=0, ge=0)
    production_per_worker: float = Field(gt=0)
    cost_hire: float = Field(ge=0)
    cost_fire: float = Field(ge=0)
    cost_hold: float = Field(ge=0)
    cost_shortage: float = Field(default=0, ge=0)
    cost_regular: float = Field(default=0, ge=0)
    strategy: Literal["chase", "level", "mixed"] = "mixed"
