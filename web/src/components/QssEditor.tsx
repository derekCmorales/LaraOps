import { useId } from "react";
import { parseDecimalDraft } from "./FormFields";
import { fmtNum, type QssField, type QssForm, type QssReport } from "../lib/qssForm";

type Props = {
  form: QssForm;
  report: QssReport;
  showErrors: boolean;
  onChange: (next: QssForm) => void;
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

export default function QssEditor({ form, report, showErrors, onChange }: Props) {
  const err = (field: QssField) => (showErrors ? report.errors[field] : undefined);
  const set = (patch: Partial<QssForm>) => onChange({ ...form, ...patch });
  const rho =
    report.arrival != null && report.service != null && report.servers != null && report.service > 0
      ? report.arrival / (report.servers * report.service)
      : null;
  const capacityId = useId();

  return (
    <div className="eoq-editor">
      <fieldset className="eoq-section">
        <legend>Llegadas y servicio</legend>
        <div className="eoq-grid">
          <NumField
            label="Tasa de llegada (λ)"
            value={form.arrival_rate}
            onChange={(arrival_rate) => set({ arrival_rate })}
            error={err("arrival_rate")}
            placeholder="4"
            unit="clientes / u.t."
            hint="Clientes que llegan por unidad de tiempo. El tiempo entre llegadas es exponencial."
          />
          <NumField
            label="Tasa de servicio (μ)"
            value={form.service_rate}
            onChange={(service_rate) => set({ service_rate })}
            error={err("service_rate")}
            placeholder="5"
            unit="clientes / u.t."
            hint="Clientes que atiende un servidor por unidad de tiempo, si está ocupado."
          />
          <NumField
            label="Servidores"
            value={form.num_servers}
            onChange={(num_servers) => set({ num_servers })}
            error={err("num_servers")}
            placeholder="1"
            unit="servidores"
            hint="Atienden en paralelo una sola fila."
          />
        </div>
        {rho != null ? (
          <p className="field-hint">
            Carga λ / (s·μ) = {fmtNum(rho)}.{" "}
            {rho < 1
              ? "Con cupo ilimitado el sistema puede estabilizarse."
              : "Sin cupo la fila crece con el tiempo: los promedios dependen del horizonte."}
          </p>
        ) : null}
      </fieldset>

      <fieldset className="eoq-section">
        <legend>Horizonte y semilla</legend>
        <div className="eoq-grid">
          <NumField
            label="Tiempo de simulación"
            value={form.simulation_time}
            onChange={(simulation_time) => set({ simulation_time })}
            error={err("simulation_time")}
            placeholder="800"
            unit="u.t."
            hint="Unidades de tiempo del reloj. Una réplica más larga afina los promedios."
          />
          <NumField
            label="Calentamiento"
            value={form.warmup}
            onChange={(warmup) => set({ warmup })}
            error={err("warmup")}
            placeholder="0"
            unit="u.t."
            hint="Vacío = 0. Ese tramo inicial no entra en L, Lq, W, Wq ni en la utilización."
          />
          <NumField
            label="Semilla"
            value={form.seed}
            onChange={(seed) => set({ seed })}
            error={err("seed")}
            placeholder="42"
            hint="La misma semilla repite la misma realización. No coincide con el generador de Python."
          />
        </div>
        <label className="field-checkbox" htmlFor={capacityId}>
          <input
            id={capacityId}
            type="checkbox"
            checked={form.useCapacity}
            onChange={(event) => set({ useCapacity: event.target.checked })}
          />
          El sistema tiene cupo: si está lleno, el cliente se va
        </label>
        {form.useCapacity ? (
          <div className="eoq-grid">
            <NumField
              label="Capacidad del sistema"
              value={form.capacity}
              onChange={(capacity) => set({ capacity })}
              error={err("capacity")}
              placeholder="5"
              unit="clientes"
              hint="Fila más los que se atienden. Quien llega con el sistema lleno se rechaza."
            />
          </div>
        ) : null}
      </fieldset>
    </div>
  );
}
