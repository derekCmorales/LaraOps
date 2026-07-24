from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from app.modules.lp.models import ConstraintSense, LPConstraint


class Goal(BaseModel):
    id: str
    coeffs: dict[str, float]
    sense: ConstraintSense  # target direction: = with deviations; or soft <= >=
    target: float
    priority: int = Field(default=1, ge=1)
    weight_pos: float = Field(default=1.0, ge=0)  # d+
    weight_neg: float = Field(default=1.0, ge=0)  # d-


class GoalProgrammingRequest(BaseModel):
    variable_names: list[str] | None = None
    hard_constraints: list[LPConstraint] = Field(default_factory=list)
    goals: list[Goal] = Field(min_length=1)
    sense: Literal["min"] = "min"  # always minimize weighted deviations
