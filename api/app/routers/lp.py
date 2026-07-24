from __future__ import annotations

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response

from app.modules.lp.models import LPRequest
from app.modules.lp.solver import solve
from app.schemas.result import ModuleResult
from app.services.export_response import pdf_attachment, xlsx_attachment

router = APIRouter()


@router.post("/solve", response_model=ModuleResult)
def solve_endpoint(req: LPRequest) -> ModuleResult:
    return _solve_or_400(req)


def _solve_or_400(req: LPRequest) -> ModuleResult:
    try:
        return solve(req)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/export.xlsx")
def export_xlsx(req: LPRequest) -> Response:
    return xlsx_attachment(_solve_or_400(req), "lp_result.xlsx")


@router.post("/export.pdf")
def export_pdf(req: LPRequest) -> Response:
    return pdf_attachment(_solve_or_400(req), "lp_result.pdf")
