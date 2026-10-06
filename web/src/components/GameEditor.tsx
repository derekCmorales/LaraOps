import { useRef, type ClipboardEvent, type KeyboardEvent } from "react";
import {
  GAME_MAX,
  GAME_MIXED_EXAMPLE,
  GAME_SADDLE_EXAMPLE,
  cellKey,
  fmtGame,
  formFromBody,
  resizeGameForm,
  type GameForm,
  type GameReport,
} from "../lib/gameForm";

type Props = {
  form: GameForm;
  report: GameReport;
  showErrors: boolean;
  onChange: (next: GameForm) => void;
};

type Pos = { r: number; c: number };

function parseGrid(text: string): string[][] | null {
  const lines = text.replace(/\r/g, "").split("\n").filter((line) => line.trim().length > 0);
  if (!lines.length) return null;
  const grid = lines.map((line) => (line.includes("\t") ? line.split("\t") : line.includes(";") ? line.split(";") : [line]));
  if (grid.length === 1 && grid[0].length === 1) return null;
  return grid;
}

export default function GameEditor({ form, report, showErrors, onChange }: Props) {
  const gridRef = useRef<HTMLDivElement>(null);
  const rows = form.rowStrategies.length;
  const cols = form.colStrategies.length;

  function focusAt(pos: Pos) {
    const r = Math.max(-1, Math.min(rows - 1, pos.r));
    const c = Math.max(-1, Math.min(cols - 1, pos.c));
    if (r === -1 && c === -1) return;
    const el = gridRef.current?.querySelector<HTMLInputElement>(`[data-r="${r}"][data-c="${c}"]`);
    el?.focus();
    el?.select();
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>, pos: Pos) {
    const input = e.currentTarget;
    const atStart = input.selectionStart === 0 && input.selectionEnd === 0;
    const atEnd = input.selectionStart === input.value.length && input.selectionEnd === input.value.length;
    const all = input.selectionStart === 0 && input.selectionEnd === input.value.length;
    let next: Pos | null = null;
    if (e.key === "ArrowDown" || (e.key === "Enter" && !e.shiftKey)) next = { r: pos.r + 1, c: pos.c };
    else if (e.key === "ArrowUp" || (e.key === "Enter" && e.shiftKey)) next = { r: pos.r - 1, c: pos.c };
    else if (e.key === "ArrowRight" && (atEnd || all)) next = { r: pos.r, c: pos.c + 1 };
    else if (e.key === "ArrowLeft" && (atStart || all)) next = { r: pos.r, c: pos.c - 1 };
    if (!next || (e.key === "Enter" && (e.metaKey || e.ctrlKey))) return;
    e.preventDefault();
    focusAt(next);
  }

  function onPaste(e: ClipboardEvent<HTMLInputElement>, pos: Pos) {
    const grid = parseGrid(e.clipboardData.getData("text/plain"));
    if (!grid || pos.r < 0 || pos.c < 0) return;
    e.preventDefault();
    const nextRows = Math.min(GAME_MAX, Math.max(rows, pos.r + grid.length));
    const width = Math.max(...grid.map((line) => line.length));
    const nextCols = Math.min(GAME_MAX, Math.max(cols, pos.c + width));
    const next = resizeGameForm(form, nextRows, nextCols);
    const cells = next.cells.map((row) => row.slice());
    grid.forEach((line, i) => {
      line.forEach((value, j) => {
        const r = pos.r + i;
        const c = pos.c + j;
        if (r < cells.length && c < cells[r].length) cells[r][c] = value.trim();
      });
    });
    onChange({ ...next, cells });
  }

  function setRowName(i: number, value: string) {
    onChange({ ...form, rowStrategies: form.rowStrategies.map((name, k) => (k === i ? value : name)) });
  }

  function setColName(j: number, value: string) {
    onChange({ ...form, colStrategies: form.colStrategies.map((name, k) => (k === j ? value : name)) });
  }

  function setCell(i: number, j: number, value: string) {
    onChange({
      ...form,
      cells: form.cells.map((row, r) => (r === i ? row.map((cell, c) => (c === j ? value : cell)) : row)),
    });
  }

  const nameMessages = [...new Set([...Object.values(report.rows), ...Object.values(report.cols)])].filter(
    (msg) => showErrors || !msg.startsWith("Falta"),
  );
  const structural = report.messages.filter((msg) => msg.includes("limitado") || msg.includes("rectangular"));
  const payMessages = showErrors
    ? report.messages.filter((msg) => !nameMessages.includes(msg) && !Object.values(report.rows).includes(msg) && !Object.values(report.cols).includes(msg))
    : structural;
  const messages = [...nameMessages, ...payMessages];

  return (
    <div>
      <p className="field-hint">
        Cada número es lo que cobra el jugador fila (y paga el de columna). La fila quiere el pago más alto y la columna el más bajo. Puedes usar coma o punto decimal.
      </p>

      <div className="sheet-toolbar">
        <button type="button" className="btn btn-quiet" onClick={() => onChange(formFromBody(GAME_MIXED_EXAMPLE))}>
          Ejemplo sin silla
        </button>
        <button type="button" className="btn btn-quiet" onClick={() => onChange(formFromBody(GAME_SADDLE_EXAMPLE))}>
          Ejemplo con silla
        </button>
        <button
          type="button"
          className="btn btn-quiet"
          disabled={rows >= GAME_MAX}
          onClick={() => onChange(resizeGameForm(form, rows + 1, cols))}
        >
          + Fila
        </button>
        <button
          type="button"
          className="btn btn-quiet"
          disabled={cols >= GAME_MAX}
          onClick={() => onChange(resizeGameForm(form, rows, cols + 1))}
        >
          + Columna
        </button>
        <button
          type="button"
          className="btn btn-quiet"
          disabled={rows <= 1}
          onClick={() => onChange(resizeGameForm(form, rows - 1, cols))}
        >
          − Fila
        </button>
        <button
          type="button"
          className="btn btn-quiet"
          disabled={cols <= 1}
          onClick={() => onChange(resizeGameForm(form, rows, cols - 1))}
        >
          − Columna
        </button>
      </div>
      <p className="field-hint">Hasta {GAME_MAX} estrategias por jugador. Las flechas y Enter mueven la celda. Pega un bloque desde una hoja de cálculo.</p>

      <div className="matrix-block">
        <p className="section-label">Matriz de pagos del jugador fila</p>
        <div className="matrix-editor" ref={gridRef}>
          <table>
            <caption className="sr-only">Pagos del jugador fila. Las columnas son las estrategias del rival.</caption>
            <thead>
              <tr>
                <th scope="col">Fila \ columna</th>
                {form.colStrategies.map((name, j) => (
                  <th key={j} scope="col">
                    <input
                      className="matrix-node"
                      data-r={-1}
                      data-c={j}
                      value={name}
                      aria-label={`Nombre de la columna ${j + 1}`}
                      aria-invalid={Boolean(report.cols[j]) && (showErrors || !report.cols[j].startsWith("Falta")) || undefined}
                      autoComplete="off"
                      onChange={(e) => setColName(j, e.target.value)}
                      onKeyDown={(e) => onKeyDown(e, { r: -1, c: j })}
                    />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {form.rowStrategies.map((rowName, i) => (
                <tr key={i}>
                  <th scope="row">
                    <input
                      className="matrix-node"
                      data-r={i}
                      data-c={-1}
                      value={rowName}
                      aria-label={`Nombre de la fila ${i + 1}`}
                      aria-invalid={Boolean(report.rows[i]) && (showErrors || !report.rows[i].startsWith("Falta")) || undefined}
                      autoComplete="off"
                      onChange={(e) => setRowName(i, e.target.value)}
                      onKeyDown={(e) => onKeyDown(e, { r: i, c: -1 })}
                    />
                  </th>
                  {form.colStrategies.map((colName, j) => {
                    const error = report.cells[cellKey(i, j)];
                    const invalid = Boolean(showErrors && error);
                    return (
                      <td key={j}>
                        <input
                          className="matrix-cell"
                          data-r={i}
                          data-c={j}
                          inputMode="decimal"
                          autoComplete="off"
                          value={form.cells[i]?.[j] ?? ""}
                          aria-label={`Pago de ${rowName.trim() || `fila ${i + 1}`} contra ${colName.trim() || `columna ${j + 1}`}`}
                          aria-invalid={invalid || undefined}
                          title={invalid ? error : undefined}
                          style={{ textAlign: "right", boxShadow: invalid ? "inset 0 0 0 2px var(--error)" : undefined }}
                          onChange={(e) => setCell(i, j, e.target.value)}
                          onKeyDown={(e) => onKeyDown(e, { r: i, c: j })}
                          onPaste={(e) => onPaste(e, { r: i, c: j })}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {messages.length > 0 ? (
        <div className="error-inline" role="alert">
          {messages.map((msg) => (
            <p key={msg}>{msg}</p>
          ))}
        </div>
      ) : null}

      {report.maximin != null && report.minimax != null ? (
        <div className="eoq-preview">
          <span className="eoq-preview-label">Vista previa</span>
          <p className="eoq-formula">
            Maximin = <strong>{fmtGame(report.maximin)}</strong> · Minimax = <strong>{fmtGame(report.minimax)}</strong>
          </p>
          <p className="eoq-preview-facts">
            {report.saddle
              ? "Esos dos coinciden: hay al menos un punto de silla en estrategias puras."
              : "No coinciden: el valor del juego está en estrategias mixtas. Al resolver se quitan, si las hay, las estrategias estrictamente dominadas."}
          </p>
        </div>
      ) : null}
    </div>
  );
}
