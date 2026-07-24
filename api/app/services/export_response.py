from __future__ import annotations

from fastapi.responses import Response

from app.schemas.result import ModuleResult
from app.services.export_excel import module_result_to_xlsx
from app.services.export_pdf import module_result_to_pdf

XLSX_MEDIA = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
PDF_MEDIA = "application/pdf"


def xlsx_attachment(result: ModuleResult, filename: str) -> Response:
    return Response(
        content=module_result_to_xlsx(result),
        media_type=XLSX_MEDIA,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


def pdf_attachment(result: ModuleResult, filename: str) -> Response:
    return Response(
        content=module_result_to_pdf(result),
        media_type=PDF_MEDIA,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
