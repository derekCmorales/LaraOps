import { ChangeEvent, useId, useState, useEffect } from "react";
import SelectDropdown from "./SelectDropdown";

type FieldProps = {
  label: string;
  hint?: string;
  htmlFor?: string;
  children: React.ReactNode;
};

export function Field({ label, hint, htmlFor, children }: FieldProps) {
  return (
    <div className="field">
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {hint ? <p className="field-hint">{hint}</p> : null}
    </div>
  );
}

export function FieldGrid({ children }: { children: React.ReactNode }) {
  return <div className="field-grid">{children}</div>;
}

type NumProps = {
  label: string;
  value: number;
  onChange: (n: number) => void;
  step?: number;
  min?: number;
  hint?: string;
};

export function SmartNumberInput({
  value,
  onChange,
  className,
  id,
  step,
  min,
  "aria-label": ariaLabel,
}: {
  value: number;
  onChange: (n: number) => void;
  className?: string;
  id?: string;
  step?: string | number;
  min?: number;
  "aria-label"?: string;
}) {
  const [str, setStr] = useState(value.toString());

  useEffect(() => {
    if ((str === "" || str === "-") && value === 0) return;
    if (str.endsWith(".") && Number(str) === value) return;
    if (Number(str) !== value) {
      setStr(value.toString());
    }
  }, [value, str]);

  return (
    <input
      id={id}
      className={className}
      type="number"
      step={step}
      min={min}
      value={str}
      onChange={(e) => {
        const val = e.target.value;
        setStr(val);
        if (val === "" || val === "-") {
          onChange(0);
        } else {
          const n = Number(val);
          if (Number.isFinite(n)) onChange(n);
        }
      }}
      aria-label={ariaLabel}
    />
  );
}

export function NumberField({ label, value, onChange, step, min, hint }: NumProps) {
  const id = useId();
  return (
    <Field label={label} hint={hint} htmlFor={id}>
      <SmartNumberInput
        id={id}
        value={Number.isFinite(value) ? value : 0}
        step={step ?? "any"}
        min={min}
        onChange={onChange}
      />
    </Field>
  );
}

type SelectProps = {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
  hint?: string;
};

export function SelectField({ label, value, options, onChange, hint }: SelectProps) {
  const id = useId();
  return (
    <Field label={label} hint={hint} htmlFor={id}>
      <SelectDropdown id={id} value={value} options={options} onChange={onChange} aria-label={label} />
    </Field>
  );
}

type TextProps = {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
  mono?: boolean;
};

export function TextField({ label, value, onChange, hint, mono }: TextProps) {
  const id = useId();
  return (
    <Field label={label} hint={hint} htmlFor={id}>
      <input
        id={id}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={mono ? { fontFamily: "var(--font-data)" } : undefined}
      />
    </Field>
  );
}

export function NumberListField({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: number[];
  onChange: (v: number[]) => void;
  hint?: string;
}) {
  const id = useId();
  return (
    <Field label={label} hint={hint ?? "Separa con comas o espacios"} htmlFor={id}>
      <textarea
        id={id}
        value={value.join(", ")}
        onChange={(e: ChangeEvent<HTMLTextAreaElement>) => {
          const parts = e.target.value
            .split(/[\s,;]+/)
            .map((s) => s.trim())
            .filter(Boolean);
          const nums = parts.map(Number).filter((n) => Number.isFinite(n));
          onChange(nums);
        }}
      />
    </Field>
  );
}

export function StringListField({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: string[];
  onChange: (v: string[]) => void;
  hint?: string;
}) {
  const id = useId();
  return (
    <Field label={label} hint={hint ?? "Separa con comas"} htmlFor={id}>
      <input
        id={id}
        type="text"
        value={value.join(", ")}
        onChange={(e) =>
          onChange(
            e.target.value
              .split(/[,;]+/)
              .map((s) => s.trim())
              .filter(Boolean)
          )
        }
      />
    </Field>
  );
}

type MatrixProps = {
  label?: string;
  values: number[][];
  rowLabels?: string[];
  colLabels?: string[];
  onChange: (m: number[][]) => void;
};

export function MatrixEditor({ label, values, rowLabels, colLabels, onChange }: MatrixProps) {
  const cols = values[0]?.length ?? 0;
  const rows = values.length;

  function setCell(r: number, c: number, n: number) {
    if (!Number.isFinite(n)) return;
    const next = values.map((row, i) =>
      i === r ? row.map((v, j) => (j === c ? n : v)) : [...row]
    );
    onChange(next);
  }

  function addRow() {
    onChange([...values, Array.from({ length: cols }, () => 0)]);
  }

  function addCol() {
    onChange(values.map((row) => [...row, 0]));
  }

  function removeRow() {
    if (rows <= 1) return;
    onChange(values.slice(0, -1));
  }

  function removeCol() {
    if (cols <= 1) return;
    onChange(values.map((row) => row.slice(0, -1)));
  }

  const displayCols =
    colLabels ?? Array.from({ length: cols }, (_, i) => `Col. ${i + 1}`);
  const displayRows =
    rowLabels ?? Array.from({ length: rows }, (_, i) => `Fila ${i + 1}`);

  return (
    <div className="matrix-block">
      {label ? <p className="section-label">{label}</p> : null}
      <div className="sheet-toolbar">
        <button type="button" className="btn btn-quiet" onClick={addRow}>
          + Fila
        </button>
        <button type="button" className="btn btn-quiet" onClick={addCol}>
          + Columna
        </button>
        <button type="button" className="btn btn-quiet" onClick={removeRow} disabled={rows <= 1}>
          − Fila
        </button>
        <button type="button" className="btn btn-quiet" onClick={removeCol} disabled={cols <= 1}>
          − Columna
        </button>
      </div>
      <div className="matrix-editor">
        <table>
          <caption className="sr-only">{label ?? "Matriz de datos"}</caption>
          <thead>
            <tr>
              <th scope="col" />
              {displayCols.map((c) => (
                <th key={c} scope="col">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {values.map((row, r) => (
              <tr key={r}>
                <th scope="row">{displayRows[r] ?? r + 1}</th>
                {row.map((cell, c) => (
                  <td key={c}>
                    <SmartNumberInput
                      className="matrix-cell"
                      step="any"
                      value={cell}
                      onChange={(n) => setCell(r, c, n)}
                      aria-label={`${displayRows[r] ?? `fila ${r + 1}`}, ${displayCols[c] ?? `columna ${c + 1}`}`}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="config-panel">
      <p className="section-label" style={{ marginTop: 0 }}>
        {title}
      </p>
      {children}
    </div>
  );
}
