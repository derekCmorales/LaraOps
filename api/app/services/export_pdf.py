from __future__ import annotations

from io import BytesIO
from typing import Any

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

    if result.sensitivity and result.solution.variables:
        _write_dict_table_pdf(
            pdf,
            "Variables",
            ["variable", "value", "coeff", "reduced_cost"],
            _variable_rows(result),
        )

    if result.sensitivity and result.sensitivity.constraint_analysis:
        _write_dict_table_pdf(
            pdf,
            "Restricciones en el óptimo",
            [
                "constraint_id",
                "lhs",
                "sense",
                "rhs",
                "slack_or_surplus",
                "shadow_price",
            ],
            result.sensitivity.constraint_analysis,
        )
    elif result.solution.variables:
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
            _write_matrix_pdf(pdf, label_columns(list(table.columns)), table.rows[:40])
            if len(table.rows) > 40:
                _line(pdf, f"... ({len(table.rows) - 40} filas más)")

    if result.sensitivity is not None:
        _heading(pdf, "Sensibilidad / ranging")
        if result.sensitivity.constraint_analysis:
            _write_dict_table_pdf(
                pdf,
                "Análisis de restricciones",
                [
                    "constraint_id",
                    "lhs",
                    "sense",
                    "rhs",
                    "slack_or_surplus",
                    "shadow_price",
                    "allowable_min_rhs",
                    "allowable_max_rhs",
                ],
                result.sensitivity.constraint_analysis,
            )
        if result.sensitivity.objective_ranges:
            _write_dict_table_pdf(
                pdf,
                "Rangos de optimalidad",
                [
                    "variable",
                    "coeff",
                    "allowable_decrease",
                    "allowable_increase",
                    "min_coef",
                    "max_coef",
                ],
                result.sensitivity.objective_ranges,
            )
        nonbasic = [
            r
            for r in result.sensitivity.reduced_costs
            if abs(float(r.get("reduced_cost", 0) or 0)) > 1e-8
        ]
        if nonbasic:
            _write_dict_table_pdf(
                pdf,
                "Costos reducidos (no básicas)",
                ["variable", "reduced_cost"],
                nonbasic,
            )

    if result.iterations:
        _heading(pdf, "Iteraciones")
        pdf.set_font("Helvetica", size=9)
        for step in result.iterations[:-1][:29]:
            _line(pdf, f"[{step.index}] {step.method}: {step.title}")
        last = result.iterations[-1]
        _line(pdf, f"[{last.index}] {last.method}: {last.title}")
        if last.tableau:
            pdf.set_font("Helvetica", "B", 9)
            _line(pdf, "Tableau final (óptimo)")
            pdf.set_font("Helvetica", size=8)
            for row in last.tableau[:20]:
                _line(pdf, " | ".join("" if v is None else str(v) for v in row))
            if len(last.tableau) > 20:
                _line(pdf, f"... ({len(last.tableau) - 20} filas más en el tableau)")

    if result.warnings:
        _heading(pdf, "Advertencias")
        pdf.set_font("Helvetica", size=9)
        for w in result.warnings:
            _line(pdf, f"- {w}")

    buf = BytesIO()
    pdf.output(buf)
    return buf.getvalue()


def _variable_rows(result: ModuleResult) -> list[dict[str, Any]]:
    sens = result.sensitivity
    if sens is None:
        return []
    rc = {str(r["variable"]): r.get("reduced_cost") for r in sens.reduced_costs}
    coef = {str(r["variable"]): r.get("coeff") for r in sens.objective_ranges}
    rows: list[dict[str, Any]] = []
    for name, value in result.solution.variables.items():
        rows.append(
            {
                "variable": name,
                "value": value,
                "coeff": coef.get(name, ""),
                "reduced_cost": rc.get(name, 0),
            }
        )
    return rows


def _write_dict_table_pdf(
    pdf: FPDF,
    title: str,
    keys: list[str],
    rows: list[dict[str, Any]],
) -> None:
    if not rows:
        return
    pdf.set_font("Helvetica", "B", 10)
    _line(pdf, title)
    headers = label_columns(keys)
    pdf.set_font("Helvetica", "B", 9)
    _line(pdf, " | ".join(headers))
    pdf.set_font("Helvetica", size=9)
    for row in rows[:40]:
        cells = ["" if row.get(k) is None else str(row.get(k)) for k in keys]
        _line(pdf, " | ".join(cells))
    if len(rows) > 40:
        _line(pdf, f"... ({len(rows) - 40} filas más)")


def _write_matrix_pdf(pdf: FPDF, headers: list[str], rows: list[list[Any]]) -> None:
    pdf.set_font("Helvetica", "B", 9)
    _line(pdf, " | ".join(str(c) for c in headers))
    pdf.set_font("Helvetica", size=9)
    for row in rows:
        _line(pdf, " | ".join("" if v is None else str(v) for v in row))


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
    while pdf.get_string_width(safe) > usable and len(safe) > 4:
        safe = safe[:-4] + "..."
    pdf.cell(usable, 5, safe, new_x="LMARGIN", new_y="NEXT")


def _safe(text: str) -> str:
    return text.encode("latin-1", "replace").decode("latin-1")
