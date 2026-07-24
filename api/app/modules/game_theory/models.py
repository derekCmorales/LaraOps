from __future__ import annotations

from pydantic import BaseModel, Field


class GameTheoryRequest(BaseModel):
    row_strategies: list[str] = Field(min_length=1)
    col_strategies: list[str] = Field(min_length=1)
    payoff: list[list[float]]  # row player payoffs (zero-sum)
