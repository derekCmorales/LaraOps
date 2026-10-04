import { useRef, useState, type ClipboardEvent, type KeyboardEvent } from "react";
import {
  ASSIGNMENT_MAX_DIM,
  cellKey,
  formFromLabeledGrid,
  parseCell,
  parseClipboardGrid,
  pasteBlock,
  removeAgent,
  removeTask,
  resizeForm,
  shapeSummary,
  type AssignmentForm,
  type AssignmentReport,
  type AssignmentSense,
} from "../lib/assignmentForm";

type Props = {
  form: AssignmentForm;
  report: AssignmentReport;
  /** Marca celdas vacías solo después del primer intento de resolver. */
  showErrors: boolean;
  onChange: (next: AssignmentForm) => void;
};

const SENSES: { value: AssignmentSense; label: string; hint: string }[] = [
  {
    value: "min",
    label: "Minimizar costo",
    hint: "Los valores son costos, tiempos o distancias: se busca el total más bajo.",
  },
  {
    value: "max",
    label: "Maximizar ganancia",
    hint: "Los valores son ganancias, puntajes o eficiencias: se busca el total más alto.",
  },
];

/** Coordenadas de la cuadrícula: fila -1 = nombres de tareas, columna -1 = nombres de agentes. */
type Pos = { r: number; c: number };

function Stepper({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (next: number) => void;
}) {
  return (
    <div className="asg-stepper" role="group" aria-label={label}>
      <span className="asg-stepper-label">{label}</span>
      <button
        type="button"
        className="asg-stepper-btn"
        aria-label={`Quitar ${label.toLowerCase()}`}
        disabled={value <= 1}
        onClick={() => onChange(value - 1)}
      >
        −
      </button>
      <output className="asg-stepper-value" aria-live="polite">
        {value}
      </output>
      <button
        type="button"
        className="asg-stepper-btn"
        aria-label={`Agregar ${label.toLowerCase()}`}
        disabled={value >= ASSIGNMENT_MAX_DIM}
        onClick={() => onChange(value + 1)}
      >
        +
      </button>
    </div>
  );
}

export default function AssignmentEditor({ form, report, showErrors, onChange }: Props) {
  const gridRef = useRef<HTMLDivElement>(null);
  const [focus, setFocus] = useState<Pos | null>(null);
  const rows = form.agents.length;
  const cols = form.tasks.length;
  const valueWord = form.sense === "max" ? "ganancia" : "costo";

  function focusCell(pos: Pos) {
    const r = Math.max(-1, Math.min(rows - 1, pos.r));
    const c = Math.max(-1, Math.min(cols - 1, pos.c));
    if (r === -1 && c === -1) return;
    const el = gridRef.current?.querySelector<HTMLInputElement>(`[data-r="${r}"][data-c="${c}"]`);
    if (el) {
      el.focus();
      el.select();
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>, pos: Pos) {
    const input = e.currentTarget;
    const atStart = input.selectionStart === 0 && input.selectionEnd === 0;
    const atEnd = input.selectionStart === input.value.length && input.selectionEnd === input.value.length;
    const allSelected = input.selectionStart === 0 && input.selectionEnd === input.value.length;
    let next: Pos | null = null;
    if (e.key === "ArrowDown" || (e.key === "Enter" && !e.shiftKey)) next = { r: pos.r + 1, c: pos.c };
    else if (e.key === "ArrowUp" || (e.key === "Enter" && e.shiftKey)) next = { r: pos.r - 1, c: pos.c };
    else if (e.key === "ArrowRight" && (atEnd || allSelected)) next = { r: pos.r, c: pos.c + 1 };
    else if (e.key === "ArrowLeft" && (atStart || allSelected)) next = { r: pos.r, c: pos.c - 1 };
    if (!next) return;
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) return; // Ctrl+Enter resuelve.
    e.preventDefault();
    if (e.key === "Enter" && !e.shiftKey && pos.r === rows - 1 && pos.c >= 0) {
      // Enter en la última fila salta al inicio de la siguiente columna.
      focusCell({ r: 0, c: Math.min(cols - 1, pos.c + 1) });
      return;
    }
    focusCell(next);
  }

  function onPaste(e: ClipboardEvent<HTMLInputElement>, pos: Pos) {
    const grid = parseClipboardGrid(e.clipboardData.getData("text/plain"));
    if (!grid) return;
    e.preventDefault();
    const labeled = formFromLabeledGrid(grid, form.sense);
    if (labeled) {
      onChange(labeled);
      return;
    }
    if (pos.r === -1) {
      const names = grid[0];
      const resized = resizeForm(form, rows, Math.max(cols, pos.c + names.length));
      const tasks = resized.tasks.slice();
      names.forEach((name, k) => {
        if (pos.c + k < tasks.length) tasks[pos.c + k] = name;
      });
      onChange({ ...resized, tasks });
      return;
    }
    if (pos.c === -1) {
      const names = grid.map((line) => line[0] ?? "");
      const values = grid.map((line) => line.slice(1));
      let next = resizeForm(form, Math.max(rows, pos.r + names.length), cols);
      const agents = next.agents.slice();
      names.forEach((name, k) => {
        if (pos.r + k < agents.length) agents[pos.r + k] = name;
      });
      next = { ...next, agents };
      if (values.some((v) => v.length)) next = pasteBlock(next, pos.r, 0, values);
      onChange(next);
      return;
    }
    onChange(pasteBlock(form, pos.r, pos.c, grid));
  }

  function setCell(r: number, c: number, value: string) {
    onChange({ ...form, cells: form.cells.map((row, i) => (i === r ? row.map((v, j) => (j === c ? value : v)) : row)) });
  }

  function transpose() {
    onChange({
      ...form,
      agents: form.tasks.slice(),
      tasks: form.agents.slice(),
      cells: form.tasks.map((_, j) => form.agents.map((_, i) => form.cells[i]?.[j] ?? "")),
    });
  }

  function clearValues() {
    onChange({ ...form, cells: form.cells.map((row) => row.map(() => "")) });
  }

  const messages = showErrors ? report.messages : report.messages.filter((m) => !m.startsWith("Falta"));
  const cellError = (r: number, c: number) => {
    const msg = report.cells[cellKey(r, c)];
    if (!msg) return undefined;
    return showErrors || !msg.startsWith("Falta") ? msg : undefined;
  };

  return (
    <div className="asg-editor">
      <div className="pert-modes asg-senses" role="radiogroup" aria-label="Objetivo">
        {SENSES.map((s) => (
          <button
            key={s.value}
            type="button"
            role="radio"
            aria-checked={form.sense === s.value}
            className={form.sense === s.value ? "pert-mode is-on" : "pert-mode"}
            onClick={() => onChange({ ...form, sense: s.value })}
          >
            <strong>{s.label}</strong>
            <span>{s.hint}</span>
          </button>
        ))}
      </div>

      <div className="asg-toolbar">
        <Stepper label="Agentes (filas)" value={rows} onChange={(n) => onChange(resizeForm(form, n, cols))} />
        <Stepper label="Tareas (columnas)" value={cols} onChange={(n) => onChange(resizeForm(form, rows, n))} />
        <span className="asg-toolbar-spacer" />
        <button type="button" className="btn btn-quiet" onClick={transpose} title="Las filas pasan a columnas">
          Intercambiar filas y columnas
        </button>
        <button type="button" className="btn btn-quiet" onClick={clearValues}>
          Vaciar valores
        </button>
      </div>

      {messages.length > 0 && (
        <ul className="pert-errors" role="alert">
          {messages.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      )}

      <div className="asg-grid-wrap" ref={gridRef}>
        <table className="asg-grid">
          <caption className="sr-only">
            Matriz de {valueWord}s: filas = agentes, columnas = tareas
          </caption>
          <thead>
            <tr>
              <th scope="col" className="asg-corner">
                <span>Agente</span>
                <span aria-hidden>╲</span>
                <span>Tarea</span>
              </th>
              {form.tasks.map((task, j) => (
                <th key={j} scope="col" className={focus?.c === j ? "asg-head is-focus" : "asg-head"}>
                  <div className="asg-head-inner">
                    <input
                      className={report.tasks[j] ? "asg-name is-invalid" : "asg-name"}
                      value={task}
                      data-r={-1}
                      data-c={j}
                      aria-label={`Nombre de la tarea ${j + 1}`}
                      aria-invalid={report.tasks[j] ? true : undefined}
                      title={report.tasks[j]}
                      onFocus={() => setFocus({ r: -1, c: j })}
                      onBlur={() => setFocus(null)}
                      onKeyDown={(e) => onKeyDown(e, { r: -1, c: j })}
                      onPaste={(e) => onPaste(e, { r: -1, c: j })}
                      onChange={(e) => onChange({ ...form, tasks: form.tasks.map((t, k) => (k === j ? e.target.value : t)) })}
                    />
                    <button
                      type="button"
                      className="asg-remove"
                      aria-label={`Quitar la tarea ${task || j + 1}`}
                      title="Quitar columna"
                      disabled={cols <= 1}
                      onClick={() => onChange(removeTask(form, j))}
                    >
                      ×
                    </button>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {form.agents.map((agent, i) => (
              <tr key={i}>
                <th scope="row" className={focus?.r === i ? "asg-head asg-row-head is-focus" : "asg-head asg-row-head"}>
                  <div className="asg-head-inner">
                    <input
                      className={report.agents[i] ? "asg-name is-invalid" : "asg-name"}
                      value={agent}
                      data-r={i}
                      data-c={-1}
                      aria-label={`Nombre del agente ${i + 1}`}
                      aria-invalid={report.agents[i] ? true : undefined}
                      title={report.agents[i]}
                      onFocus={() => setFocus({ r: i, c: -1 })}
                      onBlur={() => setFocus(null)}
                      onKeyDown={(e) => onKeyDown(e, { r: i, c: -1 })}
                      onPaste={(e) => onPaste(e, { r: i, c: -1 })}
                      onChange={(e) =>
                        onChange({ ...form, agents: form.agents.map((a, k) => (k === i ? e.target.value : a)) })
                      }
                    />
                    <button
                      type="button"
                      className="asg-remove"
                      aria-label={`Quitar al agente ${agent || i + 1}`}
                      title="Quitar fila"
                      disabled={rows <= 1}
                      onClick={() => onChange(removeAgent(form, i))}
                    >
                      ×
                    </button>
                  </div>
                </th>
                {form.tasks.map((task, j) => {
                  const text = form.cells[i]?.[j] ?? "";
                  const parsed = parseCell(text);
                  const error = cellError(i, j);
                  const cls = [
                    "asg-cell",
                    parsed.forbidden ? "is-forbidden" : "",
                    error ? "is-invalid" : "",
                    focus && (focus.r === i || focus.c === j) ? "is-cross" : "",
                  ]
                    .filter(Boolean)
                    .join(" ");
                  return (
                    <td key={j} className={cls}>
                      <input
                        type="text"
                        inputMode="decimal"
                        autoComplete="off"
                        spellCheck={false}
                        placeholder="—"
                        value={text}
                        data-r={i}
                        data-c={j}
                        aria-label={`${valueWord} de ${agent || `agente ${i + 1}`} en ${task || `tarea ${j + 1}`}${
                          parsed.forbidden ? " (prohibida)" : ""
                        }`}
                        aria-invalid={error ? true : undefined}
                        title={error ?? (parsed.forbidden ? "Asignación prohibida" : undefined)}
                        onFocus={(e) => {
                          setFocus({ r: i, c: j });
                          e.currentTarget.select();
                        }}
                        onBlur={() => setFocus(null)}
                        onKeyDown={(e) => onKeyDown(e, { r: i, c: j })}
                        onPaste={(e) => onPaste(e, { r: i, c: j })}
                        onChange={(e) => setCell(i, j, e.target.value)}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="asg-legend">
        <p className="field-hint">
          <strong>{shapeSummary(rows, cols)}</strong>
          {report.forbiddenCount > 0
            ? ` ${report.forbiddenCount === 1 ? "Hay 1 asignación prohibida." : `Hay ${report.forbiddenCount} asignaciones prohibidas.`}`
            : ""}
        </p>
        <p className="field-hint">
          Escribe <span className="asg-chip asg-chip-m">M</span> (o x) en una celda para prohibir esa pareja. Enter baja
          a la siguiente fila y las flechas mueven entre celdas. Puedes pegar una tabla desde Excel o Sheets: si trae
          nombres en la primera fila y columna, se usan como tareas y agentes.
        </p>
      </div>
    </div>
  );
}
