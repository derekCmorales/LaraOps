/** Cuadrícula editable de filas con columnas tipadas (sustituye textareas). */
import { SmartNumberInput } from "./FormFields";

export type RecordColumn = {
  key: string;
  label: string;
  type: "text" | "number";
};

type Props<T extends Record<string, string | number>> = {
  label?: string;
  columns: RecordColumn[];
  rows: T[];
  onChange: (rows: T[]) => void;
  emptyRow: () => T;
};

export default function RecordGrid<T extends Record<string, string | number>>({
  label,
  columns,
  rows,
  onChange,
  emptyRow,
}: Props<T>) {
  function updateCell(rowIdx: number, key: string, raw: string | number) {
    const col = columns.find((c) => c.key === key);
    if (!col) return;
    const val = col.type === "number" ? (raw === "" ? 0 : Number(raw)) : raw;
    if (col.type === "number" && !Number.isFinite(val as number)) return;
    onChange(rows.map((r, i) => (i === rowIdx ? { ...r, [key]: val } : r)));
  }

  function removeRow(idx: number) {
    if (rows.length <= 1) return;
    onChange(rows.filter((_, i) => i !== idx));
  }

  return (
    <div className="matrix-block">
      {label ? <p className="section-label">{label}</p> : null}
      <div className="sheet-toolbar">
        <button type="button" className="btn btn-quiet" onClick={() => onChange([...rows, emptyRow()])}>
          + Fila
        </button>
      </div>
      <div className="matrix-editor">
        <table>
          <caption className="sr-only">{label ?? "Tabla de datos"}</caption>
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.key} scope="col">
                  {c.label}
                </th>
              ))}
              <th scope="col" className="sr-only">
                Acciones
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => (
              <tr key={ri}>
                {columns.map((c) => (
                  <td key={c.key}>
                    {c.type === "number" ? (
                      <SmartNumberInput
                        className="matrix-cell"
                        step="any"
                        value={Number(row[c.key] ?? 0)}
                        onChange={(n) => updateCell(ri, c.key, n)}
                        aria-label={`${c.label}, fila ${ri + 1}`}
                      />
                    ) : (
                      <input
                        className="matrix-cell"
                        type="text"
                        value={row[c.key] ?? ""}
                        onChange={(e) => updateCell(ri, c.key, e.target.value)}
                        style={{ fontFamily: "var(--font-data)" }}
                        aria-label={`${c.label}, fila ${ri + 1}`}
                      />
                    )}
                  </td>
                ))}
                <td>
                  <button
                    type="button"
                    className="btn btn-quiet"
                    onClick={() => removeRow(ri)}
                    disabled={rows.length <= 1}
                    aria-label={`Eliminar fila ${ri + 1}`}
                  >
                    −
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
