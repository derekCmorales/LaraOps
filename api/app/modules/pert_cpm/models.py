from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class Activity(BaseModel):
    id: str
    predecessors: list[str] = Field(default_factory=list)
    duration: float | None = None  # CPM deterministic (normal time if crashing)
    a: float | None = None  # PERT optimistic
    m: float | None = None  # most likely
    b: float | None = None  # pessimistic
    # Crashing (CPM)
    crash_time: float | None = None
    normal_cost: float | None = None
    crash_cost: float | None = None


class PertCpmRequest(BaseModel):
    activities: list[Activity]
    mode: Literal["cpm", "pert"] = "cpm"
    target_time: float | None = None  # for PERT Prob(T<=target) OR crash target when crash=True
    target_probability: float | None = None  # inverse: duration for given P (e.g. 0.95)
    crash: bool = False  # enable time-cost crashing (CPM)
    crash_target: float | None = None  # desired project duration after crash
    graph_kind: Literal["network", "gantt"] = "network"
