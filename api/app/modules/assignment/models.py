from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class AssignmentRequest(BaseModel):
    agents: list[str]
    tasks: list[str]
    costs: list[list[float]]
    sense: Literal["min", "max"] = "min"
    forbidden_assignments: list[tuple[str, str]] = Field(
        default_factory=list,
        description="Pairs (agent, task) that cannot be assigned",
    )
