from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, model_validator


class DiscountBreak(BaseModel):
    min_qty: float = Field(ge=0)
    unit_cost: float = Field(ge=0)


class InventoryRequest(BaseModel):
    """EOQ / EPQ / backorders / newsvendor / dynamic lot sizing calculator."""

    model: Literal["eoq", "epq", "backorder", "newsvendor", "dynamic_lot_sizing"] = "eoq"

    # --- EOQ family (eoq / epq / backorder share these) ---
    D: float | None = Field(default=None, gt=0, description="Annual demand")
    S: float | None = Field(default=None, gt=0, description="Order cost")
    H: float | None = Field(default=None, gt=0, description="Holding cost per unit per year")
    i: float | None = Field(default=None, ge=0, description="Holding rate; H = i*C if H omitted")
    C: float = Field(default=0, ge=0, description="Unit cost (used if no discounts)")
    discounts: list[DiscountBreak] | None = None
    lead_time: float = Field(default=0, ge=0, description="Lead time in years")
    daily_demand: float | None = Field(default=None, ge=0)
    working_days: float = Field(default=365, gt=0)
    z: float | None = Field(default=None, description="Service level z for safety stock")
    sigma_daily: float | None = Field(default=None, ge=0)

    # --- EPQ / POQ (production) ---
    p: float | None = Field(default=None, gt=0, description="Production rate (units/year) for EPQ")

    # --- Planned backorders ---
    Cs: float | None = Field(
        default=None, gt=0, description="Shortage/backorder cost per unit per year"
    )

    # --- Newsvendor (single-period, normal demand) ---
    mean_demand: float | None = Field(default=None, description="Mean demand for newsvendor")
    std_demand: float | None = Field(default=None, ge=0, description="Std. dev. of demand")
    Cu: float | None = Field(default=None, ge=0, description="Underage (stockout) cost per unit")
    Co: float | None = Field(default=None, ge=0, description="Overage (excess) cost per unit")

    # --- Dynamic lot sizing ---
    demand_periods: list[float] | None = Field(
        default=None, description="Demand per period for dynamic lot sizing"
    )
    lot_sizing_methods: list[Literal["wagner_whitin", "silver_meal", "lot_for_lot"]] = Field(
        default_factory=lambda: ["wagner_whitin", "silver_meal", "lot_for_lot"]
    )

    @model_validator(mode="after")
    def _check_params(self) -> InventoryRequest:
        if self.model in ("eoq", "epq", "backorder"):
            if self.D is None or self.S is None:
                raise ValueError("D and S are required for this model")
            if self.H is None and self.i is None:
                raise ValueError("Provide H > 0 or i (holding rate)")
        if self.model == "epq" and self.p is None:
            raise ValueError("p (production rate) is required for EPQ")
        if self.model == "backorder" and self.Cs is None:
            raise ValueError("Cs (shortage cost) is required for the backorder model")
        if self.model == "newsvendor":
            missing = [
                name
                for name, val in (
                    ("mean_demand", self.mean_demand),
                    ("std_demand", self.std_demand),
                    ("Cu", self.Cu),
                    ("Co", self.Co),
                )
                if val is None
            ]
            if missing:
                raise ValueError(f"Missing required newsvendor fields: {', '.join(missing)}")
        if self.model == "dynamic_lot_sizing":
            if not self.demand_periods:
                raise ValueError("demand_periods is required for dynamic_lot_sizing")
            if self.S is None or self.H is None:
                raise ValueError("S and H are required for dynamic_lot_sizing")
        return self
