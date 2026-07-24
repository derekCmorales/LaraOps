from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class NetworkEdge(BaseModel):
    source: str
    target: str
    weight: float = Field(default=1.0)
    capacity: float | None = None


class NetworksRequest(BaseModel):
    problem: Literal["shortest_path", "mst", "max_flow", "transshipment", "tsp"]
    nodes: list[str] = Field(default_factory=list)
    edges: list[NetworkEdge] = Field(default_factory=list)
    source: str | None = None
    sink: str | None = None
    directed: bool = True
    # 5d. min-cost flow / transshipment: supply (>0) / demand (<0) / transship (0) per node.
    # edges reuse `weight` as unit cost and `capacity` as arc capacity (None = unbounded).
    node_supply: dict[str, float] | None = None
    # 5e. TSP: distance matrix (n x n) aligned with `nodes` order (falls back to N0..N{n-1}).
    distance_matrix: list[list[float]] | None = None
    tsp_method: Literal["exact", "heuristic"] | None = None
