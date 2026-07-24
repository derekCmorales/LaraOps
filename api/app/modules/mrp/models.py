from __future__ import annotations

from pydantic import BaseModel, Field


class BomItem(BaseModel):
    parent: str
    component: str
    qty_per: float = Field(gt=0)


class MrpRequest(BaseModel):
    """Multi-level MRP explosion with lead times and classic MRP rows."""

    items: list[str] = Field(min_length=1)
    bom: list[BomItem] = Field(default_factory=list)
    gross_requirements: dict[str, list[float]]  # item -> demand per period
    on_hand: dict[str, float] = Field(default_factory=dict)
    safety_stock: dict[str, float] = Field(default_factory=dict)
    lead_times: dict[str, int] = Field(default_factory=dict)  # periods
    scheduled_receipts: dict[str, list[float]] = Field(
        default_factory=dict,
        description="item -> receipts already scheduled per period",
    )
    lot_for_lot: bool = True
    lot_size: dict[str, float] = Field(
        default_factory=dict,
        description="Fixed lot multiple per item (ignored if lot_for_lot)",
    )
