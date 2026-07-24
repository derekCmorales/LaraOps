from __future__ import annotations

from fastapi import APIRouter
from fastapi.responses import Response

from app.modules.transport.models import TransportRequest
from app.modules.transport.solver import solve
from app.schemas.result import ModuleResult
from app.services.export_response import pdf_attachment, xlsx_attachment

router = APIRouter()


@router.post("/solve", response_model=ModuleResult)
def solve_endpoint(req: TransportRequest) -> ModuleResult:
    return solve(req)


@router.post("/export.xlsx")
def export_xlsx(req: TransportRequest) -> Response:
    return xlsx_attachment(solve(req), "transport_result.xlsx")


@router.post("/export.pdf")
def export_pdf(req: TransportRequest) -> Response:
    return pdf_attachment(solve(req), "transport_result.pdf")
