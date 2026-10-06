import { useEffect, useMemo, useState } from "react";
import type { ModuleResult } from "../api/client";
import { fmtCell, fmtMNum, fmtNumber, rangeValue, type MNum, type NumberMode } from "../lib/lpFormat";
import { translateWarning } from "../lib/resultLabels";
import SolutionTable from "./SolutionTable";

type Props = { result: ModuleResult };

type Step = {
  index: number;
  title: string;
  tableau?: (number | string)[][] | null;
  meta?: Record<string, unknown>;
};

type StepMeta = {
  phase?: string;
  kind?: string;
  sense?: "max" | "min";
  objective_label?: string;
  row0?: MNum[];
  z_m?: MNum;
  ratios?: (number | null)[] | null;
  enter?: string | null;
  leave?: string | null;
  pivot?: { tableau_row?: number; tableau_col?: number; value?: number } | null;
  entering_ties?: string[] | null;
  leaving_ties?: string[] | null;
  rule?: string | null;
  operations?: string[] | null;
  note?: string | null;
};

function tableOf(result: ModuleResult, name: string) {
  return result.tables?.find((t) => t.name === name) ?? null;
}

function stepsOf(result: ModuleResult): Step[] {
  return [...((result.iterations ?? []) as Step[])].sort((a, b) => a.index - b.index);
}

function NumberModeToggle({ mode, onChange }: { mode: NumberMode; onChange: (m: NumberMode) => void }) {
  return (
    <div className="eoq-toggle" role="group" aria-label="Formato de los números">
      <button
        type="button"
        className={mode === "fraction" ? "eoq-toggle-btn is-on" : "eoq-toggle-btn"}
        aria-pressed={mode === "fraction"}
        onClick={() => onChange("fraction")}
      >
        Fracciones
      </button>
      <button
        type="button"
        className={mode === "decimal" ? "eoq-toggle-btn is-on" : "eoq-toggle-btn"}
        aria-pressed={mode === "decimal"}
        onClick={() => onChange("decimal")}
      >
        Decimales
      </button>
    </div>
  );
}

function stepLabel(step: Step, i: number): string {
  const m = (step.meta ?? {}) as StepMeta;
  const phase = m.phase === "phase1" ? "F I · " : m.phase === "phase2" ? "F II · " : "";
  switch (m.kind) {
    case "adjust":
      return `${phase}Sin ajustar`;
    case "phase_end":
      return "Inicio F II";
    case "optimal":
      return `${phase}Óptima`;
    case "unbounded":
      return "No acotada";
    case "infeasible":
      return "Infactible";
    case "alternative":
      return "Alterna";
    default:
      return `${phase}Tabla ${i}`;
  }
}

function explainStep(step: Step, mode: NumberMode): string[] {
  const m = (step.meta ?? {}) as StepMeta;
  const obj = m.objective_label ?? "Z";
  const min = m.sense === "min";
  const out: string[] = [];
  const header = (step.tableau?.[0] ?? []).map(String);
  const colIndex = (name: string | null | undefined) => (name ? header.indexOf(name) - 2 : -1);
  if (m.kind === "adjust" || m.kind === "phase_end") {
    if (m.note) out.push(m.note);
    out.push(`La siguiente tabla aplica esas operaciones a la fila ${obj}.`);
    return out;
  }
  if (m.kind === "alternative" || m.kind === "infeasible") {
    if (m.note) out.push(m.note);
    return out;
  }
  if (m.rule === "bland") {
    out.push(
      "Regla de Bland (para salir del ciclaje): entra la variable de menor índice que mejora y, si hay empate en la razón, sale la de menor índice.",
    );
  }
  if (m.kind === "optimal") {
    if (m.phase === "phase1") {
      out.push(`Ningún coeficiente de la fila W es positivo: W ya está en su mínimo (${fmtMNum(m.z_m ?? { a: 0, m: 0 }, mode)}).`);
    } else {
      out.push(
        `Todos los coeficientes de la fila ${obj} son ${min ? "≤ 0" : "≥ 0"}: ninguna variable no básica mejora ${obj}. La tabla es óptima.`,
      );
    }
    return out;
  }
  if (m.enter) {
    const j = colIndex(m.enter);
    const coef = j >= 0 && m.row0?.[j] ? fmtMNum(m.row0[j], mode) : "";
    const rule = (m.phase === "phase1" || min) ? "el más positivo" : "el más negativo";
    out.push(`Entra ${m.enter}: su coeficiente en la fila ${obj} (${coef}) es ${rule}.`);
    if (m.entering_ties?.length) {
      out.push(`Empate entre ${m.entering_ties.join(", ")}: se toma la primera de izquierda a derecha.`);
    }
  }
  if (m.kind === "unbounded") {
    out.push(
      `Ninguna fila tiene coeficiente positivo en la columna de ${m.enter}: ${m.enter} puede crecer sin límite y ${obj} también. El problema no está acotado.`,
    );
    return out;
  }
  if (m.leave && m.ratios) {
    const valid = m.ratios.filter((r): r is number => r != null);
    const minRatio = valid.length ? Math.min(...valid) : null;
    out.push(
      `Prueba de la razón mínima: LD ÷ coeficiente positivo de la columna ${m.enter}. La menor es ${
        minRatio == null ? "—" : fmtNumber(minRatio, mode)
      }, en la fila de ${m.leave}, así que sale ${m.leave}. Pivote = ${fmtNumber(m.pivot?.value ?? 0, mode)}.`,
    );
    if (m.leaving_ties?.length) {
      out.push(
        `Empate en la razón entre ${m.leaving_ties.join(", ")}: sale la de más arriba y en la próxima tabla otra básica vale 0 (degeneración).`,
      );
    }
  }
  return out;
}

function SimplexTableau({ step, mode }: { step: Step; mode: NumberMode }) {
  const m = (step.meta ?? {}) as StepMeta;
  const table = step.tableau ?? [];
  if (table.length < 2) return null;
  const header = table[0].map(String);
  const hasRatio = header[header.length - 1] === "Razón";
  const nCols = header.length - 3 - (hasRatio ? 1 : 0); // Básica, Z/W, columnas..., LD
  const enterCol = m.enter ? header.indexOf(m.enter) - 2 : -1;
  const pivotRow = m.pivot?.tableau_row ?? -1;
  const obj = m.objective_label ?? "Z";
  const row0 = table[1];
  const body = table.slice(2);
  return (
    <div className="lp-tableau-wrap">
      <table className="lp-tableau">
        <caption className="sr-only">{step.title}</caption>
        <thead>
          <tr>
            <th scope="col" className="lp-tab-name">
              Básica
            </th>
            <th scope="col">{obj}</th>
            {header.slice(2, 2 + nCols).map((h, j) => (
              <th key={h} scope="col" className={j === enterCol ? "is-enter-col" : undefined}>
                {h}
                {j === enterCol ? <span className="lp-tab-tag">entra</span> : null}
              </th>
            ))}
            <th scope="col">LD</th>
            {hasRatio ? <th scope="col">Razón</th> : null}
          </tr>
        </thead>
        <tbody>
          <tr className="lp-row0">
            <th scope="row" className="lp-tab-name">
              {obj}
            </th>
            <td>1</td>
            {Array.from({ length: nCols }, (_, j) => {
              const v = m.row0?.[j] ?? row0[2 + j];
              return (
                <td key={j} className={j === enterCol ? "is-enter-col" : undefined}>
                  {fmtCell(v, mode)}
                </td>
              );
            })}
            <td className="lp-tab-rhs">{fmtCell(m.z_m ?? row0[2 + nCols], mode)}</td>
            {hasRatio ? <td /> : null}
          </tr>
          {body.map((row, i) => {
            const leaving = i === pivotRow;
            const ratio = hasRatio ? row[row.length - 1] : null;
            return (
              <tr key={i} className={leaving ? "is-leave-row" : undefined}>
                <th scope="row" className="lp-tab-name">
                  {String(row[0])}
                  {leaving ? <span className="lp-tab-tag">sale</span> : null}
                </th>
                <td>0</td>
                {Array.from({ length: nCols }, (_, j) => {
                  const pivot = leaving && j === enterCol;
                  const cls = [j === enterCol ? "is-enter-col" : "", pivot ? "is-pivot" : ""].filter(Boolean).join(" ");
                  return (
                    <td key={j} className={cls || undefined} aria-label={pivot ? `Pivote ${fmtCell(row[2 + j], mode)}` : undefined}>
                      {fmtCell(row[2 + j], mode)}
                    </td>
                  );
                })}
                <td className="lp-tab-rhs">{fmtCell(row[2 + nCols], mode)}</td>
                {hasRatio ? <td className="lp-tab-ratio">{ratio === "—" ? "—" : fmtCell(ratio, mode)}</td> : null}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function StandardForm({ result }: Props) {
  const t = tableOf(result, "forma_estandar");
  if (!t) return null;
  return (
    <details className="lp-stdform">
      <summary>Forma estándar del modelo</summary>
      <SolutionTable
        columns={["Modelo", "Forma estándar", "Variables agregadas"]}
        rows={t.rows as (string | number)[][]}
        textColumns={[0, 1, 2]}
      />
    </details>
  );
}

export function LpIterations({ result }: Props) {
  const steps = useMemo(() => stepsOf(result), [result]);
  const [idx, setIdx] = useState(0);
  const [mode, setMode] = useState<NumberMode>("fraction");
  useEffect(() => setIdx(0), [steps.length]);
  if (!steps.length) return <p className="empty-results">Activa «Iteraciones simplex» para ver las tablas.</p>;
  const step = steps[Math.min(idx, steps.length - 1)];
  const m = (step.meta ?? {}) as StepMeta;
  const why = explainStep(step, mode);
  const ops = m.operations ?? [];
  let tableNo = 0;
  const labels = steps.map((s) => {
    const meta = (s.meta ?? {}) as StepMeta;
    const label = stepLabel(s, tableNo);
    if (!["adjust", "phase_end", "alternative"].includes(meta.kind ?? "")) tableNo++;
    return label;
  });

  return (
    <div className="lp-iter">
      <StandardForm result={result} />
      <div className="lp-iter-bar">
        <div className="lp-iter-steps" role="tablist" aria-label="Tablas del simplex">
          {steps.map((s, i) => (
            <button
              key={s.index}
              type="button"
              role="tab"
              aria-selected={i === idx}
              className={i === idx ? "lp-iter-step is-on" : "lp-iter-step"}
              onClick={() => setIdx(i)}
            >
              {labels[i]}
            </button>
          ))}
        </div>
        <NumberModeToggle mode={mode} onChange={setMode} />
      </div>
      <h3 className="lp-iter-title">{step.title}</h3>
      {ops.length > 0 && (
        <div className="lp-ops">
          <span className="section-label">Operaciones de renglón (Gauss-Jordan) que dan esta tabla</span>
          <ul>
            {ops.map((op) => (
              <li key={op}>
                <code>{op}</code>
              </li>
            ))}
          </ul>
        </div>
      )}
      <SimplexTableau step={step} mode={mode} />
      {why.length > 0 && (
        <div className="lp-why">
          {why.map((w) => (
            <p key={w}>{w}</p>
          ))}
        </div>
      )}
      <div className="lp-iter-nav">
        <button type="button" className="btn btn-ghost" disabled={idx === 0} onClick={() => setIdx((i) => Math.max(0, i - 1))}>
          ← Anterior
        </button>
        <span className="field-hint">
          {idx + 1} de {steps.length}
        </span>
        <button
          type="button"
          className="btn btn-ghost"
          disabled={idx >= steps.length - 1}
          onClick={() => setIdx((i) => Math.min(steps.length - 1, i + 1))}
        >
          Siguiente →
        </button>
      </div>
    </div>
  );
}

function fmt(v: unknown): string {
  if (typeof v === "number") return fmtNumber(v);
  return v == null ? "—" : String(v);
}

export function LpSolutionPane({ result }: Props) {
  const status = result.status.toLowerCase();
  const sens = result.sensitivity as {
    constraint_analysis?: Record<string, unknown>[];
    reduced_costs?: Record<string, unknown>[];
    objective_ranges?: Record<string, unknown>[];
  } | null;
  const rc = new Map((sens?.reduced_costs ?? []).map((r) => [String(r.variable), r.reduced_cost]));
  const coef = new Map((sens?.objective_ranges ?? []).map((r) => [String(r.variable), r.coeff]));
  const alt = tableOf(result, "solucion_alternativa");
  const vertices = tableOf(result, "vertices_feasible");
  const z = result.solution.objective_value;
  const sense = result.solution.objective_sense;

  const lines: string[] = [];
  if (status === "infeasible") {
    lines.push("No existe ningún punto que cumpla todas las restricciones a la vez.");
    lines.push("Revisa signos (≤, ≥, =) y lados derechos: suele haber dos restricciones que se contradicen. En el gráfico (con dos variables) se ve que las regiones no se cruzan.");
  } else if (status === "unbounded") {
    lines.push(`Z puede ${sense === "max" ? "crecer" : "bajar"} sin límite: falta una restricción que acote la región en la dirección en que mejora Z.`);
  } else if (status === "optimal" && z != null) {
    const mix = Object.entries(result.solution.variables)
      .map(([k, v]) => `${k} = ${fmtNumber(v)}`)
      .join(", ");
    lines.push(`Mezcla óptima: ${mix}. Valor óptimo Z = ${fmtNumber(z)} (${sense === "max" ? "máximo" : "mínimo"}).`);
    const binding = (sens?.constraint_analysis ?? []).filter((r) => Math.abs(Number(r.slack_or_surplus ?? 1)) < 1e-9);
    if (binding.length) {
      lines.push(`Restricciones activas (sin holgura): ${binding.map((r) => r.constraint_id).join(", ")}. Son los recursos que limitan la solución.`);
    }
    const sp = (sens?.constraint_analysis ?? []).find((r) => Math.abs(Number(r.shadow_price ?? 0)) > 1e-9);
    if (sp) {
      lines.push(
        `Precio sombra de ${sp.constraint_id}: ${fmt(sp.shadow_price)}. Una unidad más de LD cambia Z en esa cantidad mientras el LD esté entre ${fmt(sp.allowable_min_rhs)} y ${fmt(sp.allowable_max_rhs)}.`,
      );
    }
  }

  return (
    <div>
      {result.warnings?.length > 0 && (
        <ul className="warn-list">
          {result.warnings.map((w) => (
            <li key={w}>{translateWarning(w)}</li>
          ))}
        </ul>
      )}
      {status === "optimal" && (
        <SolutionTable
          caption="Variables de decisión"
          columns={["Variable", "Valor", "Coef. objetivo", "Costo reducido"]}
          rows={Object.entries(result.solution.variables).map(([k, v]) => [
            k,
            v,
            (coef.get(k) as number | undefined) ?? "—",
            (rc.get(k) as number | undefined) ?? "—",
          ])}
        />
      )}
      {status === "optimal" && sens?.constraint_analysis?.length ? (
        <SolutionTable
          caption="Restricciones en el óptimo"
          columns={["Restricción", "Lado izquierdo", "Sentido", "LD", "Holgura o exceso", "Precio sombra"]}
          rows={sens.constraint_analysis.map((r) => [
            String(r.constraint_id),
            r.lhs as number,
            String(r.sense),
            r.rhs as number,
            r.slack_or_surplus as number,
            r.shadow_price as number,
          ])}
          activeRowIndexes={sens.constraint_analysis
            .map((r, i) => (Math.abs(Number(r.slack_or_surplus ?? 1)) < 1e-9 ? i : -1))
            .filter((i) => i >= 0)}
        />
      ) : null}
      {alt ? (
        <SolutionTable
          caption="Óptimos múltiples: otra solución con el mismo Z"
          columns={["Variable", "Solución 1", "Solución 2"]}
          rows={alt.rows as (string | number)[][]}
        />
      ) : null}
      {vertices ? (
        <SolutionTable
          caption="Vértices de la región factible (método gráfico)"
          columns={vertices.columns.map((c) => (c === "origen" ? "Intersección de" : c === "optimo" ? "Óptimo" : c))}
          rows={vertices.rows as (string | number)[][]}
          textColumns={vertices.columns
            .map((c, i) => (c === "origen" || c === "optimo" ? i : -1))
            .filter((i) => i >= 0)}
        />
      ) : null}
      <aside className="explainer">
        <h3>Qué significa</h3>
        {lines.map((l) => (
          <p key={l}>{l}</p>
        ))}
      </aside>
    </div>
  );
}

function pctText(p: number): string {
  if (!Number.isFinite(p)) return "∞";
  return `${(p * 100).toLocaleString("es-MX", { maximumFractionDigits: 1 })} %`;
}

function parseDraft(text: string): number | null {
  const t = text.trim().replace(",", ".");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

type RuleRow = { name: string; current: number; inc: number; dec: number; extra?: number };

/** Regla del 100 %: cambios simultáneos en coeficientes de Z o en lados derechos. */
export function HundredPercentRule({ result }: Props) {
  const sens = result.sensitivity as {
    objective_ranges?: Record<string, unknown>[];
    constraint_analysis?: Record<string, unknown>[];
  } | null;
  const [kind, setKind] = useState<"objective" | "rhs">("objective");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  if (!sens || result.status.toLowerCase() !== "optimal") return null;

  const rows: RuleRow[] =
    kind === "objective"
      ? (sens.objective_ranges ?? []).map((r) => ({
          name: String(r.variable),
          current: Number(r.coeff),
          inc: rangeValue(r.allowable_increase),
          dec: rangeValue(r.allowable_decrease),
        }))
      : (sens.constraint_analysis ?? [])
          .filter((r) => typeof r.rhs === "number" && r.allowable_min_rhs !== "—")
          .map((r) => ({
            name: String(r.constraint_id),
            current: Number(r.rhs),
            inc: rangeValue(r.allowable_max_rhs) - Number(r.rhs),
            dec: Number(r.rhs) - rangeValue(r.allowable_min_rhs),
            extra: Number(r.shadow_price ?? 0),
          }));

  const key = (name: string) => `${kind}:${name}`;
  let total = 0;
  let changed = 0;
  let zNew = result.solution.objective_value ?? 0;
  const x = result.solution.variables;
  const computed = rows.map((r) => {
    const target = parseDraft(drafts[key(r.name)] ?? "");
    if (target == null || Math.abs(target - r.current) < 1e-12) return { r, delta: 0, pct: 0, target };
    const delta = target - r.current;
    const allow = delta > 0 ? r.inc : r.dec;
    const pct = !Number.isFinite(allow) ? 0 : allow <= 1e-12 ? Number.POSITIVE_INFINITY : Math.abs(delta) / allow;
    total += pct;
    changed++;
    zNew += kind === "objective" ? delta * (x[r.name] ?? 0) : delta * (r.extra ?? 0);
    return { r, delta, pct, target };
  });
  const ok = total <= 1 + 1e-9;

  return (
    <section className="lp-rule" aria-labelledby="lp-rule-title">
      <h3 id="lp-rule-title" className="section-label">
        Regla del 100 % (cambios simultáneos)
      </h3>
      <p className="field-hint">
        Escribe los valores nuevos. Cada cambio usa un porcentaje de lo que se permite aumentar o disminuir. Si la suma no
        pasa de 100 %, {kind === "objective" ? "la mezcla óptima no cambia" : "los precios sombra siguen siendo válidos"}.
      </p>
      <div className="eoq-toggle" role="group" aria-label="Qué cambia">
        <button
          type="button"
          className={kind === "objective" ? "eoq-toggle-btn is-on" : "eoq-toggle-btn"}
          aria-pressed={kind === "objective"}
          onClick={() => setKind("objective")}
        >
          Coeficientes de Z
        </button>
        <button
          type="button"
          className={kind === "rhs" ? "eoq-toggle-btn is-on" : "eoq-toggle-btn"}
          aria-pressed={kind === "rhs"}
          onClick={() => setKind("rhs")}
        >
          Lados derechos
        </button>
      </div>
      <table className="data-table lp-rule-table">
        <thead>
          <tr>
            <th scope="col">{kind === "objective" ? "Variable" : "Restricción"}</th>
            <th scope="col">Actual</th>
            <th scope="col">Rango permitido</th>
            <th scope="col">Nuevo valor</th>
            <th scope="col">Cambio</th>
            <th scope="col">% usado</th>
          </tr>
        </thead>
        <tbody>
          {computed.map(({ r, delta, pct }) => (
            <tr key={r.name}>
              <td className="col-text">{r.name}</td>
              <td>{fmtNumber(r.current)}</td>
              <td>
                [{fmtNumber(r.current - r.dec)}, {fmtNumber(r.current + r.inc)}]
              </td>
              <td>
                <input
                  className="lp-rule-input"
                  inputMode="decimal"
                  aria-label={`Nuevo valor de ${r.name}`}
                  placeholder={fmtNumber(r.current)}
                  value={drafts[key(r.name)] ?? ""}
                  onChange={(e) => setDrafts((d) => ({ ...d, [key(r.name)]: e.target.value }))}
                />
              </td>
              <td>{delta === 0 ? "—" : `${delta > 0 ? "+" : ""}${fmtNumber(delta)}`}</td>
              <td>{delta === 0 ? "—" : pctText(pct)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {changed > 0 ? (
        <p className={ok ? "lp-rule-verdict is-ok" : "lp-rule-verdict is-bad"} role="status">
          Suma = {pctText(total)}.{" "}
          {ok
            ? kind === "objective"
              ? `La regla se cumple: la mezcla óptima sigue igual y el nuevo Z = ${fmtNumber(zNew)}.`
              : `La regla se cumple: la base sigue siendo óptima y Z cambia según los precios sombra: nuevo Z = ${fmtNumber(zNew)}.`
            : "Pasa de 100 %: la regla no garantiza que la solución siga siendo óptima. Puede cambiar o no; vuelve a resolver con los datos nuevos para saberlo."}
        </p>
      ) : null}
    </section>
  );
}

export function LpDualPane({ result }: Props) {
  const model = tableOf(result, "dual_modelo");
  const sol = tableOf(result, "dual_solucion");
  const cons = tableOf(result, "dual_restricciones");
  if (!model) return <p className="field-hint">No hay información del dual.</p>;
  const w = result.solution.metrics.dual_objective;
  return (
    <div className="lp-dual">
      <SolutionTable caption="Problema dual" columns={["Parte", "Expresión"]} rows={model.rows as string[][]} textColumns={[0, 1]} />
      <p className="field-hint">
        Cada restricción del primal da una variable dual yᵢ y cada variable del primal da una restricción dual. Con
        «≤» en un problema de maximizar, yᵢ ≥ 0; con «≥», yᵢ ≤ 0; con «=», yᵢ es libre (al revés si el primal minimiza).
      </p>
      {sol && w != null ? (
        <>
          <div className="pert-kpis">
            <article className="pert-kpi eoq-kpi-main">
              <span>W* (dual) = Z* (primal)</span>
              <strong>{fmtNumber(w)}</strong>
              <small>Teorema de dualidad fuerte</small>
            </article>
          </div>
          <SolutionTable
            caption="Solución dual: yᵢ = precio sombra de la restricción i"
            columns={["Variable dual", "Restricción primal", "Valor yᵢ", "Holgura primal", "yᵢ × holgura"]}
            rows={sol.rows as (string | number)[][]}
            textColumns={[0, 1]}
          />
          {cons ? (
            <SolutionTable
              caption="Restricciones duales y holgura complementaria"
              columns={["Variable primal", "Lado izquierdo dual", "cⱼ", "Holgura dual", "xⱼ", "xⱼ × holgura"]}
              rows={cons.rows as (string | number)[][]}
            />
          ) : null}
          <p className="field-hint">
            Holgura complementaria: en el óptimo cada producto vale 0. Si una restricción tiene holgura, su precio sombra
            es 0; si una variable es positiva, su restricción dual se cumple con igualdad.
          </p>
        </>
      ) : null}
    </div>
  );
}

export function LpAlgebraicPane({ result }: Props) {
  const t = tableOf(result, "soluciones_basicas");
  if (!t) {
    return (
      <p className="field-hint">
        El método algebraico se lista cuando hay pocas combinaciones de variables básicas (300 o menos).
      </p>
    );
  }
  const nameCols = t.columns.slice(2, -2);
  const feasibleIdx = t.columns.length - 2;
  return (
    <div>
      <p className="field-hint">
        Método algebraico: con m restricciones en forma estándar hay que elegir m variables básicas, igualar a 0 las
        demás (no básicas) y resolver el sistema. Las soluciones básicas factibles (todas ≥ 0) son los vértices de la
        región factible; el simplex solo recorre algunas de ellas.
      </p>
      <SolutionTable
        caption={`Soluciones básicas (${t.rows.length})`}
        columns={["#", "Básicas", ...nameCols, "¿Factible?", "Z"]}
        rows={t.rows as (string | number)[][]}
        textColumns={[1, feasibleIdx]}
      />
    </div>
  );
}
