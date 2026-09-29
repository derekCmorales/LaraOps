import { useEffect, useState } from "react";
import { SmartNumberInput } from "./FormFields";
import type { Matrix } from "../lib/networkSheet";

type Props = {
  label: string;
  hint?: string;
  nodes: string[];
  values: Matrix;
  onRename: (index: number, name: string) => boolean;
  onAddNode: () => void;
  onRemoveNode: (index: number) => void;
  onChange: (row: number, col: number, value: number | null) => void;
  diagonal: "blank" | "zero";
  supply?: number[];
  onSupplyChange?: (index: number, value: number) => void;
  linkCount?: number;
  lockStructure?: boolean;
};

function NodeName({
  value,
  onCommit,
}: {
  value: string;
  onCommit: (name: string) => boolean;
}) {
  const [draft, setDraft] = useState(value);
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    setDraft(value);
    setInvalid(false);
  }, [value]);

  function commit() {
    const next = draft.trim();
    if (!next || next === value) {
      setDraft(value);
      setInvalid(false);
      return;
    }
    const ok = onCommit(next);
    if (!ok) {
      setInvalid(true);
      setDraft(value);
      return;
    }
    setInvalid(false);
  }

  return (
    <input
      className="matrix-node"
      type="text"
      value={draft}
      aria-invalid={invalid}
      title={invalid ? "Ese nombre ya existe" : undefined}
      aria-label={`Nombre del nodo ${value}`}
      onChange={(e) => {
        setInvalid(false);
        setDraft(e.target.value);
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}

function OptionalNumber({
  value,
  onChange,
  ariaLabel,
}: {
  value: number | null;
  onChange: (n: number | null) => void;
  ariaLabel: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft != null ? draft : value == null ? "" : formatCell(value);

  return (
    <input
      className="matrix-cell num-input"
      type="text"
      inputMode="decimal"
      autoComplete="off"
      spellCheck={false}
      placeholder="·"
      aria-label={ariaLabel}
      value={shown}
      onFocus={() => setDraft(value == null ? "" : formatCell(value))}
      onBlur={() => setDraft(null)}
      onChange={(e) => {
        const val = e.target.value;
        const parsed = parseCell(val);
        if (parsed.invalid) return;
        setDraft(val);
        if (val.trim() === "") onChange(null);
        else if (parsed.value != null) onChange(parsed.value);
      }}
    />
  );
}

function formatCell(value: number): string {
  return value.toLocaleString("es-MX", { useGrouping: false, maximumFractionDigits: 12 });
}

function parseCell(raw: string): { value: number | null; partial: boolean; invalid: boolean } {
  const t = raw.trim().replace(/\s/g, "");
  if (t === "") return { value: null, partial: true, invalid: false };
  if (!/^-?\d*([.,]\d*)?$/.test(t)) return { value: null, partial: false, invalid: true };
  if (t === "-" || t === "." || t === "," || t === "-." || t === "-,") {
    return { value: null, partial: true, invalid: false };
  }
  const norm = t.replace(",", ".");
  if (norm.endsWith(".")) {
    const n = Number(norm.slice(0, -1));
    return { value: Number.isFinite(n) ? n : null, partial: true, invalid: false };
  }
  const n = Number(norm);
  if (!Number.isFinite(n)) return { value: null, partial: false, invalid: true };
  return { value: n, partial: false, invalid: false };
}

export default function IntersectionMatrix({
  label,
  hint,
  nodes,
  values,
  onRename,
  onAddNode,
  onRemoveNode,
  onChange,
  diagonal,
  supply,
  onSupplyChange,
  linkCount,
  lockStructure = false,
}: Props) {
  const showSupply = supply != null && onSupplyChange != null;

  return (
    <div className="matrix-block">
      <p className="section-label">{label}</p>
      {hint ? <p className="field-hint" style={{ marginBottom: 8 }}>{hint}</p> : null}
      {lockStructure ? null : (
        <div className="sheet-toolbar">
          <button type="button" className="btn btn-quiet" onClick={onAddNode}>
            + Nodo
          </button>
        </div>
      )}
      <div className="matrix-editor">
        <table>
          <caption className="sr-only">{label}</caption>
          <thead>
            <tr>
              <th scope="col">Desde \ hacia</th>
              {nodes.map((node) => (
                <th key={node} scope="col">
                  {node}
                </th>
              ))}
              {showSupply ? <th scope="col">Oferta</th> : null}
              {lockStructure ? null : (
                <th scope="col" className="sr-only">
                  Acciones
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {nodes.map((node, r) => (
              <tr key={`${node}-${r}`}>
                <th scope="row">
                  {lockStructure ? (
                    node
                  ) : (
                    <NodeName value={node} onCommit={(name) => onRename(r, name)} />
                  )}
                </th>
                {nodes.map((col, c) =>
                  r === c ? (
                    <td key={col} className="matrix-gap">
                      {diagonal === "zero" ? (
                        <input
                          className="matrix-cell"
                          value="0"
                          disabled
                          aria-label={`${node} consigo mismo`}
                        />
                      ) : (
                        <span aria-label={`${node} consigo mismo, sin arco`}>—</span>
                      )}
                    </td>
                  ) : (
                    <td key={col}>
                      <OptionalNumber
                        value={values[r]?.[c] ?? null}
                        onChange={(n) => onChange(r, c, n)}
                        ariaLabel={`${node} hacia ${col}`}
                      />
                    </td>
                  ),
                )}
                {showSupply ? (
                  <td className="matrix-supply">
                    <SmartNumberInput
                      className="matrix-cell"
                      value={supply[r] ?? 0}
                      onChange={(n) => onSupplyChange(r, n)}
                      aria-label={`Oferta de ${node}`}
                    />
                  </td>
                ) : null}
                {lockStructure ? null : (
                  <td>
                    <button
                      type="button"
                      className="btn btn-quiet"
                      onClick={() => onRemoveNode(r)}
                      disabled={nodes.length <= 2}
                      aria-label={`Quitar nodo ${node}`}
                    >
                      −
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {linkCount != null ? (
        <p className="field-hint">
          {linkCount === 1 ? "1 conexión" : `${linkCount} conexiones`}
          {" · vacío = sin arco · la coma vale como decimal (1,5)"}
        </p>
      ) : null}
    </div>
  );
}
