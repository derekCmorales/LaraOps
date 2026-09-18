import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { ModuleResult } from "../schema";
import { labelColumns, labelKey, labelTableName } from "./labels";

function safe(text: string): string {
  return text.replace(/[^\x09\x0A\x0D\x20-\x7EÀ-ÿ]/g, "?");
}

export async function moduleResultToPdf(result: ModuleResult): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const margin = 42;
  const pageWidth = 595.28;
  const pageHeight = 841.89;
  const usable = pageWidth - margin * 2;
  let page = pdf.addPage([pageWidth, pageHeight]);
  let y = pageHeight - margin;
  const lineH = 13;

  const ensure = (need = lineH) => {
    if (y - need < margin + 18) {
      page = pdf.addPage([pageWidth, pageHeight]);
      y = pageHeight - margin;
    }
  };

  const draw = (text: string, bold = false, size = 10) => {
    const f = bold ? fontBold : font;
    let t = safe(text);
    while (f.widthOfTextAtSize(t, size) > usable && t.length > 4) t = `${t.slice(0, -4)}...`;
    ensure();
    page.drawText(t, { x: margin, y, size, font: f, color: rgb(0.05, 0.08, 0.14) });
    y -= lineH;
  };

  const heading = (title: string) => {
    y -= 6;
    draw(title, true, 12);
  };

  draw("LaraOps - Reporte académico", true, 16);
  draw(`Módulo: ${result.module}`);
  draw(`Estado: ${result.status}`);
  y -= 4;
  heading("Solución");
  if (result.solution.objective_value != null) {
    draw(`Objetivo (${result.solution.objective_sense ?? ""}): ${result.solution.objective_value}`);
  }

  if (result.sensitivity && Object.keys(result.solution.variables).length) {
    draw("Variables", true);
    draw(labelColumns(["variable", "value", "coeff", "reduced_cost"]).join(" | "), true, 9);
    const rc = Object.fromEntries(result.sensitivity.reduced_costs.map((r) => [String(r.variable), r.reduced_cost]));
    const coef = Object.fromEntries(result.sensitivity.objective_ranges.map((r) => [String(r.variable), r.coeff]));
    for (const [name, value] of Object.entries(result.solution.variables).slice(0, 40)) {
      draw(`${name} | ${value} | ${coef[name] ?? ""} | ${rc[name] ?? 0}`, false, 9);
    }
  } else if (Object.keys(result.solution.variables).length) {
    draw("Variables", true);
    for (const [name, value] of Object.entries(result.solution.variables).slice(0, 40)) {
      draw(`  ${name} = ${value}`);
    }
  }

  if (result.solution.metrics && Object.keys(result.solution.metrics).length) {
    draw("Métricas", true);
    for (const [name, value] of Object.entries(result.solution.metrics)) {
      draw(`  ${labelKey(name)} = ${value}`);
    }
  }

  if (result.tables) {
    for (const table of result.tables) {
      heading(`Tabla: ${labelTableName(table.name)}`);
      draw(labelColumns(table.columns).join(" | "), true, 9);
      for (const row of table.rows.slice(0, 40)) {
        draw(row.map((v) => (v == null ? "" : String(v))).join(" | "), false, 8);
      }
      if (table.rows.length > 40) draw(`... (${table.rows.length - 40} filas más)`);
    }
  }

  if (result.iterations?.length) {
    heading("Iteraciones");
    const last = result.iterations[result.iterations.length - 1];
    for (const step of result.iterations.slice(0, -1).slice(0, 29)) {
      draw(`[${step.index}] ${step.method}: ${step.title}`, false, 9);
    }
    draw(`[${last.index}] ${last.method}: ${last.title}`, false, 9);
    if (last.tableau?.length) {
      draw("Tableau final (óptimo)", true, 9);
      for (const row of last.tableau.slice(0, 20)) {
        draw(row.map((v) => (v == null ? "" : String(v))).join(" | "), false, 8);
      }
    }
  }

  if (result.warnings.length) {
    heading("Advertencias");
    for (const w of result.warnings) draw(`- ${w}`, false, 9);
  }

  const pages = pdf.getPages();
  const footerFont = font;
  pages.forEach((p, i) => {
    p.drawText(`LaraOps - página ${i + 1}/${pages.length}`, {
      x: pageWidth / 2 - 50,
      y: 18,
      size: 8,
      font: footerFont,
      color: rgb(0.35, 0.35, 0.35),
    });
  });

  return pdf.save();
}
