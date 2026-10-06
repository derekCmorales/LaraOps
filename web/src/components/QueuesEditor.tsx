import { useId, type ReactNode } from "react";
import { parseDecimalDraft } from "./FormFields";
import {
  MODELS,
  QUEUES_S_MAX,
  TIME_UNITS,
  convertTime,
  fmtNum,
  hasCapacity,
  hasPopulation,
  isFiniteModel,
  isMarkovian,
  isMultiServer,
  modelInfo,
  previewQueues,
  unitInfo,
  type CostBasis,
  type ModelInfo,
  type QueueModel,
  type QueuesField,
  type QueuesForm,
  type QueuesReport,
  type RateMode,
  type TimeUnit,
} from "../lib/queuesForm";

type Props = {
  form: QueuesForm;
  report: QueuesReport;
  /** Muestra los errores solo después del primer intento de resolver. */
  showErrors: boolean;
  onChange: (next: QueuesForm) => void;
};

type InputProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  unit?: string;
  /** Reemplaza la unidad fija por un selector de unidad de tiempo. */
  unitSelect?: { value: TimeUnit; onChange: (u: TimeUnit) => void; label: string };
  placeholder?: string;
  hint?: ReactNode;
  error?: string;
  integer?: boolean;
};

function QInput({ label, value, onChange, unit, unitSelect, placeholder, hint, error, integer }: InputProps) {
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
          inputMode={integer ? "numeric" : "decimal"}
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
        {unitSelect ? (
          <select
            className="q-unit-select"
            aria-label={unitSelect.label}
            value={unitSelect.value}
            onChange={(e) => unitSelect.onChange(e.target.value as TimeUnit)}
          >
            {TIME_UNITS.map((u) => (
              <option key={u.value} value={u.value}>
                {u.plural}
              </option>
            ))}
          </select>
        ) : unit ? (
          <span className="eoq-unit" aria-hidden>
            {unit}
          </span>
        ) : null}
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

type ToggleOption<T extends string> = { value: T; label: string };

function Toggle<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: ToggleOption<T>[];
  onChange: (v: T) => void;
}) {
  const labelId = useId();
  return (
    <div className="q-toggle-row">
      <span className="eoq-label" id={labelId}>
        {label}
      </span>
      <div className="eoq-toggle" role="radiogroup" aria-labelledby={labelId}>
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={value === o.value}
            className={value === o.value ? "eoq-toggle-btn is-on" : "eoq-toggle-btn"}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

const GROUPS: { id: ModelInfo["group"]; title: string }[] = [
  { id: "infinite", title: "Fila sin límite" },
  { id: "capacity", title: "Cupo limitado" },
  { id: "population", title: "Población finita" },
];

function ModelPicker({ value, onChange }: { value: QueueModel; onChange: (m: QueueModel) => void }) {
  const legendId = useId();
  return (
    <fieldset className="eoq-section">
      <legend id={legendId}>Modelo</legend>
      <div className="q-model-groups" role="radiogroup" aria-labelledby={legendId}>
        {GROUPS.map((g) => (
          <div key={g.id} className="q-model-group">
            <span className="q-model-group-title">{g.title}</span>
            <div className="q-models">
              {MODELS.filter((m) => m.group === g.id).map((m) => (
                <button
                  key={m.value}
                  type="button"
                  role="radio"
                  aria-checked={value === m.value}
                  className={value === m.value ? "pert-mode q-model is-on" : "pert-mode q-model"}
                  onClick={() => onChange(m.value)}
                >
                  <code>{m.kendall}</code>
                  <strong>{m.title}</strong>
                  <span>{m.text}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      <p className="field-hint q-kendall-note">
        Notación de Kendall: llegadas / servicio / servidores / capacidad. «M» significa exponencial (Poisson),
        «G» cualquier distribución y «D» tiempo constante.
      </p>
    </fieldset>
  );
}

function rateHint(rate: number | null, unit: TimeUnit, kind: "arrival" | "service" | "population"): string | null {
  if (rate == null || !Number.isFinite(rate)) return null;
  const u = unitInfo(unit);
  const every = 1 / rate;
  const natural = (t: number) => {
    // Expresa 1/λ en la unidad más legible.
    const hours = t * u.hours;
    const target: TimeUnit = hours < 1 / 60 ? "s" : hours < 1 ? "min" : hours < 48 ? "h" : "d";
    const v = convertTime(t, unit, target);
    return `${fmtNum(v, 2)} ${v === 1 ? unitInfo(target).label : unitInfo(target).plural}`;
  };
  if (kind === "arrival") return `λ = ${fmtNum(rate)} clientes por ${u.label}: llega uno cada ${natural(every)} en promedio.`;
  if (kind === "population")
    return `λ = ${fmtNum(rate)} por ${u.label} por cliente: cada cliente vuelve cada ${natural(every)} en promedio.`;
  return `μ = ${fmtNum(rate)} clientes por ${u.label} por servidor: atender a uno toma ${natural(every)} en promedio.`;
}

function Preview({ form, report }: { form: QueuesForm; report: QueuesReport }) {
  const { lambda, mu, servers } = report;
  const model = form.model;
  if (lambda == null || mu == null || servers == null) {
    return (
      <div className="eoq-preview" aria-live="polite">
        <span className="eoq-preview-label">Vista previa</span>
        <p className="eoq-preview-facts">
          Completa las llegadas y el servicio para revisar la utilización al instante. Presiona Resolver (o Ctrl/⌘ +
          Enter) para el reporte completo con fórmulas y gráficos.
        </p>
      </div>
    );
  }
  const p = previewQueues(model, lambda, mu, servers);
  const unit = unitInfo(form.timeUnit).label;
  const multi = isMultiServer(model);
  if (isFiniteModel(model)) {
    const offered = lambda / (servers * mu);
    return (
      <div className="eoq-preview" aria-live="polite">
        <span className="eoq-preview-label">Vista previa</span>
        <p className="eoq-formula">
          {hasPopulation(model) ? "Carga por cliente λ/μ" : "Carga ofrecida λ/(s·μ)"} ={" "}
          <strong>{fmtNum(hasPopulation(model) ? p.r : offered, 3)}</strong>
        </p>
        <p className="eoq-preview-facts">
          {hasCapacity(model)
            ? offered >= 1
              ? "Llegan más clientes de los que se pueden atender, pero como el cupo es limitado el sistema no se desborda: los que encuentran el sistema lleno se van. El resultado te dirá cuántos se pierden."
              : "Con cupo limitado el sistema siempre llega a un estado estable; parte de los clientes se pierde cuando está lleno."
            : "Con población finita el sistema siempre es estable: mientras más clientes están en la fila, menos quedan para llegar."}
        </p>
      </div>
    );
  }
  const rho = p.rho as number;
  const tone = !p.stable ? "is-bad" : rho >= 0.9 ? "is-warn" : "is-ok";
  return (
    <div className={`eoq-preview q-preview ${tone}`} aria-live="polite">
      <span className="eoq-preview-label">Vista previa</span>
      <p className="eoq-formula">
        {multi
          ? `ρ = λ / (s·μ) = ${fmtNum(lambda)} / (${servers} · ${fmtNum(mu)}) = `
          : `ρ = λ / μ = ${fmtNum(lambda)} / ${fmtNum(mu)} = `}
        <strong>{fmtNum(rho, 4)}</strong>
      </p>
      <div
        className="q-meter"
        role="meter"
        aria-label="Utilización"
        aria-valuemin={0}
        aria-valuemax={1}
        aria-valuenow={Math.min(1, rho)}
      >
        <span style={{ width: `${Math.min(100, rho * 100)}%` }} />
      </div>
      <p className="eoq-preview-facts">
        {!p.stable ? (
          <>
            <strong>Inestable:</strong> llegan {fmtNum(lambda)} clientes por {unit} y solo se pueden atender{" "}
            {fmtNum(servers * mu)}. La fila crecería sin fin. Necesitas{" "}
            {multi
              ? `al menos ${p.minServers} servidores`
              : `μ mayor que ${fmtNum(lambda)} o pasar a varios servidores (M/M/s con s ≥ ${p.minServers})`}
            .
          </>
        ) : rho >= 0.9 ? (
          <>
            <strong>Estable, pero muy cargado:</strong> {multi ? "los servidores están ocupados" : "el servidor está ocupado"} el {fmtNum(rho * 100, 1)} % del
            tiempo. Cerca de ρ = 1 la espera crece muy rápido.
          </>
        ) : (
          <>
            <strong>Estable:</strong> {multi ? "los servidores están ocupados" : "el servidor está ocupado"} el {fmtNum(rho * 100, 1)} % del tiempo.
          </>
        )}
      </p>
    </div>
  );
}

const UNIT_TOGGLE = TIME_UNITS.map((u) => ({ value: u.value, label: u.label }));

export default function QueuesEditor({ form, report, showErrors, onChange }: Props) {
  const err = (field: QueuesField) => (showErrors ? report.errors[field] : undefined);
  const set = (patch: Partial<QueuesForm>) => onChange({ ...form, ...patch });
  const model = form.model;
  const info = modelInfo(model);
  const unit = unitInfo(form.timeUnit);
  const multi = isMultiServer(model);
  const population = hasPopulation(model);
  const optimizeId = useId();

  const arrivalModes: ToggleOption<RateMode>[] = [
    { value: "rate", label: population ? "Tasa por cliente" : "Tasa de llegada" },
    { value: "time", label: population ? "Tiempo entre visitas" : "Tiempo entre llegadas" },
  ];
  const serviceModes: ToggleOption<RateMode>[] = [
    { value: "rate", label: "Tasa de servicio" },
    { value: "time", label: "Tiempo de servicio" },
  ];
  const costBases: ToggleOption<CostBasis>[] = [
    { value: "system", label: "En el sistema (L)" },
    { value: "queue", label: "Solo en la fila (Lq)" },
  ];

  const lambdaHint = !err("lambda") ? rateHint(report.lambda, form.timeUnit, population ? "population" : "arrival") : null;
  const muHint = !err("mu") ? rateHint(report.mu, form.timeUnit, "service") : null;
  const cv =
    model === "M/G/1" && report.mu != null && report.errors.sigma == null && form.sigma.trim()
      ? (() => {
          const p = parseDecimalDraft(form.sigma);
          return p.value != null ? convertTime(p.value, form.sigmaUnit, form.timeUnit) * report.mu : null;
        })()
      : null;

  return (
    <div className="eoq-editor q-editor">
      <ModelPicker value={model} onChange={(m) => set({ model: m })} />

      <fieldset className="eoq-section">
        <legend>
          Llegadas y servicio · <code className="q-legend-kendall">{info.kendall}</code>
        </legend>
        <Toggle
          label="Unidad de tiempo"
          value={form.timeUnit}
          options={UNIT_TOGGLE}
          onChange={(timeUnit) => set({ timeUnit })}
        />
        <p className="field-hint q-unit-hint">
          Las tasas se expresan por {unit.label} y los tiempos del resultado (W, Wq) salen en {unit.plural}.
        </p>

        <div className="eoq-grid q-grid">
          <div className="eoq-field q-rate">
            <Toggle
              label={population ? "Llegadas de cada cliente" : "Llegadas"}
              value={form.arrivalMode}
              options={arrivalModes}
              onChange={(arrivalMode) => set({ arrivalMode })}
            />
            {form.arrivalMode === "rate" ? (
              <QInput
                label={population ? "Tasa de llegada por cliente (λ)" : "Tasa de llegada (λ)"}
                unit={population ? `por cliente/${unit.short}` : `clientes/${unit.short}`}
                placeholder="p. ej. 10"
                value={form.lambda}
                onChange={(lambda) => set({ lambda })}
                error={err("lambda")}
                hint={lambdaHint ?? (population ? "Veces por unidad de tiempo que un cliente que está fuera regresa." : "Clientes que llegan en promedio por unidad de tiempo.")}
              />
            ) : (
              <QInput
                label={population ? "Tiempo promedio entre visitas de un cliente" : "Tiempo promedio entre llegadas"}
                unitSelect={{
                  value: form.arrivalTimeUnit,
                  onChange: (arrivalTimeUnit) => set({ arrivalTimeUnit }),
                  label: "Unidad del tiempo entre llegadas",
                }}
                placeholder="p. ej. 6"
                value={form.arrivalTime}
                onChange={(arrivalTime) => set({ arrivalTime })}
                error={err("lambda")}
                hint={lambdaHint ?? "Se convierte a la tasa λ = 1 / tiempo."}
              />
            )}
          </div>

          <div className="eoq-field q-rate">
            <Toggle label="Servicio" value={form.serviceMode} options={serviceModes} onChange={(serviceMode) => set({ serviceMode })} />
            {form.serviceMode === "rate" ? (
              <QInput
                label="Tasa de servicio por servidor (μ)"
                unit={`clientes/${unit.short}`}
                placeholder="p. ej. 15"
                value={form.mu}
                onChange={(mu) => set({ mu })}
                error={err("mu")}
                hint={muHint ?? "Clientes que un solo servidor atiende por unidad de tiempo si nunca descansa."}
              />
            ) : (
              <QInput
                label="Tiempo promedio de servicio"
                unitSelect={{
                  value: form.serviceTimeUnit,
                  onChange: (serviceTimeUnit) => set({ serviceTimeUnit }),
                  label: "Unidad del tiempo de servicio",
                }}
                placeholder="p. ej. 4"
                value={form.serviceTime}
                onChange={(serviceTime) => set({ serviceTime })}
                error={err("mu")}
                hint={muHint ?? "Se convierte a la tasa μ = 1 / tiempo."}
              />
            )}
          </div>
        </div>

        {(multi || hasCapacity(model) || population || model === "M/G/1") && (
          <div className="eoq-grid q-grid q-structure">
            {multi ? (
              <QInput
                label="Servidores (s)"
                unit="servidores"
                integer
                placeholder="p. ej. 2"
                value={form.s}
                onChange={(s) => set({ s })}
                error={err("s")}
                hint="Cajas, agentes o mecánicos que atienden en paralelo una sola fila."
              />
            ) : null}
            {hasCapacity(model) ? (
              <QInput
                label="Capacidad del sistema (K)"
                unit="clientes"
                integer
                placeholder="p. ej. 5"
                value={form.K}
                onChange={(K) => set({ K })}
                error={err("K")}
                hint="Máximo de clientes a la vez, contando a los que se atienden. Si está lleno, el que llega se va."
              />
            ) : null}
            {population ? (
              <QInput
                label="Tamaño de la población (N)"
                unit="clientes"
                integer
                placeholder="p. ej. 10"
                value={form.N}
                onChange={(N) => set({ N })}
                error={err("N")}
                hint="Total de clientes posibles (máquinas, unidades, pacientes registrados)."
              />
            ) : null}
            {model === "M/G/1" ? (
              <QInput
                label="Desviación estándar del tiempo de servicio (σ)"
                unitSelect={{ value: form.sigmaUnit, onChange: (sigmaUnit) => set({ sigmaUnit }), label: "Unidad de σ" }}
                placeholder="p. ej. 6"
                value={form.sigma}
                onChange={(sigma) => set({ sigma })}
                error={err("sigma")}
                hint={
                  cv != null
                    ? `Coeficiente de variación σ·μ = ${fmtNum(cv, 3)} (${cv < 1 ? "menos variable" : cv > 1 ? "más variable" : "igual de variable"} que un servicio exponencial, que tiene 1).`
                    : "Mide qué tanto varía el tiempo de servicio. 0 = siempre igual (M/D/1)."
                }
              />
            ) : null}
          </div>
        )}
      </fieldset>

      <Preview form={form} report={report} />

      <fieldset className="eoq-section">
        <legend>Costos · opcional</legend>
        <div className="eoq-grid q-grid">
          <div className="eoq-field">
            <QInput
              label="Costo de espera"
              unit={`$/cliente·${unit.short}`}
              placeholder="0"
              value={form.costWait}
              onChange={(costWait) => set({ costWait })}
              error={err("costWait")}
              hint={`Lo que cuesta tener a un cliente esperando una ${unit.label} (tiempo perdido, mala experiencia, máquina parada).`}
            />
            <Toggle label="Se cobra por cliente" value={form.costBasis} options={costBases} onChange={(costBasis) => set({ costBasis })} />
          </div>
          <QInput
            label="Costo por servidor"
            unit={`$/servidor·${unit.short}`}
            placeholder="0"
            value={form.costServer}
            onChange={(costServer) => set({ costServer })}
            error={err("costServer")}
            hint={`Sueldo u operación de cada servidor por ${unit.label}, esté ocupado o no.`}
          />
        </div>
        {multi ? (
          <div className="q-optimize">
            <label className="field-checkbox" htmlFor={optimizeId}>
              <input
                id={optimizeId}
                type="checkbox"
                checked={form.optimizeS}
                onChange={(e) => set({ optimizeS: e.target.checked })}
              />
              Comparar el costo total con distinto número de servidores y recomendar el mejor
            </label>
            {form.optimizeS ? (
              <QInput
                label="Comparar hasta"
                unit="servidores"
                integer
                placeholder="automático"
                value={form.sMax}
                onChange={(sMax) => set({ sMax })}
                error={err("sMax")}
                hint={`Vacío = automático. Máximo ${QUEUES_S_MAX}.`}
              />
            ) : null}
          </div>
        ) : null}
      </fieldset>

      <fieldset className="eoq-section">
        <legend>Probabilidad de esperar mucho · opcional</legend>
        {isMarkovian(model) ? (
          <div className="eoq-grid q-grid">
            <QInput
              label="¿Qué probabilidad hay de esperar más de t?"
              unitSelect={{ value: form.waitTUnit, onChange: (waitTUnit) => set({ waitTUnit }), label: "Unidad de t" }}
              placeholder="p. ej. 10"
              value={form.waitT}
              onChange={(waitT) => set({ waitT })}
              error={err("waitT")}
              hint="Calcula P(Wq > t), esperar en la fila más de t, y P(W > t), pasar más de t en total."
            />
          </div>
        ) : (
          <p className="field-hint">
            Para {info.kendall} no hay fórmula cerrada de la distribución del tiempo de espera; solo se calculan los
            promedios.
          </p>
        )}
      </fieldset>
    </div>
  );
}
