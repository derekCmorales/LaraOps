from __future__ import annotations

from pydantic import Field

from app.modules.lp.models import LPRequest


class ILPRequest(LPRequest):
    integer_vars: list[str] = Field(default_factory=list)
    binary_vars: list[str] = Field(default_factory=list)
    max_nodes: int = Field(
        default=500,
        ge=1,
        description="Maximum number of Branch & Bound nodes to explore before stopping early",
    )
    include_node_table: bool = Field(
        default=True,
        description="Include a NamedTable summarizing every explored B&B node",
    )
