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

/** Acepta punto o coma decimal y deja escribir el separador sin borrarlo. */
export function parseDecimalDraft(raw: string): { value: number | null; partial: boolean; invalid: boolean } {
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

function formatDecimal(value: number): string {
  if (!Number.isFinite(value)) return "0";
  return value.toLocaleString("es-MX", { useGrouping: false, maximumFractionDigits: 12 });
}

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
  const [str, setStr] = useState(() => formatDecimal(value));

  useEffect(() => {
    const parsed = parseDecimalDraft(str);
    if (parsed.partial) return;
    if (parsed.value === value) return;
    setStr(formatDecimal(value));
  }, [value, str]);

  return (
    <input
      id={id}
      className={["num-input", className].filter(Boolean).join(" ")}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      spellCheck={false}
      step={step}
      min={min}
      value={str}
      onChange={(e) => {
        const val = e.target.value;
        const parsed = parseDecimalDraft(val);
        if (parsed.invalid) return;
        if (min != null && parsed.value != null && parsed.value < min) return;
        setStr(val);
        if (parsed.value == null) onChange(0);
        else onChange(parsed.value);
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

function parseNumberList(text: string): number[] {
  return text
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => Number(s.replace(",", ".")))
    .filter((n) => Number.isFinite(n));
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
  const [text, setText] = useState(value.join(", "));
  const serialized = value.join("|");

  useEffect(() => {
    const parsed = parseNumberList(text);
    if (parsed.join("|") !== serialized) setText(value.join(", "));
  }, [serialized, text, value]);

  return (
    <Field label={label} hint={hint ?? "Separa con comas o espacios. El decimal también puede ir con punto."} htmlFor={id}>
      <textarea
        id={id}
        value={text}
        onChange={(e: ChangeEvent<HTMLTextAreaElement>) => {
          const next = e.target.value;
          setText(next);
          onChange(parseNumberList(next));
        }}
      />
    </Field>
  );
}

function parseStringList(text: string): string[] {
  return text
    .split(/[,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
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
  const [text, setText] = useState(value.join(", "));
  const serialized = value.join("\u0000");

  useEffect(() => {
    if (parseStringList(text).join("\u0000") !== serialized) setText(value.join(", "));
  }, [serialized, text, value]);

  return (
    <Field label={label} hint={hint ?? "Separa con comas"} htmlFor={id}>
      <input
        id={id}
        type="text"
        value={text}
        onChange={(e) => {
          const next = e.target.value;
          setText(next);
          onChange(parseStringList(next));
        }}
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
