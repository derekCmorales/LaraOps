type Props = {
  caption?: string;
  columns: string[];
  rows: (string | number | boolean | null | undefined)[][];
  textColumns?: number[];
  activeRowIndexes?: number[];
};

function fmt(v: string | number | boolean | null | undefined): string {
  if (v == null) return "—";
  if (typeof v === "boolean") return v ? "sí" : "no";
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return String(v);
    return v.toLocaleString("es-MX", { maximumFractionDigits: 4 });
  }
  return String(v);
}

export default function SolutionTable({
  caption,
  columns,
  rows,
  textColumns = [0],
  activeRowIndexes = [],
}: Props) {
  return (
    <table className="data-table">
      {caption ? <caption className="section-label">{caption}</caption> : null}
      <thead>
        <tr>
          {columns.map((c) => (
            <th key={c} scope="col">
              {c}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={i}>
            {row.map((cell, j) => (
              <td
                key={j}
                className={[
                  textColumns.includes(j) ? "col-text" : "",
                  activeRowIndexes.includes(i) ? "cell-active" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                {fmt(cell)}
                {activeRowIndexes.includes(i) && j === 0 ? (
                  <span className="cell-active-label"> (activa)</span>
                ) : null}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
