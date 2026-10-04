import { useId } from "react";
import { parseDecimalDraft } from "./FormFields";
import {
  fmtNum,
  previewEoq,
  type EoqField,
  type EoqForm,
  type EoqReport,
  type HoldingMode,
} from "../lib/eoqForm";

type Props = {
  form: EoqForm;
  report: EoqReport;
  /** Muestra los errores solo después del primer intento de resolver. */
  showErrors: boolean;
  onChange: (next: EoqForm) => void;
};

type InputProps = {
  label: string;
  unit: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  hint?: string;
  error?: string;
};

function EoqInput({ label, unit, value, onChange, placeholder, hint, error }: InputProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(" ") || undefined;
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
          aria-describedby={describedBy}
          onChange={(event) => {
            const next = event.target.value;
            if (next.trim() !== "" && parseDecimalDraft(next).invalid) return;
            onChange(next);
          }}
        />
        <span className="eoq-unit" aria-hidden>
          {unit}
        </span>
      </div>
      {error ? (
        <p className="eoq-error" id={errorId}>
          {error}
        </p>
      ) : null}
      {hint ? (
        <p className="field-hint" id={hintId}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}

const HOLDING_MODES: { value: HoldingMode; label: string }[] = [
  { value: "amount", label: "Monto por unidad (H)" },
  { value: "rate", label: "% del costo unitario (i)" },
];

export default function EoqEditor({ form, report, showErrors, onChange }: Props) {
  const err = (field: EoqField) => (showErrors ? report.errors[field] : undefined);
  const set = (patch: Partial<EoqForm>) => onChange({ ...form, ...patch });
  const body = report.body;
  const preview = body ? previewEoq(body) : null;
  const rateMode = form.holdingMode === "rate";
  const holdingLabelId = useId();

  return (
    <div className="eoq-editor">
      <fieldset className="eoq-section">
        <legend>Demanda y costos</legend>
        <div className="eoq-grid">
          <EoqInput
            label="Demanda anual (D)"
            unit="unid./año"
            placeholder="p. ej. 1000"
            value={form.D}
            onChange={(D) => set({ D })}
            error={err("D")}
            hint="Unidades que se consumen o venden en un año."
          />
          <EoqInput
            label="Costo por pedido (S)"
            unit="$/pedido"
            placeholder="p. ej. 10"
            value={form.S}
            onChange={(S) => set({ S })}
            error={err("S")}
            hint="Costo fijo de colocar y recibir un pedido, sin importar el tamaño."
          />
          <div className="eoq-field eoq-holding">
            <span className="eoq-label" id={holdingLabelId}>
              Costo de mantener
            </span>
            <div className="eoq-toggle" role="radiogroup" aria-labelledby={holdingLabelId}>
              {HOLDING_MODES.map((m) => (
                <button
                  key={m.value}
                  type="button"
                  role="radio"
                  aria-checked={form.holdingMode === m.value}
                  className={form.holdingMode === m.value ? "eoq-toggle-btn is-on" : "eoq-toggle-btn"}
                  onClick={() => set({ holdingMode: m.value })}
                >
                  {m.label}
                </button>
              ))}
            </div>
            {rateMode ? (
              <EoqInput
                label="Tasa anual de mantener (i)"
                unit="% anual"
                placeholder="p. ej. 20"
                value={form.rate}
                onChange={(rate) => set({ rate })}
                error={err("rate")}
                hint={
                  report.holding != null
                    ? `H = i × C = ${fmtNum(report.holding, 4)} $/unid./año`
                    : "Se calcula H = i × C. Necesita el costo unitario."
                }
              />
            ) : (
              <EoqInput
                label="Costo de mantener (H)"
                unit="$/unid./año"
                placeholder="p. ej. 0.5"
                value={form.H}
                onChange={(H) => set({ H })}
                error={err("H")}
                hint="Costo de guardar una unidad durante un año (almacén, capital, seguro)."
              />
            )}
          </div>
          <EoqInput
            label={rateMode ? "Costo unitario (C)" : "Costo unitario (C) · opcional"}
            unit="$/unid."
            placeholder={rateMode ? "p. ej. 5" : "0"}
            value={form.C}
            onChange={(C) => set({ C })}
            error={err("C")}
            hint={
              rateMode
                ? "Precio de compra de cada unidad."
                : "Solo suma el costo de compra (C × D) al total. No cambia Q*."
            }
          />
        </div>
        <p className="field-hint eoq-period">
          D y H deben usar el mismo periodo. Si tus datos son mensuales, multiplica la demanda por 12 o
          convierte H a anual.
        </p>
      </fieldset>

      <fieldset className="eoq-section">
        <legend>Reabastecimiento · opcional</legend>
        <div className="eoq-grid">
          <EoqInput
            label="Tiempo de entrega (L)"
            unit="días"
            placeholder="0"
            value={form.leadTime}
            onChange={(leadTime) => set({ leadTime })}
            error={err("leadTime")}
            hint="Días entre colocar el pedido y recibirlo. Con este dato se calcula el punto de reorden."
          />
          <EoqInput
            label="Días de operación por año"
            unit="días"
            placeholder="365"
            value={form.workingDays}
            onChange={(workingDays) => set({ workingDays })}
            error={err("workingDays")}
            hint="365 para días naturales; usa 250 o 260 si solo cuentas días hábiles."
          />
        </div>
      </fieldset>

      <div className="eoq-preview" aria-live="polite">
        <span className="eoq-preview-label">Vista previa</span>
        {body && preview ? (
          <>
            <p className="eoq-formula">
              Q* = √(2 · D · S / H) = √(2 · {fmtNum(body.D, 4)} · {fmtNum(body.S, 4)} / {fmtNum(body.H, 4)}) ={" "}
              <strong>{fmtNum(preview.qStar)}</strong>
            </p>
            <p className="eoq-preview-facts">
              {fmtNum(preview.orders)} pedidos al año · costo de ordenar + mantener ≈ {fmtNum(preview.relevant)}
              {preview.reorderPoint != null ? ` · reordenar con ${fmtNum(preview.reorderPoint)} unidades` : ""}
            </p>
          </>
        ) : (
          <p className="eoq-preview-facts">
            Completa D, S y H para ver Q* al instante. Presiona Resolver (o Ctrl/⌘ + Enter) para el reporte completo
            con gráficos.
          </p>
        )}
      </div>
    </div>
  );
}
