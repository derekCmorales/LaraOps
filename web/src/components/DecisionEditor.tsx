import { useId, type ReactNode } from "react";
import { parseDecimalDraft } from "./FormFields";
import SelectDropdown from "./SelectDropdown";
import {
  addTreeNode,
  DECISION_LIMITS,
  exampleDecision,
  removeTreeNode,
  renameTreeNode,
  resizeActions,
  resizeAlternatives,
  resizeBayesStates,
  resizeSignals,
  resizeStates,
  type Criterion,
  type DecisionForm,
  type DecisionMode,
  type DecisionReport,
  type NodeKind,
  type TreeNodeForm,
  type UtilityKind,
} from "../lib/decisionForm";

type Props = {
  form: DecisionForm;
  report: DecisionReport;
  showErrors: boolean;
  onChange: (next: DecisionForm) => void;
};

const MODES: { value: DecisionMode; title: string; text: string }[] = [
  { value: "payoff_table", title: "Tabla de pagos", text: "Criterios con o sin probabilidades." },
  { value: "utility", title: "Utilidad", text: "Equivalente cierto y prima de riesgo." },
  { value: "decision_tree", title: "Árbol", text: "Decisiones, azar y pagos finales." },
  { value: "bayes", title: "Bayes", text: "Valor de comprar una muestra." },
];

const CRITERIA: { value: Criterion; label: string }[] = [
  { value: "all", label: "Todos los criterios" },
  { value: "expected_value", label: "Valor esperado" },
  { value: "maximax", label: "Maximax (optimista)" },
  { value: "maximin", label: "Maximin (pesimista)" },
  { value: "minimax_regret", label: "Arrepentimiento minimax" },
  { value: "hurwicz", label: "Hurwicz" },
  { value: "laplace", label: "Laplace (equiprobable)" },
];

const KINDS: { value: NodeKind; label: string }[] = [
  { value: "decision", label: "Decisión" },
  { value: "chance", label: "Azar" },
  { value: "terminal", label: "Terminal" },
];

function DecimalInput({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
}) {
  return (
    <input
      className="matrix-cell"
      type="text"
      inputMode="decimal"
      autoComplete="off"
      spellCheck={false}
      aria-label={label}
      value={value}
      onChange={(event) => {
        const next = event.target.value;
        if (next.trim() !== "" && parseDecimalDraft(next).invalid) return;
        onChange(next);
      }}
    />
  );
}

function NameInput({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
}) {
  return (
    <input
      className="matrix-node"
      type="text"
      aria-label={label}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

function CountBar({
  label,
  value,
  max,
  onChange,
}: {
  label: string;
  value: number;
  max: number;
  onChange: (next: number) => void;
}) {
  return (
    <div className="asg-stepper" role="group" aria-label={label}>
      <span className="asg-stepper-label">{label}</span>
      <button type="button" className="asg-stepper-btn" aria-label={`Quitar ${label}`} disabled={value <= 1} onClick={() => onChange(value - 1)}>
        −
      </button>
      <output className="asg-stepper-value">{value}</output>
      <button type="button" className="asg-stepper-btn" aria-label={`Agregar ${label}`} disabled={value >= max} onClick={() => onChange(value + 1)}>
        +
      </button>
    </div>
  );
}

function TextControl({
  label,
  value,
  onChange,
  hint,
  suffix,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: ReactNode;
  suffix?: string;
}) {
  const id = useId();
  return (
    <div className="eoq-field">
      <label htmlFor={id}>{label}</label>
      <div className="eoq-input">
        <input
          id={id}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          value={value}
          onChange={(event) => {
            const next = event.target.value;
            if (next.trim() !== "" && parseDecimalDraft(next).invalid) return;
            onChange(next);
          }}
        />
        {suffix ? (
          <span className="eoq-unit" aria-hidden>
            {suffix}
          </span>
        ) : null}
      </div>
      {hint ? <p className="field-hint">{hint}</p> : null}
    </div>
  );
}

function PayoffGrid({
  rowNames,
  colNames,
  values,
  rowLabel,
  colLabel,
  onRowName,
  onColName,
  onCell,
  probabilityRow,
  onProbability,
}: {
  rowNames: string[];
  colNames: string[];
  values: string[][];
  rowLabel: string;
  colLabel: string;
  onRowName: (index: number, name: string) => void;
  onColName: (index: number, name: string) => void;
  onCell: (row: number, col: number, value: string) => void;
  probabilityRow?: string[];
  onProbability?: (index: number, value: string) => void;
}) {
  return (
    <div className="matrix-editor">
      <table>
        <caption className="sr-only">Matriz de pagos</caption>
        <thead>
          <tr>
            <th scope="col">{rowLabel}</th>
            {colNames.map((name, col) => (
              <th key={col} scope="col">
                <NameInput value={name} label={`${colLabel} ${col + 1}`} onChange={(value) => onColName(col, value)} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rowNames.map((name, row) => (
            <tr key={row}>
              <th scope="row">
                <NameInput value={name} label={`${rowLabel} ${row + 1}`} onChange={(value) => onRowName(row, value)} />
              </th>
              {colNames.map((colName, col) => (
                <td key={col}>
                  <DecimalInput
                    value={values[row]?.[col] ?? ""}
                    label={`Pago de ${name || rowLabel} en ${colName || colLabel}`}
                    onChange={(value) => onCell(row, col, value)}
                  />
                </td>
              ))}
            </tr>
          ))}
          {probabilityRow && onProbability ? (
            <tr>
              <th scope="row">Probabilidad</th>
              {colNames.map((colName, col) => (
                <td key={col}>
                  <DecimalInput
                    value={probabilityRow[col] ?? ""}
                    label={`Probabilidad de ${colName || colLabel}`}
                    onChange={(value) => onProbability(col, value)}
                  />
                </td>
              ))}
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

function setCell(matrix: string[][], row: number, col: number, value: string): string[][] {
  return matrix.map((line, i) => (i === row ? line.map((cell, j) => (j === col ? value : cell)) : line));
}

function TreeCard({
  node,
  index,
  ids,
  onChange,
  onRemove,
  canRemove,
}: {
  node: TreeNodeForm;
  index: number;
  ids: string[];
  onChange: (next: TreeNodeForm) => void;
  onRemove: () => void;
  canRemove: boolean;
}) {
  const options = ids.filter(Boolean).map((id) => ({ value: id, label: id }));
  return (
    <fieldset className="config-panel">
      <legend className="section-label" style={{ marginTop: 0 }}>
        Nodo {index + 1}
      </legend>
      <div className="field-grid">
        <div className="eoq-field">
          <label htmlFor={`node-id-${index}`}>Identificador</label>
          <div className="eoq-input">
            <input
              id={`node-id-${index}`}
              type="text"
              value={node.id}
              aria-label={`Identificador del nodo ${index + 1}`}
              onChange={(event) => onChange({ ...node, id: event.target.value })}
            />
          </div>
        </div>
        <div className="eoq-field">
          <span className="eoq-label" id={`node-kind-${index}`}>
            Tipo
          </span>
          <SelectDropdown
            aria-label={`Tipo del nodo ${node.id || index + 1}`}
            value={node.kind}
            options={KINDS}
            onChange={(value) =>
              onChange({
                ...node,
                kind: value as NodeKind,
                children: value === "terminal" ? [] : node.children,
              })
            }
          />
        </div>
        {node.kind === "terminal" ? (
          <TextControl
            label="Valor terminal"
            value={node.value}
            onChange={(value) => onChange({ ...node, value })}
            hint="Pago si la historia termina aquí."
          />
        ) : null}
      </div>
      {node.kind !== "terminal" ? (
        <>
          <p className="field-hint">
            {node.kind === "decision"
              ? "Cada hijo es una opción. No hace falta probabilidad."
              : "Cada hijo es un resultado posible. Las probabilidades de este nodo deben sumar 1."}
          </p>
          <div className="pert-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Hijo</th>
                  <th scope="col">Etiqueta</th>
                  {node.kind === "chance" ? <th scope="col">Probabilidad</th> : null}
                  <th scope="col">
                    <span className="sr-only">Quitar</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {node.children.map((child, childIndex) => (
                  <tr key={childIndex}>
                    <td>
                      <SelectDropdown
                        aria-label={`Hijo ${childIndex + 1} de ${node.id || "nodo"}`}
                        value={child.to}
                        options={options.length ? options : [{ value: "", label: "Agrega otro nodo" }]}
                        onChange={(value) =>
                          onChange({
                            ...node,
                            children: node.children.map((item, i) => (i === childIndex ? { ...item, to: value } : item)),
                          })
                        }
                      />
                    </td>
                    <td>
                      <input
                        className="pert-text"
                        type="text"
                        aria-label={`Etiqueta del arco ${childIndex + 1}`}
                        value={child.label}
                        onChange={(event) =>
                          onChange({
                            ...node,
                            children: node.children.map((item, i) =>
                              i === childIndex ? { ...item, label: event.target.value } : item,
                            ),
                          })
                        }
                      />
                    </td>
                    {node.kind === "chance" ? (
                      <td>
                        <DecimalInput
                          value={child.probability}
                          label={`Probabilidad del arco ${childIndex + 1}`}
                          onChange={(value) =>
                            onChange({
                              ...node,
                              children: node.children.map((item, i) =>
                                i === childIndex ? { ...item, probability: value } : item,
                              ),
                            })
                          }
                        />
                      </td>
                    ) : null}
                    <td>
                      <button
                        type="button"
                        className="btn btn-quiet"
                        onClick={() =>
                          onChange({ ...node, children: node.children.filter((_, i) => i !== childIndex) })
                        }
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
            className="btn btn-quiet"
            onClick={() =>
              onChange({
                ...node,
                children: [
                  ...node.children,
                  { to: ids.find((id) => id.trim() && id.trim() !== node.id.trim()) ?? "", label: "", probability: "" },
                ],
              })
            }
          >
            Agregar hijo
          </button>
        </>
      ) : null}
      <div className="pert-footer">
        <button type="button" className="btn btn-quiet" disabled={!canRemove} onClick={onRemove}>
          Eliminar nodo
        </button>
      </div>
    </fieldset>
  );
}

export default function DecisionEditor({ form, report, showErrors, onChange }: Props) {
  const modeHint =
    form.mode === "payoff_table"
      ? "Compara alternativas bajo varios criterios. Si conoces las probabilidades, también verás el valor esperado, el VEIP y la sensibilidad."
      : form.mode === "utility"
        ? "Los pagos se transforman a utilidad. La alternativa elegida es la de mayor utilidad esperada, aunque su valor esperado en dinero sea menor."
        : form.mode === "decision_tree"
          ? "Arma el árbol nodo por nodo. Un nodo de decisión elige el hijo de mayor valor; un nodo de azar pondera por probabilidad."
          : "A partir de la previa y de P(señal | estado) se calcula si conviene pagar por la muestra antes de actuar.";

  function patch(partial: Partial<DecisionForm>) {
    onChange({ ...form, ...partial });
  }

  return (
    <div className="pert-editor">
      <div
        className="pert-modes"
        style={{ gridTemplateColumns: "repeat(auto-fit, minmax(9.5rem, 1fr))" }}
        role="radiogroup"
        aria-label="Modo de análisis"
      >
        {MODES.map((mode) => (
          <button
            key={mode.value}
            type="button"
            role="radio"
            aria-checked={form.mode === mode.value}
            className={form.mode === mode.value ? "pert-mode is-on" : "pert-mode"}
            onClick={() => patch({ mode: mode.value })}
          >
            <strong>{mode.title}</strong>
            <span>{mode.text}</span>
          </button>
        ))}
      </div>
      <p className="field-hint">{modeHint}</p>

      <div className="sheet-toolbar" style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <button type="button" className="btn btn-quiet" onClick={() => onChange(exampleDecision("payoff"))}>
          Ejemplo: tabla (decision_01)
        </button>
        <button type="button" className="btn btn-quiet" onClick={() => onChange(exampleDecision("bayes"))}>
          Ejemplo: Bayes
        </button>
        <button type="button" className="btn btn-quiet" onClick={() => onChange(exampleDecision("utility"))}>
          Ejemplo: utilidad
        </button>
        <button type="button" className="btn btn-quiet" onClick={() => onChange(exampleDecision("tree"))}>
          Ejemplo: árbol
        </button>
      </div>

      {showErrors && report.errors.length > 0 ? (
        <ul className="pert-errors">
          {report.errors.map((error, index) => (
            <li key={`${index}-${error}`}>{error}</li>
          ))}
        </ul>
      ) : null}
      {report.hints.map((hint, index) => (
        <p className="field-hint" key={`${index}-${hint}`}>
          {hint}
        </p>
      ))}

      {form.mode === "payoff_table" || form.mode === "utility" ? (
        <>
          <div className="asg-toolbar">
            <CountBar
              label="Alternativas"
              value={form.alternatives.length}
              max={DECISION_LIMITS.alternatives}
              onChange={(count) => onChange(resizeAlternatives(form, count))}
            />
            <CountBar
              label="Estados"
              value={form.states.length}
              max={DECISION_LIMITS.states}
              onChange={(count) => onChange(resizeStates(form, count))}
            />
          </div>
          <p className="section-label">Matriz de pagos</p>
          <PayoffGrid
            rowNames={form.alternatives}
            colNames={form.states}
            values={form.payoff}
            rowLabel="Alternativa"
            colLabel="Estado"
            onRowName={(index, name) =>
              patch({ alternatives: form.alternatives.map((item, i) => (i === index ? name : item)) })
            }
            onColName={(index, name) => patch({ states: form.states.map((item, i) => (i === index ? name : item)) })}
            onCell={(row, col, value) => patch({ payoff: setCell(form.payoff, row, col, value) })}
            probabilityRow={form.useProbabilities ? form.probabilities : undefined}
            onProbability={
              form.useProbabilities
                ? (index, value) =>
                    patch({ probabilities: form.probabilities.map((item, i) => (i === index ? value : item)) })
                : undefined
            }
          />
          <label className="field-checkbox">
            <input
              type="checkbox"
              checked={form.useProbabilities}
              onChange={(event) => patch({ useProbabilities: event.target.checked })}
            />
            Conozco las probabilidades de los estados
          </label>
          <div className="field-grid">
            <div className="eoq-field">
              <span className="eoq-label" id="criterion-label">
                Criterio
              </span>
              <SelectDropdown
                aria-label="Criterio"
                value={form.criterion}
                options={CRITERIA}
                onChange={(value) => patch({ criterion: value as Criterion })}
              />
              <p className="field-hint">«Todos» calcula optimista, pesimista, arrepentimiento, Hurwicz, Laplace y, si hay probabilidades, valor esperado.</p>
            </div>
            <TextControl
              label="α de Hurwicz"
              suffix="0 a 1"
              value={form.hurwiczAlpha}
              onChange={(hurwiczAlpha) => patch({ hurwiczAlpha })}
              hint="Solo cambia el criterio de Hurwicz. α = 1 es optimista, α = 0 es pesimista y 0.5 pesa los dos por igual."
            />
          </div>
        </>
      ) : null}

      {form.mode === "utility" ? (
        <fieldset className="config-panel">
          <legend className="section-label" style={{ marginTop: 0 }}>
            Función de utilidad
          </legend>
          <div className="eoq-toggle" role="radiogroup" aria-label="Tipo de utilidad">
            {(
              [
                ["linear", "Lineal"],
                ["exponential", "Exponencial"],
                ["table", "Tabla"],
              ] as [UtilityKind, string][]
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={form.utilityKind === value}
                className={form.utilityKind === value ? "eoq-toggle-btn is-on" : "eoq-toggle-btn"}
                onClick={() => patch({ utilityKind: value })}
              >
                {label}
              </button>
            ))}
          </div>
          {form.utilityKind === "linear" ? (
            <p className="field-hint">U(x) = x. El equivalente cierto coincide con el valor esperado y la prima de riesgo es 0.</p>
          ) : null}
          {form.utilityKind === "exponential" ? (
            <TextControl
              label="Tolerancia al riesgo R"
              value={form.riskTolerance}
              onChange={(riskTolerance) => patch({ riskTolerance })}
              hint="U(x) = 1 − exp(−x/R). R > 0: aversión al riesgo. R < 0: la fórmula decrece con el pago; úsala con cuidado. R no puede ser 0."
            />
          ) : null}
          {form.utilityKind === "table" ? (
            <>
              <p className="field-hint">
                Escribe la utilidad de cada pago. Si en una fila un pago mayor tiene utilidad menor, el resultado avisa, pero igual se calcula.
              </p>
              <div className="matrix-editor">
                <table>
                  <caption className="sr-only">Matriz de utilidades</caption>
                  <thead>
                    <tr>
                      <th scope="col">Alternativa</th>
                      {form.states.map((state) => (
                        <th key={state} scope="col">
                          {state}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {form.alternatives.map((alt, row) => (
                      <tr key={row}>
                        <th scope="row">{alt}</th>
                        {form.states.map((state, col) => (
                          <td key={col}>
                            <DecimalInput
                              value={form.utilities[row]?.[col] ?? ""}
                              label={`Utilidad de ${alt} en ${state}`}
                              onChange={(value) => patch({ utilities: setCell(form.utilities, row, col, value) })}
                            />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : null}
        </fieldset>
      ) : null}

      {form.mode === "decision_tree" ? (
        <>
          <div className="field-grid">
            <div className="eoq-field">
              <span className="eoq-label">Nodo raíz</span>
              <SelectDropdown
                aria-label="Nodo raíz"
                value={form.rootId}
                options={form.tree.map((node) => ({ value: node.id, label: node.id || "(sin id)" }))}
                onChange={(rootId) => patch({ rootId })}
              />
              <p className="field-hint">El repliegue empieza aquí. También puedes pegar el árbol en «Modelo JSON» y aplicar.</p>
            </div>
          </div>
          {form.tree.map((node, index) => (
            <TreeCard
              key={index}
              node={node}
              index={index}
              ids={form.tree.map((item) => item.id)}
              canRemove={form.tree.length > 1}
              onRemove={() => onChange(removeTreeNode(form, index))}
              onChange={(next) => {
                if (next.id !== node.id) onChange(renameTreeNode({ ...form, tree: form.tree.map((item, i) => (i === index ? node : item)) }, index, next.id));
                else onChange({ ...form, tree: form.tree.map((item, i) => (i === index ? next : item)) });
              }}
            />
          ))}
          <button type="button" className="btn btn-quiet" disabled={form.tree.length >= DECISION_LIMITS.nodes} onClick={() => onChange(addTreeNode(form))}>
            Agregar nodo
          </button>
          <p className="field-hint">Máximo {DECISION_LIMITS.nodes} nodos. Los terminales llevan el pago; los de azar, probabilidades que sumen 1.</p>
        </>
      ) : null}

      {form.mode === "bayes" ? (
        <>
          <div className="asg-toolbar">
            <CountBar label="Acciones" value={form.actions.length} max={DECISION_LIMITS.alternatives} onChange={(count) => onChange(resizeActions(form, count))} />
            <CountBar label="Estados" value={form.bayesStates.length} max={DECISION_LIMITS.states} onChange={(count) => onChange(resizeBayesStates(form, count))} />
            <CountBar label="Señales" value={form.signals.length} max={DECISION_LIMITS.signals} onChange={(count) => onChange(resizeSignals(form, count))} />
          </div>
          <p className="section-label">Pagos y probabilidad previa</p>
          <PayoffGrid
            rowNames={form.actions}
            colNames={form.bayesStates}
            values={form.bayesPayoff}
            rowLabel="Acción"
            colLabel="Estado"
            onRowName={(index, name) => patch({ actions: form.actions.map((item, i) => (i === index ? name : item)) })}
            onColName={(index, name) => patch({ bayesStates: form.bayesStates.map((item, i) => (i === index ? name : item)) })}
            onCell={(row, col, value) => patch({ bayesPayoff: setCell(form.bayesPayoff, row, col, value) })}
            probabilityRow={form.prior}
            onProbability={(index, value) => patch({ prior: form.prior.map((item, i) => (i === index ? value : item)) })}
          />
          <p className="section-label">Verosimilitud P(señal | estado)</p>
          <p className="field-hint">Cada columna debería sumar 1. Si no suma, se usa tal cual y el resultado lo avisa; no se reescala en silencio.</p>
          <div className="matrix-editor">
            <table>
              <caption className="sr-only">Verosimilitud</caption>
              <thead>
                <tr>
                  <th scope="col">Señal</th>
                  {form.bayesStates.map((state, col) => (
                    <th key={col} scope="col">
                      {state}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {form.signals.map((signal, row) => (
                  <tr key={row}>
                    <th scope="row">
                      <NameInput
                        value={signal}
                        label={`Señal ${row + 1}`}
                        onChange={(value) => patch({ signals: form.signals.map((item, i) => (i === row ? value : item)) })}
                      />
                    </th>
                    {form.bayesStates.map((state, col) => (
                      <td key={col}>
                        <DecimalInput
                          value={form.likelihood[row]?.[col] ?? ""}
                          label={`P(${signal || "señal"} | ${state})`}
                          onChange={(value) => patch({ likelihood: setCell(form.likelihood, row, col, value) })}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <TextControl
            label="Costo de la muestra"
            value={form.sampleCost}
            onChange={(sampleCost) => patch({ sampleCost })}
            hint="Se resta del flujo solo si se compra la información. Déjalo en 0 si la muestra es gratis."
          />
        </>
      ) : null}
    </div>
  );
}
