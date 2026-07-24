from __future__ import annotations

from io import BytesIO

from fpdf import FPDF

from app.schemas.result import ModuleResult
from app.services.export_labels import label_columns, label_key, label_table_name


class _ReportPDF(FPDF):
    def footer(self) -> None:
        self.set_y(-12)
        self.set_font("Helvetica", size=8)
        self.set_text_color(90, 90, 90)
        self.cell(0, 8, f"LaraOps - página {self.page_no()}/{{nb}}", align="C")


def module_result_to_pdf(result: ModuleResult) -> bytes:
    pdf = _ReportPDF(format="A4")
    pdf.alias_nb_pages()
    pdf.set_margins(left=15, top=15, right=15)
    pdf.set_auto_page_break(auto=True, margin=18)
    pdf.add_page()
    pdf.set_font("Helvetica", "B", 16)
    _line(pdf, "LaraOps - Reporte académico")
    pdf.set_font("Helvetica", size=11)
    _line(pdf, f"Módulo: {result.module}")
    _line(pdf, f"Estado: {result.status.value}")
    pdf.ln(2)

    _heading(pdf, "Solución")
    if result.solution.objective_value is not None:
        sense = result.solution.objective_sense or ""
        _line(pdf, f"Objetivo ({sense}): {result.solution.objective_value}")
    if result.solution.variables:
        pdf.set_font("Helvetica", "B", 10)
        _line(pdf, "Variables")
        pdf.set_font("Helvetica", size=10)
        for name, value in result.solution.variables.items():
            _line(pdf, f"  {name} = {value}")
    if result.solution.metrics:
        pdf.set_font("Helvetica", "B", 10)
        _line(pdf, "Métricas")
        pdf.set_font("Helvetica", size=10)
        for name, value in result.solution.metrics.items():
            _line(pdf, f"  {label_key(name)} = {value}")

    if result.tables:
        for table in result.tables:
            _heading(pdf, f"Tabla: {label_table_name(table.name)}")
            pdf.set_font("Helvetica", "B", 9)
            _line(pdf, " | ".join(str(c) for c in label_columns(list(table.columns))))
            pdf.set_font("Helvetica", size=9)
            for row in table.rows[:40]:
                _line(pdf, " | ".join("" if v is None else str(v) for v in row))
            if len(table.rows) > 40:
                _line(pdf, f"... ({len(table.rows) - 40} filas más)")

    if result.iterations:
        _heading(pdf, "Iteraciones")
        pdf.set_font("Helvetica", size=9)
        for step in result.iterations[:30]:
            _line(pdf, f"[{step.index}] {step.method}: {step.title}")
        if len(result.iterations) > 30:
            _line(pdf, f"... ({len(result.iterations) - 30} pasos más)")

    if result.sensitivity is not None:
        _heading(pdf, "Sensibilidad / ranging")
        pdf.set_font("Helvetica", size=9)
        for item in result.sensitivity.shadow_prices[:40]:
            _line(pdf, f"precio sombra {item}")
        for item in result.sensitivity.reduced_costs[:40]:
            _line(pdf, f"costo reducido {item}")
        for item in result.sensitivity.objective_ranges[:40]:
            _line(pdf, f"rango objetivo {item}")
        for item in result.sensitivity.rhs_ranges[:40]:
            _line(pdf, f"rango LD {item}")

    if result.warnings:
        _heading(pdf, "Advertencias")
        pdf.set_font("Helvetica", size=9)
        for w in result.warnings:
            _line(pdf, f"- {w}")

    buf = BytesIO()
    pdf.output(buf)
    return buf.getvalue()


def _heading(pdf: FPDF, title: str) -> None:
    pdf.ln(3)
    pdf.set_x(pdf.l_margin)
    pdf.set_font("Helvetica", "B", 12)
    _line(pdf, title)
    pdf.set_font("Helvetica", size=10)


def _line(pdf: FPDF, text: str) -> None:
    pdf.set_x(pdf.l_margin)
    usable = pdf.w - pdf.l_margin - pdf.r_margin
    safe = _safe(text)
    # Truncate very long lines so Helvetica core fonts never break layout.
    while pdf.get_string_width(safe) > usable and len(safe) > 4:
        safe = safe[:-4] + "..."
    pdf.cell(usable, 5, safe, new_x="LMARGIN", new_y="NEXT")


def _safe(text: str) -> str:
    return text.encode("latin-1", "replace").decode("latin-1")
