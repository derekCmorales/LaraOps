import { useId } from "react";
import { parseDecimalDraft } from "./FormFields";
import SelectDropdown from "./SelectDropdown";
import {
  FAMILIES,
  MODES,
  ORDER_NOTE,
  blankDist,
  PERT_EXPECTED,
  fmtNum,
  templateOrderProfit,
  templatePert,
  type DistFamily,
  type DistForm,
  type McForm,
  type McReport,
  type RngMethod,
  type VarForm,
} from "../lib/monteCarloForm";

type Props = {
  form: McForm;
  report: McReport;
  showErrors: boolean;
  onChange: (next: McForm) => void;
  onReplace: (next: McForm) => void;
};

function NumField({
  label,
  value,
  onChange,
  error,
  hint,
  placeholder,
  unit,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  hint?: string;
  placeholder?: string;
  unit?: string;
}) {
  const id = useId();
  return (
    <div className="eoq-field">
      <label htmlFor={id}>{label}</label>
      <div className={error ? "eoq-input is-invalid" : "eoq-input"}>
        <input
          id={id}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          placeholder={placeholder}
          value={value}
          aria-invalid={error ? true : undefined}
          onChange={(event) => {
            const next = event.target.value;
            if (next.trim() !== "" && parseDecimalDraft(next).invalid) return;
            onChange(next);
          }}
        />
        {unit ? (
          <span className="eoq-unit" aria-hidden>
            {unit}
          </span>
        ) : null}
      </div>
      {error ? <p className="eoq-error">{error}</p> : null}
      {!error && hint ? <p className="field-hint">{hint}</p> : null}
    </div>
  );
}

function TextField({
  label,
  value,
  onChange,
  error,
  hint,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  hint?: string;
  placeholder?: string;
}) {
  const id = useId();
  return (
    <div className="eoq-field">
      <label htmlFor={id}>{label}</label>
      <div className={error ? "eoq-input is-invalid" : "eoq-input"}>
        <input
          id={id}
          type="text"
          autoComplete="off"
          spellCheck={false}
          placeholder={placeholder}
          value={value}
          aria-invalid={error ? true : undefined}
          onChange={(event) => onChange(event.target.value)}
        />
      </div>
      {error ? <p className="eoq-error">{error}</p> : null}
      {!error && hint ? <p className="field-hint">{hint}</p> : null}
    </div>
  );
}

function DistFields({
  dist,
  prefix,
  report,
  showErrors,
  onChange,
}: {
  dist: DistForm;
  prefix: string;
  report: McReport;
  showErrors: boolean;
  onChange: (next: DistForm) => void;
}) {
  const err = (field: string) => (showErrors ? report.errors[`${prefix}:${field}`] : undefined);
  const hint = (field: string, fallback?: string) => report.hints[`${prefix}:${field}`] ?? fallback;
  const set = (patch: Partial<DistForm>) => onChange({ ...dist, ...patch });

  return (
    <>
      <div className="eoq-field">
        <span className="eoq-label">Distribución</span>
        <SelectDropdown
          aria-label="Familia de la distribución"
          value={dist.family}
          options={FAMILIES}
          onChange={(value) => set({ family: value as DistFamily })}
        />
      </div>
      {dist.family === "uniform" ? (
        <>
          <NumField label="Mínimo" value={dist.min} onChange={(min) => set({ min })} error={err("min")} placeholder="0" />
          <NumField
            label="Máximo"
            value={dist.max}
            onChange={(max) => set({ max })}
            error={err("max")}
            placeholder="1"
            hint="Si mínimo = máximo, la variable es constante."
          />
        </>
      ) : null}
      {dist.family === "exponential" ? (
        <NumField
          label="Tasa λ"
          value={dist.lambda}
          onChange={(lambda) => set({ lambda })}
          error={err("lambda")}
          placeholder="2"
          hint="La media es 1/λ. λ debe ser mayor que 0."
        />
      ) : null}
      {dist.family === "normal" ? (
        <>
          <NumField label="Media" value={dist.mean} onChange={(mean) => set({ mean })} error={err("mean")} placeholder="0" />
          <NumField
            label="Desviación estándar"
            value={dist.std}
            onChange={(std) => set({ std })}
            error={err("std")}
            placeholder="1"
            hint="Debe ser mayor que 0. Se genera con Box-Muller."
          />
        </>
      ) : null}
      {dist.family === "triangular" ? (
        <>
          <NumField label="Mínimo (a)" value={dist.low} onChange={(low) => set({ low })} error={err("low")} placeholder="3" />
          <NumField
            label="Moda (m)"
            value={dist.mode}
            onChange={(mode) => set({ mode })}
            error={err("mode")}
            placeholder="5"
            hint="Tiene que quedar estrictamente entre el mínimo y el máximo."
          />
          <NumField label="Máximo (b)" value={dist.high} onChange={(high) => set({ high })} error={err("high")} placeholder="9" />
        </>
      ) : null}
      {dist.family === "discrete" ? (
        <>
          <TextField
            label="Valores"
            value={dist.values}
            onChange={(values) => set({ values })}
            error={err("values")}
            placeholder="40; 55; 70"
            hint="Separa con punto y coma. Los decimales pueden ir con coma: 1,5; 2."
          />
          <TextField
            label="Probabilidades"
            value={dist.probabilities}
            onChange={(probabilities) => set({ probabilities })}
            error={err("probabilities")}
            placeholder="0.1; 0.25; 0.3"
            hint={hint("probabilities", "Una por valor. Si no suman 1, se normalizan al resolver.")}
          />
        </>
      ) : null}
      {dist.family === "empirical" ? (
        <TextField
          label="Datos"
          value={dist.data}
          onChange={(data) => set({ data })}
          error={err("data")}
          placeholder="4; 7; 7; 9"
          hint="Se remuestrea con reemplazo: cada dato tiene la misma probabilidad."
        />
      ) : null}
    </>
  );
}

export default function MonteCarloEditor({ form, report, showErrors, onChange, onReplace }: Props) {
  const err = (field: string) => (showErrors ? report.errors[field] : undefined);
  const set = (patch: Partial<McForm>) => onChange({ ...form, ...patch });
  const modeHint = MODES.find((m) => m.value === form.mode)?.hint;
  const countLabel = form.mode === "rng" ? "Cantidad de números (n)" : "Tamaño de la muestra (n)";
  const countMax = form.mode === "rng" ? "1 a 5000" : "1 a 20000";

  function updateVariable(index: number, patch: Partial<VarForm>) {
    set({
      variables: form.variables.map((variable, i) => (i === index ? { ...variable, ...patch } : variable)),
    });
  }

  return (
    <div className="eoq-editor">
      <fieldset className="eoq-section">
        <legend>Qué quieres simular</legend>
        <div className="eoq-toggle" role="radiogroup" aria-label="Modo de simulación">
          {MODES.map((mode) => (
            <button
              key={mode.value}
              type="button"
              role="radio"
              aria-checked={form.mode === mode.value}
              className={form.mode === mode.value ? "eoq-toggle-btn is-on" : "eoq-toggle-btn"}
              onClick={() => set({ mode: mode.value })}
            >
              {mode.label}
            </button>
          ))}
        </div>
        {modeHint ? <p className="field-hint">{modeHint}</p> : null}
        {form.mode === "rng" ? (
          <>
            <div className="eoq-toggle" role="radiogroup" aria-label="Generador">
              {(
                [
                  ["lcg", "Congruencial lineal (a, c, m)"],
                  ["mulberry32", "Mulberry32"],
                ] as [RngMethod, string][]
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={form.rngMethod === value}
                  className={form.rngMethod === value ? "eoq-toggle-btn is-on" : "eoq-toggle-btn"}
                  onClick={() => set({ rngMethod: value })}
                >
                  {label}
                </button>
              ))}
            </div>
            {form.rngMethod === "lcg" ? (
              <>
                <p className="field-hint">
                  xᵢ = (a·xᵢ₋₁ + c) mod m y Uᵢ = xᵢ / m. Con c = 0 es el congruencial multiplicativo. Verás cada paso,
                  el periodo y si los parámetros cumplen las condiciones de periodo completo (Hull-Dobell).
                </p>
                <div className="eoq-grid">
                  <NumField label="Multiplicador a" value={form.lcgA} onChange={(lcgA) => set({ lcgA })} error={err("lcgA")} placeholder="5" />
                  <NumField label="Incremento c" value={form.lcgC} onChange={(lcgC) => set({ lcgC })} error={err("lcgC")} placeholder="3" hint="0 para el multiplicativo." />
                  <NumField label="Módulo m" value={form.lcgM} onChange={(lcgM) => set({ lcgM })} error={err("lcgM")} placeholder="16" hint="Entero de 2 a 2³² (4294967296)." />
                </div>
              </>
            ) : null}
          </>
        ) : null}
        <div className="eoq-grid">
          <NumField
            label={form.mode === "rng" && form.rngMethod === "lcg" ? "Semilla x₀" : "Semilla"}
            value={form.seed}
            onChange={(seed) => set({ seed })}
            error={err("seed")}
            placeholder="42"
            hint="La misma semilla repite el mismo experimento."
          />
          {form.mode === "monte_carlo" ? (
            <NumField
              label="Réplicas"
              value={form.replications}
              onChange={(replications) => set({ replications })}
              error={err("replications")}
              placeholder="2000"
              hint="Entre 1 y 20000. Pocas (10 o 20) sirven para seguirlo a mano; miles estrechan el intervalo."
            />
          ) : (
            <NumField
              label={countLabel}
              value={form.n}
              onChange={(n) => set({ n })}
              error={err("n")}
              placeholder="2000"
              hint={countMax}
            />
          )}
        </div>
      </fieldset>

      {form.mode === "variates" ? (
        <fieldset className="eoq-section">
          <legend>Distribución</legend>
          <div className="eoq-grid">
            <DistFields
              dist={form.distribution}
              prefix="dist"
              report={report}
              showErrors={showErrors}
              onChange={(distribution) => set({ distribution })}
            />
          </div>
        </fieldset>
      ) : null}

      {form.mode === "monte_carlo" ? (
        <>
          <fieldset className="eoq-section">
            <legend>Plantillas del curso</legend>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              <button type="button" className="btn btn-ghost" onClick={() => onReplace(templateOrderProfit())}>
                Ganancia de un pedido
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => onReplace(templatePert())}>
                Duración de un proyecto (PERT)
              </button>
            </div>
            <p className="field-hint">{ORDER_NOTE}</p>
            <p className="field-hint">
              PERT en serie: tres triangulares (diseño, construcción y prueba). La fórmula clásica (a + 4m + b) / 6 suma{" "}
              {fmtNum(PERT_EXPECTED, 3)}. La simulación sortea cada actividad y suma los tiempos, así comparas ese número
              con la media y ves la dispersión.
            </p>
          </fieldset>

          <fieldset className="eoq-section">
            <legend>Variables aleatorias</legend>
            {form.variables.map((variable, index) => (
              <div key={index} style={{ marginBottom: 16 }}>
                <div className="eoq-grid">
                  <TextField
                    label={`Nombre ${index + 1}`}
                    value={variable.name}
                    onChange={(name) => updateVariable(index, { name })}
                    error={err(`var:${index}:name`)}
                    placeholder="demanda"
                    hint="Letra inicial, luego letras, números o _. Máximo 8 variables."
                  />
                  <DistFields
                    dist={variable.distribution}
                    prefix={`var:${index}`}
                    report={report}
                    showErrors={showErrors}
                    onChange={(distribution) => updateVariable(index, { distribution })}
                  />
                </div>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => set({ variables: form.variables.filter((_, i) => i !== index) })}
                >
                  Quitar variable
                </button>
              </div>
            ))}
            {err("variables") ? <p className="eoq-error">{err("variables")}</p> : null}
            {form.variables.length < 8 ? (
              <button
                type="button"
                className="btn"
                onClick={() => set({ variables: [...form.variables, { name: "", distribution: blankDist() }] })}
              >
                Añadir variable
              </button>
            ) : (
              <p className="field-hint">Ya hay 8 variables, que es el máximo.</p>
            )}
          </fieldset>

          <fieldset className="eoq-section">
            <legend>Fórmula del resultado</legend>
            <div className="eoq-field">
              <label htmlFor="mc-expression">Expresión</label>
              <textarea
                id="mc-expression"
                value={form.expression}
                spellCheck={false}
                rows={3}
                placeholder="20*min(demanda, 70) - 12*70 + 5*max(70-demanda, 0)"
                aria-invalid={err("expression") ? true : undefined}
                onChange={(event) => set({ expression: event.target.value })}
                style={{
                  width: "100%",
                  minHeight: 88,
                  padding: 12,
                  border: err("expression") ? "1px solid var(--error)" : "1px solid var(--ink-200)",
                  borderRadius: 3,
                  fontFamily: "IBM Plex Mono, ui-monospace, monospace",
                  fontSize: "0.95rem",
                  background: "var(--paper)",
                  color: "var(--ink-900)",
                }}
              />
              {err("expression") ? <p className="eoq-error">{err("expression")}</p> : null}
              <p className="field-hint">
                Aritmética: + − * / ^ y paréntesis. Funciones: min, max, abs, sqrt, floor, ceil. Usa los nombres de las
                variables. Los decimales van con punto (1.5). Una división entre cero no detiene el resto: esa réplica se
                cuenta como inválida.
              </p>
            </div>
          </fieldset>
        </>
      ) : null}
    </div>
  );
}
