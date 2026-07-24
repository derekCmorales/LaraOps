from __future__ import annotations

from io import BytesIO
from typing import Any

from openpyxl import Workbook

from app.schemas.result import ModuleResult, NamedTable
from app.services.export_labels import label_columns, label_key, label_table_name


def module_result_to_xlsx(result: ModuleResult) -> bytes:
    wb = Workbook()
    ws = wb.active
    ws.title = "Solución"

    ws.append([label_key("module"), result.module])
    ws.append([label_key("status"), result.status.value])
    ws.append([])
    ws.append([label_key("variable"), label_key("value")])
    for name, value in result.solution.variables.items():
        ws.append([name, value])
    ws.append([])
    if result.solution.objective_value is not None:
        ws.append([label_key("objective_value"), result.solution.objective_value])
        ws.append([label_key("objective_sense"), result.solution.objective_sense])
        ws.append([])
    ws.append([label_key("metric"), label_key("value")])
    for name, value in result.solution.metrics.items():
        ws.append([label_key(name), value])
    if result.warnings:
        ws.append([])
        ws.append([label_key("warnings")])
        for w in result.warnings:
            ws.append([w])

    if result.iterations:
        iter_ws = wb.create_sheet("Iteraciones")
        iter_ws.append(
            [label_key("index"), label_key("method"), label_key("title"), label_key("meta")]
        )
        for step in result.iterations:
            iter_ws.append([step.index, step.method, step.title, str(step.meta)])

    if result.sensitivity is not None:
        sens_ws = wb.create_sheet("Sensibilidad")
        sens_ws.append([label_key("section"), label_key("payload")])
        sens_ws.append([label_key("shadow_prices"), str(result.sensitivity.shadow_prices)])
        sens_ws.append([label_key("reduced_costs"), str(result.sensitivity.reduced_costs)])
        sens_ws.append([label_key("objective_ranges"), str(result.sensitivity.objective_ranges)])
        sens_ws.append([label_key("rhs_ranges"), str(result.sensitivity.rhs_ranges)])

    if result.tables:
        for table in result.tables:
            _write_named_table(wb, table)

    buf = BytesIO()
    wb.save(buf)
    return buf.getvalue()


def _write_named_table(wb: Workbook, table: NamedTable) -> None:
    title = label_table_name(table.name)[:31] or "Tabla"
    # Avoid colliding with reserved sheet names
    if title in wb.sheetnames:
        title = f"{title[:28]}_t"
    ws = wb.create_sheet(title)
    ws.append(label_columns(list(table.columns)))
    for row in table.rows:
        ws.append(list(row))
