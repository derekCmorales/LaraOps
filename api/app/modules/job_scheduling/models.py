from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class Job(BaseModel):
    id: str
    times: list[float] = Field(description="Processing time per machine")
    due_date: float | None = None


class JobSchedulingRequest(BaseModel):
    rule: Literal["spt", "edd", "johnson"] = "spt"
    jobs: list[Job] = Field(min_length=1)
    # johnson requires exactly 2 machines
