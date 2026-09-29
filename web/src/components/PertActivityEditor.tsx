import { useEffect, useId, useRef, useState } from "react";
import { parseDecimalDraft } from "./FormFields";
import SelectDropdown from "./SelectDropdown";
import {
  blankRow,
  crashSlope,
  expectedTime,
  formatQty,
  pertVariance,
  type PertFieldError,
  type PertRow,
  type TimeUnit,
} from "../lib/pertForm";

type Mode = "cpm" | "pert" | "crash";

type Props = {
  rows: PertRow[];
  mode: Mode;
  unit: TimeUnit;
  crashTarget: string;
  targetTime: string;
  targetProbability: string;
  errors: PertFieldError[];
  formErrors: string[];
  onRows: (rows: PertRow[]) => void;
  onMode: (mode: Mode) => void;
  onUnit: (unit: TimeUnit) => void;
  onCrashTarget: (value: string) => void;
  onTargetTime: (value: string) => void;
  onTargetProbability: (value: string) => void;
  onLoadCrashExample: () => void;
};

const UNITS: { value: TimeUnit; label: string }[] = [
  { value: "días", label: "Días" },
  { value: "semanas", label: "Semanas" },
  { value: "horas", label: "Horas" },
  { value: "periodos", label: "Periodos" },
];

function formatDraft(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "";
  return value.toLocaleString("es-MX", { useGrouping: false, maximumFractionDigits: 12 });
}

function DecimalCell({
  value,
  onChange,
  label,
  invalid,
}: {
  value: number | null | undefined;
  onChange: (next: number | null) => void;
  label: string;
  invalid?: boolean;
}) {
  const [text, setText] = useState(() => formatDraft(value));
  const focused = useRef(false);

  useEffect(() => {
    if (focused.current) return;
    setText(formatDraft(value));
  }, [value]);

  function commit(raw: string) {
    const trimmed = raw.trim();
    if (!trimmed) {
      onChange(null);
      setText("");
      return;
    }
    const parsed = parseDecimalDraft(trimmed);
    if (parsed.invalid || parsed.value == null) return;
    onChange(parsed.value);
    setText(formatDraft(parsed.value));
  }

  return (
    <input
      className={invalid ? "pert-num is-invalid" : "pert-num"}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      spellCheck={false}
      aria-label={label}
      aria-invalid={invalid || undefined}
      placeholder="—"
      value={text}
      onFocus={() => {
        focused.current = true;
      }}
      onBlur={() => {
        focused.current = false;
        commit(text);
      }}
      onChange={(event) => {
        const next = event.target.value;
        if (next.trim() !== "" && parseDecimalDraft(next).invalid) return;
        setText(next);
        const parsed = parseDecimalDraft(next);
        if (!next.trim()) onChange(null);
        else if (!parsed.invalid && !parsed.partial && parsed.value != null) onChange(parsed.value);
      }}
    />
  );
}

function TextCell({
  value,
  onChange,
  label,
  invalid,
  placeholder,
}: {
  value: string;
  onChange: (next: string) => void;
  label: string;
  invalid?: boolean;
  placeholder?: string;
}) {
  return (
    <input
      className={invalid ? "pert-text is-invalid" : "pert-text"}
      type="text"
      aria-label={label}
      aria-invalid={invalid || undefined}
      placeholder={placeholder}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

export default function PertActivityEditor({
  rows,
  mode,
  unit,
  crashTarget,
  targetTime,
  targetProbability,
  errors,
  formErrors,
  onRows,
  onMode,
  onUnit,
  onCrashTarget,
  onTargetTime,
  onTargetProbability,
  onLoadCrashExample,
}: Props) {
  const targetId = useId();
  const timeId = useId();
  const probId = useId();
  const unitId = useId();
  const invalid = (uid: string, field: string) => errors.some((error) => error.uid === uid && error.field === field);

  function patch(uid: string, partial: Partial<PertRow>) {
    onRows(rows.map((row) => (row.uid === uid ? { ...row, ...partial } : row)));
  }

  function addRow() {
    onRows([...rows, blankRow(rows.map((row) => row.id))]);
  }

  function removeRow(uid: string) {
    onRows(rows.filter((row) => row.uid !== uid));
  }

  const names = rows.map((row) => row.id.trim()).filter(Boolean);

  return (
    <div className="pert-editor">
      <div className="pert-modes" role="tablist" aria-label="Método">
        {(
          [
            ["cpm", "CPM", "Duración fija"],
            ["pert", "PERT", "Tres estimaciones"],
            ["crash", "Aceleración", "Tiempo y costo"],
          ] as const
        ).map(([value, label, hint]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={mode === value}
            className={mode === value ? "pert-mode is-on" : "pert-mode"}
            onClick={() => onMode(value)}
          >
            <strong>{label}</strong>
            <span>{hint}</span>
          </button>
        ))}
      </div>

      <div className="pert-options">
        <div className="field">
          <label htmlFor={unitId}>Unidad de tiempo</label>
          <SelectDropdown
            id={unitId}
            value={unit}
            onChange={(value) => onUnit(value as TimeUnit)}
            aria-label="Unidad de tiempo"
            options={UNITS}
          />
        </div>
        {mode === "crash" && (
          <div className="field">
            <label htmlFor={targetId}>Duración objetivo</label>
            <input
              id={targetId}
              className="num-input"
              type="text"
              inputMode="decimal"
              value={crashTarget}
              placeholder="10"
              onChange={(event) => onCrashTarget(event.target.value)}
            />
          </div>
        )}
        {mode === "pert" && (
          <>
            <div className="field">
              <label htmlFor={timeId}>Tiempo objetivo</label>
              <input
                id={timeId}
                className="num-input"
                type="text"
                inputMode="decimal"
                value={targetTime}
                placeholder="opcional"
                onChange={(event) => onTargetTime(event.target.value)}
              />
              <p className="field-hint">Calcula P(terminar en ese tiempo o antes).</p>
            </div>
            <div className="field">
              <label htmlFor={probId}>Probabilidad deseada</label>
              <input
                id={probId}
                className="num-input"
                type="text"
                inputMode="decimal"
                value={targetProbability}
                placeholder="0,95"
                onChange={(event) => onTargetProbability(event.target.value)}
              />
              <p className="field-hint">Entre 0 y 1. Devuelve la duración que cumple esa probabilidad.</p>
            </div>
          </>
        )}
        {mode === "crash" && (
          <button type="button" className="btn btn-ghost" onClick={onLoadCrashExample}>
            Ejemplo de aceleración
          </button>
        )}
      </div>

      <p className="field-hint pert-lead">
        {mode === "cpm" &&
          "Cada fila es una actividad. La duración es fija y los predecesores, separados por coma, dicen de quién depende. Igual que la tabla de tareas de un cronograma."}
        {mode === "pert" &&
          "PERT no usa una sola duración: captura el optimista (a), el más probable (m) y el pesimista (b). El tiempo esperado es te = (a + 4m + b) / 6."}
        {mode === "crash" &&
          "La aceleración acorta la ruta crítica al menor costo hasta la duración objetivo. Si hay caminos paralelos, se acortan juntos: recortar solo uno no adelanta el proyecto."}
      </p>

      {(formErrors.length > 0 || errors.length > 0) && (
        <ul className="pert-errors" role="alert">
          {formErrors.map((message) => (
            <li key={message}>{message}</li>
          ))}
          {errors.map((error) => (
            <li key={`${error.uid}-${error.field}-${error.message}`}>{error.message}</li>
          ))}
        </ul>
      )}

      <div className="pert-table-wrap">
        <table className="pert-table">
          <caption className="sr-only">Actividades del proyecto</caption>
          <thead>
            <tr>
              <th scope="col">Actividad</th>
              <th scope="col">Predecesores</th>
              {mode !== "pert" && <th scope="col">Duración ({unit})</th>}
              {mode === "pert" && (
                <>
                  <th scope="col">Optimista a</th>
                  <th scope="col">Más probable m</th>
                  <th scope="col">Pesimista b</th>
                  <th scope="col">te</th>
                  <th scope="col">σ²</th>
                </>
              )}
              {mode === "crash" && (
                <>
                  <th scope="col">Tiempo crash</th>
                  <th scope="col">Costo normal</th>
                  <th scope="col">Costo crash</th>
                  <th scope="col">Pendiente</th>
                </>
              )}
              <th scope="col">
                <span className="sr-only">Acciones</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td className="pert-empty" colSpan={mode === "pert" ? 8 : mode === "crash" ? 8 : 4}>
                  Todavía no hay actividades.
                </td>
              </tr>
            ) : (
              rows.map((row) => {
                const te =
                  row.a != null && row.m != null && row.b != null && row.a <= row.m && row.m <= row.b
                    ? expectedTime(row.a, row.m, row.b)
                    : null;
                const variance = row.a != null && row.b != null && row.b >= row.a ? pertVariance(row.a, row.b) : null;
                const slope =
                  row.duration != null && row.crash_time != null && row.normal_cost != null && row.crash_cost != null
                    ? crashSlope(row.duration, row.crash_time, row.normal_cost, row.crash_cost)
                    : null;
                const pertInvalid = invalid(row.uid, "pert");
                const crashInvalid = invalid(row.uid, "crash");
                return (
                  <tr key={row.uid}>
                    <td>
                      <TextCell
                        value={row.id}
                        label={`Nombre de la actividad ${row.id || ""}`}
                        invalid={invalid(row.uid, "id")}
                        onChange={(id) => patch(row.uid, { id })}
                      />
                    </td>
                    <td>
                      <TextCell
                        value={row.predText}
                        label={`Predecesores de ${row.id || "la actividad"}`}
                        placeholder="ninguno"
                        invalid={invalid(row.uid, "preds")}
                        onChange={(predText) => patch(row.uid, { predText })}
                      />
                    </td>
                    {mode !== "pert" && (
                      <td>
                        <DecimalCell
                          value={row.duration}
                          label={`Duración de ${row.id || "la actividad"}`}
                          invalid={invalid(row.uid, "duration")}
                          onChange={(duration) => patch(row.uid, { duration })}
                        />
                      </td>
                    )}
                    {mode === "pert" && (
                      <>
                        <td>
                          <DecimalCell
                            value={row.a}
                            label={`Optimista de ${row.id}`}
                            invalid={pertInvalid}
                            onChange={(a) => patch(row.uid, { a })}
                          />
                        </td>
                        <td>
                          <DecimalCell
                            value={row.m}
                            label={`Más probable de ${row.id}`}
                            invalid={pertInvalid}
                            onChange={(m) => patch(row.uid, { m })}
                          />
                        </td>
                        <td>
                          <DecimalCell
                            value={row.b}
                            label={`Pesimista de ${row.id}`}
                            invalid={pertInvalid}
                            onChange={(b) => patch(row.uid, { b })}
                          />
                        </td>
                        <td className="pert-calc">{te == null ? "—" : formatQty(te)}</td>
                        <td className="pert-calc">{variance == null ? "—" : formatQty(variance)}</td>
                      </>
                    )}
                    {mode === "crash" && (
                      <>
                        <td>
                          <DecimalCell
                            value={row.crash_time}
                            label={`Tiempo crash de ${row.id}`}
                            invalid={crashInvalid}
                            onChange={(crash_time) => patch(row.uid, { crash_time })}
                          />
                        </td>
                        <td>
                          <DecimalCell
                            value={row.normal_cost}
                            label={`Costo normal de ${row.id}`}
                            invalid={crashInvalid}
                            onChange={(normal_cost) => patch(row.uid, { normal_cost })}
                          />
                        </td>
                        <td>
                          <DecimalCell
                            value={row.crash_cost}
                            label={`Costo crash de ${row.id}`}
                            invalid={crashInvalid}
                            onChange={(crash_cost) => patch(row.uid, { crash_cost })}
                          />
                        </td>
                        <td className="pert-calc">{slope == null ? "—" : formatQty(slope)}</td>
                      </>
                    )}
                    <td>
                      <button
                        type="button"
                        className="btn btn-quiet pert-remove"
                        aria-label={`Quitar actividad ${row.id || ""}`.trim()}
                        onClick={() => removeRow(row.uid)}
                      >
                        Quitar
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="pert-footer">
        <button type="button" className="btn btn-ghost" onClick={addRow}>
          Agregar actividad
        </button>
        <p className="field-hint">
          {names.length
            ? `Actividades: ${names.join(", ")}. Una duración vacía no es cero: escríbela, aunque sea 0 para un hito.`
            : "Agrega la primera actividad para armar la red."}
          {mode === "pert" && " Varianza σ² = ((b − a) / 6)²."}
          {mode === "crash" && " Pendiente = (costo crash − costo normal) / (duración − tiempo crash)."}
        </p>
      </div>
    </div>
  );
}
