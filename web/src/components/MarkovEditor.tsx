import { useId, type ReactNode } from "react";
import { parseDecimalDraft } from "./FormFields";
import {
  CHAIN_MAX_STATES,
  EXAMPLES,
  HORIZON_MAX,
  MDP_MAX_ACTIONS,
  MDP_MAX_STATES,
  addAction,
  addChainState,
  addMdpState,
  fmtNum,
  removeAction,
  removeChainState,
  removeMdpState,
  rowSum,
  sumIsOne,
  type ExampleId,
  type MarkovForm,
  type MarkovMode,
  type MarkovReport,
} from "../lib/markovForm";

type Props = {
  form: MarkovForm;
  report: MarkovReport;
  showErrors: boolean;
  onChange: (next: MarkovForm) => void;
  onLoadExample: () => void;
};

function fieldError(report: MarkovReport, showErrors: boolean, key: string): string | undefined {
  if (!showErrors) return undefined;
  return report.errors[key];
}

function NumField({
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
      </div>
      {error ? (
        <p className="eoq-error" role="alert">
          {error}
        </p>
      ) : null}
      {hint ? <p className="field-hint">{hint}</p> : null}
    </div>
  );
}

function Toggle<T extends string>({
  label,
  value,
  options,
  onChange,
  hint,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  hint?: ReactNode;
}) {
  const labelId = useId();
  return (
    <div className="eoq-field">
      <span className="eoq-label" id={labelId}>
        {label}
      </span>
      <div className="eoq-toggle" role="radiogroup" aria-labelledby={labelId}>
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={value === option.value}
            className={value === option.value ? "eoq-toggle-btn is-on" : "eoq-toggle-btn"}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
      {hint ? <p className="field-hint">{hint}</p> : null}
    </div>
  );
}

function ProbInput({
  value,
  label,
  error,
  onChange,
}: {
  value: string;
  label: string;
  error?: string;
  onChange: (value: string) => void;
}) {
  return (
    <input
      className="matrix-cell"
      type="text"
      inputMode="decimal"
      autoComplete="off"
      spellCheck={false}
      aria-label={label}
      aria-invalid={error ? true : undefined}
      value={value}
      title={error}
      onChange={(event) => {
        const next = event.target.value;
        if (next.trim() !== "" && parseDecimalDraft(next).invalid) return;
        onChange(next);
      }}
    />
  );
}

function hasNegative(row: string[]): boolean {
  return row.some((cell) => {
    const parsed = parseDecimalDraft(cell.trim());
    return parsed.value != null && parsed.value < -1e-9;
  });
}

function SumCell({ row, message }: { row: string[]; message?: string }) {
  if (hasNegative(row)) {
    return (
      <td>
        <span className="error-inline">Hay un negativo</span>
      </td>
    );
  }
  const sum = rowSum(row);
  const ok = sumIsOne(sum);
  if (ok) return <td className="transport-total is-ok">Suma {fmtNum(sum, 4)}</td>;
  return (
    <td>
      <span className="error-inline">{message ?? (sum == null ? "Suma —" : `Suma ${fmtNum(sum, 4)} · debe ser 1`)}</span>
    </td>
  );
}

function ChainFields({ form, report, showErrors, onChange }: Omit<Props, "onLoadExample">) {
  const chain = form.chain;
  const err = (key: string) => fieldError(report, showErrors, key);
  function update(patch: Partial<typeof chain>) {
    onChange({ ...form, chain: { ...chain, ...patch } });
  }
  function setCell(i: number, j: number, value: string) {
    const transition = chain.transition.map((row, r) => (r === i ? row.map((cell, c) => (c === j ? value : cell)) : row));
    update({ transition });
  }

  return (
    <>
      <p className="field-hint">
        Cada fila es «desde este estado, ¿a dónde puedo ir?». La suma debe ser 1: es la probabilidad total de dar un paso.
        Un nombre corto se lee mejor en el diagrama.
      </p>
      <div className="matrix-editor">
        <table>
          <caption className="section-label">Matriz de transición</caption>
          <thead>
            <tr>
              <th scope="col">Desde \ hacia</th>
              {chain.states.map((state, j) => (
                <th key={`h-${j}`} scope="col">
                  {state.trim() || `Estado ${j + 1}`}
                </th>
              ))}
              <th scope="col">Suma</th>
              <th scope="col">
                <span className="sr-only">Quitar</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {chain.states.map((state, i) => (
              <tr key={`row-${i}`}>
                <th scope="row">
                  <input
                    className="matrix-cell"
                    aria-label={`Nombre del estado ${i + 1}`}
                    value={state}
                    aria-invalid={err(`state-${i}`) ? true : undefined}
                    onChange={(event) => {
                      const states = chain.states.map((name, k) => (k === i ? event.target.value : name));
                      update({ states });
                    }}
                  />
                </th>
                {chain.states.map((target, j) => (
                  <td key={`p-${i}-${j}`}>
                    <ProbInput
                      value={chain.transition[i]?.[j] ?? ""}
                      label={`Probabilidad de ${state.trim() || `estado ${i + 1}`} a ${target.trim() || `estado ${j + 1}`}`}
                      error={err(`p-${i}-${j}`)}
                      onChange={(value) => setCell(i, j, value)}
                    />
                  </td>
                ))}
                <SumCell row={chain.transition[i] ?? []} message={err(`row-${i}`)} />
                <td>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={chain.states.length <= 2}
                    onClick={() => onChange(removeChainState(form, i))}
                  >
                    Quitar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {showErrors && err("state") ? <p className="error-inline">{err("state")}</p> : null}
      <button
        type="button"
        className="btn btn-ghost"
        disabled={chain.states.length >= CHAIN_MAX_STATES}
        onClick={() => onChange(addChainState(form))}
      >
        Agregar estado
      </button>
      <p className="field-hint">Puedes usar hasta {CHAIN_MAX_STATES} estados. Al quitar uno, su probabilidad se queda en el estado de origen para que la fila siga sumando 1.</p>

      <p className="section-label">Distribución inicial</p>
      <p className="field-hint">
        Probabilidad de empezar en cada estado. Si la dejas toda vacía, se reparte por igual. Si no suma 1, al resolver se normaliza y verás un aviso.
      </p>
      <div className="field-grid">
        {chain.states.map((state, i) => (
          <NumField
            key={`ini-${i}`}
            label={state.trim() || `Estado ${i + 1}`}
            value={chain.initial[i] ?? ""}
            error={err(`initial-${i}`)}
            onChange={(value) => {
              const initial = chain.initial.map((cell, k) => (k === i ? value : cell));
              update({ initial });
            }}
          />
        ))}
      </div>
      <InitialHint initial={chain.initial} />
      {err("initial") ? <p className="error-inline">{err("initial")}</p> : null}

      <div className="field-grid">
        <NumField
          label="Pasos"
          value={chain.steps}
          error={err("steps")}
          hint={`Cuántos pasos de la distribución quieres ver (1 a ${HORIZON_MAX}). El paso 0 es la inicial.`}
          onChange={(steps) => update({ steps })}
        />
        <NumField
          label="Potencia n de P"
          value={chain.nPower}
          error={err("nPower")}
          hint="Para la tabla de P elevado a n. Si la dejas vacía, se usa el mismo número de pasos."
          onChange={(nPower) => update({ nPower })}
        />
      </div>

      <label className="field-checkbox">
        <input
          type="checkbox"
          checked={chain.useRewards}
          onChange={(event) => update({ useRewards: event.target.checked })}
        />
        Incluir recompensa (o costo) por estado
      </label>
      {chain.useRewards ? (
        <>
          <p className="field-hint">
            Se cobra cada vez que la cadena visita el estado. El largo plazo usa la distribución estacionaria; si hay estados transitorios, también verás lo esperado hasta caer en una clase recurrente.
          </p>
          <div className="field-grid">
            {chain.states.map((state, i) => (
              <NumField
                key={`rew-${i}`}
                label={state.trim() || `Estado ${i + 1}`}
                value={chain.rewards[i] ?? ""}
                error={err(`reward-${i}`)}
                onChange={(value) => {
                  const rewards = chain.rewards.map((cell, k) => (k === i ? value : cell));
                  update({ rewards });
                }}
              />
            ))}
          </div>
        </>
      ) : null}
    </>
  );
}

function InitialHint({ initial }: { initial: string[] }) {
  const sum = rowSum(initial);
  if (initial.every((cell) => cell.trim() === "")) return <p className="field-hint">Vacía: se usará la misma probabilidad en cada estado.</p>;
  if (sum == null) return null;
  if (!(sum > 1e-12)) return <p className="error-inline">La suma es 0: escribe probabilidades o deja toda la fila vacía.</p>;
  return (
    <p className="field-hint">
      Suma de la inicial: {fmtNum(sum)}
      {sumIsOne(sum) ? " · ya suma 1." : " · al resolver se divide entre esta suma para que dé 1."}
    </p>
  );
}

function MdpFields({ form, report, showErrors, onChange }: Omit<Props, "onLoadExample">) {
  const mdp = form.mdp;
  const err = (key: string) => fieldError(report, showErrors, key);
  const costWord = mdp.sense === "max" ? "Recompensa" : "Costo";
  function patch(next: typeof mdp) {
    onChange({ ...form, mdp: next });
  }

  return (
    <>
      <div className="field-grid">
        <Toggle
          label="Qué optimizar"
          value={mdp.sense}
          options={[
            { value: "min", label: "Minimizar costo" },
            { value: "max", label: "Maximizar recompensa" },
          ]}
          hint={mdp.sense === "max" ? "El número de cada acción es una recompensa: más alto es mejor." : "El número de cada acción es un costo: más bajo es mejor."}
          onChange={(sense) => patch({ ...mdp, sense })}
        />
        <Toggle
          label="Criterio"
          value={mdp.criterion}
          options={[
            { value: "average", label: "Costo promedio" },
            { value: "discounted", label: "Valor descontado" },
          ]}
          hint={
            mdp.criterion === "average"
              ? "Lo que pagas por paso cuando ya pasó mucho tiempo. No hace falta una tasa."
              : "Un costo futuro pesa menos: dentro de un paso se multiplica por γ, dentro de dos por γ²."
          }
          onChange={(criterion) => patch({ ...mdp, criterion })}
        />
      </div>
      {mdp.criterion === "discounted" ? (
        <NumField
          label="Tasa de descuento γ"
          value={mdp.discount}
          error={err("discount")}
          placeholder="0.9"
          hint="Mayor que 0 y menor que 1. 0.9 significa que un costo del siguiente paso vale el 90% de uno de hoy."
          onChange={(discount) => patch({ ...mdp, discount })}
        />
      ) : null}

      <p className="field-hint">
        En cada estado eliges una acción. La acción trae un {costWord.toLowerCase()} inmediato y las probabilidades de pasar a cada estado. Una política es una acción por estado.
      </p>
      {err("mstate") ? <p className="error-inline">{err("mstate")}</p> : null}

      {mdp.states.map((state, i) => (
        <fieldset className="eoq-section" key={`st-${i}`}>
          <legend>Estado {i + 1}</legend>
          <div className="field-grid">
            <div className="eoq-field">
              <label htmlFor={`mstate-${i}`}>Nombre</label>
              <div className={err(`mstate-${i}`) ? "eoq-input is-invalid" : "eoq-input"}>
                <input
                  id={`mstate-${i}`}
                  type="text"
                  value={state}
                  aria-invalid={err(`mstate-${i}`) ? true : undefined}
                  onChange={(event) => {
                    const states = mdp.states.map((name, k) => (k === i ? event.target.value : name));
                    patch({ ...mdp, states });
                  }}
                />
              </div>
              {err(`mstate-${i}`) ? <p className="eoq-error">{err(`mstate-${i}`)}</p> : null}
            </div>
          </div>
          <div className="matrix-editor">
            <table>
              <caption className="section-label">Acciones</caption>
              <thead>
                <tr>
                  <th scope="col">Acción</th>
                  <th scope="col">{costWord}</th>
                  {mdp.states.map((target, j) => (
                    <th key={`ah-${i}-${j}`} scope="col">
                      a {target.trim() || j + 1}
                    </th>
                  ))}
                  <th scope="col">Suma</th>
                  <th scope="col">
                    <span className="sr-only">Quitar acción</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {(mdp.actions[i] ?? []).map((action, k) => (
                  <tr key={`a-${i}-${k}`}>
                    <th scope="row">
                      <input
                        className="matrix-cell"
                        aria-label={`Nombre de la acción ${k + 1} en ${state || `estado ${i + 1}`}`}
                        value={action.name}
                        aria-invalid={err(`aname-${i}-${k}`) ? true : undefined}
                        onChange={(event) => {
                          const actions = mdp.actions.map((list, s) =>
                            s === i ? list.map((item, a) => (a === k ? { ...item, name: event.target.value } : item)) : list,
                          );
                          patch({ ...mdp, actions });
                        }}
                      />
                    </th>
                    <td>
                      <ProbInput
                        value={action.cost}
                        label={`${costWord} de ${action.name || `acción ${k + 1}`}`}
                        error={err(`acost-${i}-${k}`)}
                        onChange={(value) => {
                          const actions = mdp.actions.map((list, s) =>
                            s === i ? list.map((item, a) => (a === k ? { ...item, cost: value } : item)) : list,
                          );
                          patch({ ...mdp, actions });
                        }}
                      />
                    </td>
                    {mdp.states.map((target, j) => (
                      <td key={`ap-${i}-${k}-${j}`}>
                        <ProbInput
                          value={action.transitions[j] ?? ""}
                          label={`Probabilidad de ${action.name || "la acción"} hacia ${target.trim() || `estado ${j + 1}`}`}
                          error={err(`ap-${i}-${k}-${j}`)}
                          onChange={(value) => {
                            const actions = mdp.actions.map((list, s) =>
                              s === i
                                ? list.map((item, a) =>
                                    a === k
                                      ? { ...item, transitions: item.transitions.map((cell, c) => (c === j ? value : cell)) }
                                      : item,
                                  )
                                : list,
                            );
                            patch({ ...mdp, actions });
                          }}
                        />
                      </td>
                    ))}
                    <SumCell row={action.transitions} message={err(`arow-${i}-${k}`)} />
                    <td>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        disabled={(mdp.actions[i] ?? []).length <= 1}
                        onClick={() => onChange(removeAction(form, i, k))}
                      >
                        Quitar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={(mdp.actions[i] ?? []).length >= MDP_MAX_ACTIONS}
            onClick={() => onChange(addAction(form, i))}
          >
            Agregar acción
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={mdp.states.length <= 2}
            onClick={() => onChange(removeMdpState(form, i))}
          >
            Quitar estado
          </button>
        </fieldset>
      ))}
      <button
        type="button"
        className="btn btn-ghost"
        disabled={mdp.states.length >= MDP_MAX_STATES}
        onClick={() => onChange(addMdpState(form))}
      >
        Agregar estado
      </button>
      <p className="field-hint">
        Hasta {MDP_MAX_STATES} estados y {MDP_MAX_ACTIONS} acciones por estado. Si hay 256 políticas o menos, se comparan todas; si no, se busca la óptima por iteración.
      </p>
    </>
  );
}

export default function MarkovEditor({ form, report, showErrors, onChange, onLoadExample }: Props) {
  const messages = showErrors ? [...new Set(Object.values(report.errors))] : [];
  const example = EXAMPLES.find((item) => item.id === form.example) ?? EXAMPLES[0];

  return (
    <div>
      <Toggle
        label="Qué quieres resolver"
        value={form.mode}
        options={[
          { value: "chain" as MarkovMode, label: "Cadena" },
          { value: "mdp" as MarkovMode, label: "Decisión markoviana" },
        ]}
        hint={
          form.mode === "chain"
            ? "Una matriz fija: el sistema salta de estado en estado y no eliges nada."
            : "En cada estado eliges una acción. El programa busca la política con el mejor costo o la mejor recompensa."
        }
        onChange={(mode) => onChange({ ...form, mode })}
      />

      <div className="eoq-field">
        <span className="eoq-label" id="markov-example-label">
          Ejemplo
        </span>
        <div className="eoq-toggle" role="radiogroup" aria-labelledby="markov-example-label">
          {EXAMPLES.map((item) => (
            <button
              key={item.id}
              type="button"
              role="radio"
              aria-checked={form.example === item.id}
              className={form.example === item.id ? "eoq-toggle-btn is-on" : "eoq-toggle-btn"}
              onClick={() => onChange({ ...form, example: item.id as ExampleId })}
            >
              {item.label}
            </button>
          ))}
        </div>
        <p className="field-hint">{example.text} Pulsa el botón para traer esos datos.</p>
        <button type="button" className="btn btn-ghost" onClick={onLoadExample}>
          Cargar ejemplo
        </button>
      </div>

      {messages.length > 0 ? (
        <div className="error-inline" role="alert">
          Revisa estos datos antes de resolver:
          <ul>
            {messages.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {form.mode === "chain" ? (
        <ChainFields form={form} report={report} showErrors={showErrors} onChange={onChange} />
      ) : (
        <MdpFields form={form} report={report} showErrors={showErrors} onChange={onChange} />
      )}
    </div>
  );
}
