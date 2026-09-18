import { zipSync, strToU8 } from "fflate";
import type { ModuleResult, NamedTable } from "../schema";
import { labelColumns, labelKey, labelTableName } from "./labels";

function escapeXml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function colName(i: number): string {
  let n = i + 1;
  let s = "";
  while (n > 0) {
    n--;
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26);
  }
  return s;
}

function cellXml(r: number, c: number, v: unknown): string {
  const ref = `${colName(c)}${r + 1}`;
  if (typeof v === "number" && Number.isFinite(v)) {
    return `<c r="${ref}"><v>${v}</v></c>`;
  }
  if (typeof v === "boolean") {
    return `<c r="${ref}" t="inlineStr"><is><t>${v ? "TRUE" : "FALSE"}</t></is></c>`;
  }
  const t = escapeXml(v == null ? "" : String(v));
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${t}</t></is></c>`;
}

function sheetXml(rows: unknown[][]): string {
  const body = rows
    .map((row, r) => `<row r="${r + 1}">${row.map((v, c) => cellXml(r, c, v)).join("")}</row>`)
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`;
}

function variableRows(result: ModuleResult): Record<string, unknown>[] {
  const sens = result.sensitivity;
  if (!sens) return [];
  const rc = Object.fromEntries(sens.reduced_costs.map((r) => [String(r.variable), r.reduced_cost]));
  const coef = Object.fromEntries(sens.objective_ranges.map((r) => [String(r.variable), r.coeff]));
  return Object.entries(result.solution.variables).map(([name, value]) => ({
    variable: name,
    value,
    coeff: coef[name] ?? "",
    reduced_cost: rc[name] ?? 0,
  }));
}

export function moduleResultToXlsx(result: ModuleResult): Uint8Array {
  const sheets: { name: string; rows: unknown[][] }[] = [];

  const sol: unknown[][] = [
    [labelKey("module"), result.module],
    [labelKey("status"), result.status],
    [],
  ];
  if (result.solution.objective_value != null) {
    sol.push([labelKey("objective_value"), result.solution.objective_value]);
    sol.push([labelKey("objective_sense"), result.solution.objective_sense]);
    sol.push([]);
  }
  const vars = variableRows(result);
  if (result.sensitivity && vars.length) {
    sol.push([labelKey("variable"), labelKey("value"), labelKey("coeff"), labelKey("reduced_cost")]);
    for (const row of vars) sol.push([row.variable, row.value, row.coeff, row.reduced_cost]);
    sol.push([]);
  } else if (Object.keys(result.solution.variables).length) {
    sol.push([labelKey("variable"), labelKey("value")]);
    for (const [name, value] of Object.entries(result.solution.variables)) sol.push([name, value]);
    sol.push([]);
  }
  if (result.sensitivity?.constraint_analysis.length) {
    const keys = ["constraint_id", "lhs", "sense", "rhs", "slack_or_surplus", "shadow_price"];
    sol.push([labelKey("constraint_analysis")]);
    sol.push(labelColumns(keys));
    for (const row of result.sensitivity.constraint_analysis) sol.push(keys.map((k) => row[k]));
    sol.push([]);
  }
  sol.push([labelKey("metric"), labelKey("value")]);
  for (const [name, value] of Object.entries(result.solution.metrics)) {
    sol.push([labelKey(name), value]);
  }
  if (result.warnings.length) {
    sol.push([]);
    sol.push([labelKey("warnings")]);
    for (const w of result.warnings) sol.push([w]);
  }
  sheets.push({ name: "Solución", rows: sol });

  if (result.sensitivity) {
    const sens: unknown[][] = [];
    if (result.sensitivity.constraint_analysis.length) {
      const keys = [
        "constraint_id",
        "lhs",
        "sense",
        "rhs",
        "slack_or_surplus",
        "shadow_price",
        "allowable_min_rhs",
        "allowable_max_rhs",
      ];
      sens.push(labelColumns(keys));
      for (const row of result.sensitivity.constraint_analysis) sens.push(keys.map((k) => row[k]));
      sens.push([]);
    }
    if (result.sensitivity.objective_ranges.length) {
      const keys = ["variable", "coeff", "allowable_decrease", "allowable_increase", "min_coef", "max_coef"];
      sens.push(labelColumns(keys));
      for (const row of result.sensitivity.objective_ranges) sens.push(keys.map((k) => row[k]));
      sens.push([]);
    }
    const nonbasic = result.sensitivity.reduced_costs.filter(
      (r) => Math.abs(Number(r.reduced_cost ?? 0)) > 1e-8,
    );
    if (nonbasic.length) {
      sens.push(labelColumns(["variable", "reduced_cost"]));
      for (const row of nonbasic) sens.push([row.variable, row.reduced_cost]);
    }
    sheets.push({ name: "Sensibilidad", rows: sens.length ? sens : [["—"]] });
  }

  if (result.iterations?.length) {
    const iter: unknown[][] = [[labelKey("index"), labelKey("method"), labelKey("title"), labelKey("meta")]];
    for (const step of result.iterations) {
      iter.push([step.index, step.method, step.title, JSON.stringify(step.meta)]);
    }
    sheets.push({ name: "Iteraciones", rows: iter });
    const last = result.iterations[result.iterations.length - 1];
    if (last.tableau?.length) {
      sheets.push({ name: "Tableau final", rows: last.tableau });
    }
  }

  if (result.tables) {
    for (const table of result.tables) {
      sheets.push(namedTableSheet(table));
    }
  }

  return packWorkbook(sheets);
}

function namedTableSheet(table: NamedTable): { name: string; rows: unknown[][] } {
  let title = labelTableName(table.name).slice(0, 31) || "Tabla";
  title = title.replace(/[\\/?*[\]]/g, "_");
  return {
    name: title,
    rows: [labelColumns(table.columns), ...table.rows],
  };
}

function packWorkbook(sheets: { name: string; rows: unknown[][] }[]): Uint8Array {
  const names = uniqueSheetNames(sheets.map((s) => s.name));
  const files: Record<string, Uint8Array> = {};
  const sheetRels = names
    .map(
      (name, i) =>
        `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
    )
    .join("");
  const sheetEntries = names
    .map((name, i) => `<sheet name="${escapeXml(name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
    .join("");
  const overrides = names
    .map(
      (_, i) =>
        `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
    )
    .join("");

  files["[Content_Types].xml"] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
${overrides}
</Types>`,
  );
  files["_rels/.rels"] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`,
  );
  files["xl/workbook.xml"] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>${sheetEntries}</sheets>
</workbook>`,
  );
  files["xl/_rels/workbook.xml.rels"] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheetRels}</Relationships>`,
  );
  sheets.forEach((sheet, i) => {
    files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(sheetXml(sheet.rows));
  });
  return zipSync(files);
}

function uniqueSheetNames(names: string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((raw) => {
    const base = raw.slice(0, 31) || "Hoja";
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    if (n === 1) return base;
    const suffix = `_${n}`;
    return (base.slice(0, 31 - suffix.length) + suffix).slice(0, 31);
  });
}
