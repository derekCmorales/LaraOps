from __future__ import annotations

import logging

from app.modules.inventory.eoq_core import solve_backorder, solve_epq, solve_eoq
from app.modules.inventory.lot_sizing import solve_dynamic_lot_sizing
from app.modules.inventory.models import InventoryRequest
from app.modules.inventory.newsvendor import solve_newsvendor
from app.schemas.result import ModuleResult

logger = logging.getLogger(__name__)

_DISPATCH = {
    "eoq": solve_eoq,
    "epq": solve_epq,
    "backorder": solve_backorder,
    "newsvendor": solve_newsvendor,
    "dynamic_lot_sizing": solve_dynamic_lot_sizing,
}


def solve(req: InventoryRequest) -> ModuleResult:
    handler = _DISPATCH[req.model]
    result = handler(req)
    logger.info("module=%s submodel=%s status=%s", result.module, req.model, result.status.value)
    return result
