from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class FacilityLocationRequest(BaseModel):
    mode: Literal["center_of_gravity", "line_balance"] = "center_of_gravity"
    # Center of gravity
    points: list[dict] | None = None  # {name, x, y, volume}
    # Line balancing
    tasks: list[dict] | None = None  # {id, time, predecessors: []}
    cycle_time: float | None = Field(default=None, gt=0)
