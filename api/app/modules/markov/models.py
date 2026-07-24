from __future__ import annotations

from pydantic import BaseModel, Field


class MarkovRequest(BaseModel):
    states: list[str] = Field(min_length=2)
    transition: list[list[float]]  # row-stochastic
    initial: list[float] | None = None
    steps: int = Field(default=10, ge=1, le=500)
    rewards: list[float] | None = None  # optional cost/reward per state
    n_power: int | None = Field(default=None, ge=1, le=1000)  # explicit n for P^n (default: steps)
