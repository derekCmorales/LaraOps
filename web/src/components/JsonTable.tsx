type Table = {
  name: string;
  columns: string[];
  rows: unknown[][];
};

import { formatDisplayValue } from "../lib/resultLabels";

export default function JsonTable({ table }: { table: Table }) {
  return (
    <table className="data-table">
      <caption className="section-label">{table.name}</caption>
      <thead>
        <tr>
          {table.columns.map((c) => (
            <th key={c} scope="col">
              {c}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {table.rows.map((row, i) => (
          <tr key={i}>
            {row.map((cell, j) => (
              <td key={j} className={j === 0 ? "col-text" : undefined}>
                {formatDisplayValue(cell)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
