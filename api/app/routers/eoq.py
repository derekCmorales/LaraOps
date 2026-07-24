from __future__ import annotations

from fastapi import APIRouter
from fastapi.responses import Response

from app.modules.eoq.models import EOQRequest
from app.modules.eoq.solver import solve
from app.schemas.result import ModuleResult
from app.services.export_response import pdf_attachment, xlsx_attachment

router = APIRouter()


@router.post("/solve", response_model=ModuleResult)
def solve_endpoint(req: EOQRequest) -> ModuleResult:
    return solve(req)


@router.post("/export.xlsx")
def export_xlsx(req: EOQRequest) -> Response:
    return xlsx_attachment(solve(req), "eoq_result.xlsx")


@router.post("/export.pdf")
def export_pdf(req: EOQRequest) -> Response:
    return pdf_attachment(solve(req), "eoq_result.pdf")
