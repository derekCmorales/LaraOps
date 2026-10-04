import { useId, useRef, type ClipboardEvent, type KeyboardEvent } from "react";
import {
  addDest,
  addSource,
  cellKey,
  fmtNum,
  formFromPastedTable,
  isForbiddenText,
  MAX_DIM,
  parseClipboardGrid,
  pasteIntoCosts,
  pasteIntoLine,
  removeDest,
  removeSource,
  type TransportForm,
  type TransportMethod,
  type TransportObjective,
  type TransportReport,
} from "../lib/transportForm";

type Props = {
  form: TransportForm;
  report: TransportReport;
  /** Muestra los errores solo después del primer intento de resolver. */
  showErrors: boolean;
  onChange: (next: TransportForm) => void;
};

const OBJECTIVES: { value: TransportObjective; label: string }[] = [
  { value: "minimize", label: "Minimizar costo" },
  { value: "maximize", label: "Maximizar ganancia" },
];

function methodCards(objective: TransportObjective): { value: TransportMethod; title: string; text: string }[] {
  const best = objective === "minimize" ? "más baratas" : "más rentables";
  const goal = objective === "minimize" ? "el costo mínimo" : "la ganancia máxima";
  return [
    {
      value: "modi_auto",
      title: "Óptimo · Vogel + MODI",
      text: `Recomendado. Parte de Vogel y mejora con MODI hasta ${goal}.`,
    },
    { value: "vogel", title: "Vogel (VAM)", text: "Solo la solución inicial, por penalizaciones. Suele quedar cerca del óptimo." },
    { value: "least_cost", title: "Costo mínimo", text: `Solo la solución inicial: llena primero las rutas ${best}.` },
    { value: "northwest", title: "Esquina noroeste", text: "Solo la solución inicial: ignora los costos. Útil para practicar." },
  ];
}

/** Coordenadas de navegación: fila -1 = nombres de destinos, fila m = demanda; columna -1 = nombres, columna n = oferta. */
function navKey(r: number, c: number) {
  return `${r}:${c}`;
}

export default function TransportEditor({ form, report, showErrors, onChange }: Props) {
  const tableRef = useRef<HTMLTableElement>(null);
  const objectiveLabelId = useId();
  const methodLabelId = useId();
  const m = form.sources.length;
  const n = form.dests.length;
  const err = showErrors ? report.errors : null;
  const set = (patch: Partial<TransportForm>) => onChange({ ...form, ...patch });
  const unit = form.objective === "minimize" ? "costo" : "ganancia";

  function focusCell(r: number, c: number) {
    const el = tableRef.current?.querySelector<HTMLInputElement>(`[data-nav="${navKey(r, c)}"]`);
    if (el) {
      el.focus();
      el.select();
    }
  }

  function onNavKey(e: KeyboardEvent<HTMLInputElement>, r: number, c: number) {
    if (e.key === "Enter" || e.key === "ArrowDown") {
      e.preventDefault();
      focusCell(r + 1, c);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      focusCell(r - 1, c);
    } else if (e.key === "ArrowRight" && e.currentTarget.selectionStart === e.currentTarget.value.length) {
      e.preventDefault();
      focusCell(r, c + 1);
    } else if (e.key === "ArrowLeft" && e.currentTarget.selectionEnd === 0) {
      e.preventDefault();
      focusCell(r, c - 1);
    }
  }

  function onPaste(e: ClipboardEvent<HTMLInputElement>, r: number, c: number) {
    const block = parseClipboardGrid(e.clipboardData.getData("text"));
    if (block.length <= 1 && (block[0]?.length ?? 0) <= 1) return;
    e.preventDefault();
    const table = formFromPastedTable(block, form);
    if (table) {
      onChange(table);
      return;
    }
    const column = block.length > 1 ? block.map((row) => row[0] ?? "") : block[0];
    const row = block.length === 1 ? block[0] : block.map((line) => line[0] ?? "");
    if (r >= 0 && r < m && c >= 0 && c < n) onChange(pasteIntoCosts(form, r, c, block));
    else if (c === n && r >= 0 && r < m) onChange(pasteIntoLine(form, "supply", r, column));
    else if (r === m && c >= 0 && c < n) onChange(pasteIntoLine(form, "demand", c, row));
    else if (r === -1 && c >= 0) {
      let next = form;
      while (next.dests.length < Math.min(MAX_DIM, c + row.length)) next = addDest(next);
      const dests = [...next.dests];
      row.forEach((name, k) => {
        if (c + k < dests.length) dests[c + k] = name;
      });
      onChange({ ...next, dests });
    } else if (c === -1 && r >= 0) {
      let next = form;
      while (next.sources.length < Math.min(MAX_DIM, r + column.length)) next = addSource(next);
      const sources = [...next.sources];
      column.forEach((name, k) => {
        if (r + k < sources.length) sources[r + k] = name;
      });
      onChange({ ...next, sources });
    }
  }

  const inputProps = (r: number, c: number) => ({
    "data-nav": navKey(r, c),
    onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => onNavKey(e, r, c),
    onPaste: (e: ClipboardEvent<HTMLInputElement>) => onPaste(e, r, c),
    autoComplete: "off",
    spellCheck: false,
  });

  const S = report.totalSupply;
  const D = report.totalDemand;
  let balance: { tone: "ok" | "warn" | "muted"; text: string };
  if (S == null || D == null) {
    balance = { tone: "muted", text: "Completa la oferta y la demanda para ver si el modelo está balanceado." };
  } else if (Math.abs(S - D) < 1e-9) {
    balance = { tone: "ok", text: `Oferta total = demanda total = ${fmtNum(S, 4)}. El modelo está balanceado.` };
  } else if (S > D) {
    balance = {
      tone: "warn",
      text: `La oferta (${fmtNum(S, 4)}) supera la demanda (${fmtNum(D, 4)}) en ${fmtNum(S - D, 4)}. Se agregará un destino ficticio con ${unit} 0 para la oferta que no se envía.`,
    };
  } else {
    balance = {
      tone: "warn",
      text: `La demanda (${fmtNum(D, 4)}) supera la oferta (${fmtNum(S, 4)}) en ${fmtNum(D - S, 4)}. Se agregará un origen ficticio con ${unit} 0: esa demanda quedará sin cubrir.`,
    };
  }

  return (
    <div className="eoq-editor transport-editor">
      <div className="transport-setup">
        <fieldset className="eoq-section">
          <legend>Objetivo</legend>
          <div className="eoq-toggle" role="radiogroup" aria-labelledby={objectiveLabelId}>
            <span id={objectiveLabelId} className="sr-only">
              Objetivo
            </span>
            {OBJECTIVES.map((o) => (
              <button
                key={o.value}
                type="button"
                role="radio"
                aria-checked={form.objective === o.value}
                className={form.objective === o.value ? "eoq-toggle-btn is-on" : "eoq-toggle-btn"}
                onClick={() => set({ objective: o.value })}
              >
                {o.label}
              </button>
            ))}
          </div>
          <p className="field-hint">
            {form.objective === "minimize"
              ? "Cada celda es el costo de enviar una unidad por esa ruta."
              : "Cada celda es la ganancia de enviar una unidad por esa ruta."}
          </p>
        </fieldset>

        <fieldset className="eoq-section">
          <legend id={methodLabelId}>Método</legend>
          <div className="transport-methods" role="radiogroup" aria-labelledby={methodLabelId}>
            {methodCards(form.objective).map((card) => (
              <button
                key={card.value}
                type="button"
                role="radio"
                aria-checked={form.method === card.value}
                className={form.method === card.value ? "pert-mode is-on" : "pert-mode"}
                onClick={() => set({ method: card.value })}
              >
                <strong>{card.title}</strong>
                <span>{card.text}</span>
              </button>
            ))}
          </div>
        </fieldset>
      </div>

      <fieldset className="eoq-section">
        <legend>Tabla de {form.objective === "minimize" ? "costos" : "ganancias"}, oferta y demanda</legend>
        <div className="transport-toolbar">
          <button type="button" className="btn btn-ghost" onClick={() => onChange(addSource(form))} disabled={m >= MAX_DIM}>
            + Origen
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => onChange(addDest(form))} disabled={n >= MAX_DIM}>
            + Destino
          </button>
          <span className="transport-size">
            {m} {m === 1 ? "origen" : "orígenes"} × {n} {n === 1 ? "destino" : "destinos"}
          </span>
        </div>
        <p className="field-hint transport-hint">
          Escribe <strong>M</strong> en una celda para prohibir esa ruta. Puedes pegar un bloque desde Excel o Google
          Sheets; si incluye nombres, «Oferta» y «Demanda», se carga la tabla completa. Enter baja a la siguiente fila.
        </p>

        <div className="transport-grid-wrap">
          <table className="transport-grid" ref={tableRef}>
            <caption className="sr-only">
              Tabla de transporte: filas = orígenes, columnas = destinos, última columna = oferta, última fila = demanda
            </caption>
            <thead>
              <tr>
                <th scope="col" className="transport-corner">
                  <span>Origen ╲ Destino</span>
                </th>
                {form.dests.map((name, c) => (
                  <th key={c} scope="col">
                    <div className="transport-name">
                      <input
                        {...inputProps(-1, c)}
                        className={err?.dests[c] ? "is-invalid" : undefined}
                        value={name}
                        aria-label={`Nombre del destino ${c + 1}`}
                        aria-invalid={err?.dests[c] ? true : undefined}
                        title={err?.dests[c]}
                        onChange={(e) => {
                          const dests = [...form.dests];
                          dests[c] = e.target.value;
                          set({ dests });
                        }}
                      />
                      <button
                        type="button"
                        className="transport-remove"
                        onClick={() => onChange(removeDest(form, c))}
                        disabled={n <= 1}
                        aria-label={`Quitar destino ${name || c + 1}`}
                        title="Quitar destino"
                      >
                        ×
                      </button>
                    </div>
                  </th>
                ))}
                <th scope="col" className="transport-margin-head">
                  Oferta
                </th>
              </tr>
            </thead>
            <tbody>
              {form.sources.map((name, r) => (
                <tr key={r}>
                  <th scope="row">
                    <div className="transport-name">
                      <input
                        {...inputProps(r, -1)}
                        className={err?.sources[r] ? "is-invalid" : undefined}
                        value={name}
                        aria-label={`Nombre del origen ${r + 1}`}
                        aria-invalid={err?.sources[r] ? true : undefined}
                        title={err?.sources[r]}
                        onChange={(e) => {
                          const sources = [...form.sources];
                          sources[r] = e.target.value;
                          set({ sources });
                        }}
                      />
                      <button
                        type="button"
                        className="transport-remove"
                        onClick={() => onChange(removeSource(form, r))}
                        disabled={m <= 1}
                        aria-label={`Quitar origen ${name || r + 1}`}
                        title="Quitar origen"
                      >
                        ×
                      </button>
                    </div>
                  </th>
                  {form.dests.map((dest, c) => {
                    const raw = form.costs[r]?.[c] ?? "";
                    const forbidden = isForbiddenText(raw);
                    const cellErr = err?.costs[cellKey(r, c)];
                    return (
                      <td key={c} className={forbidden ? "is-forbidden" : undefined}>
                        <input
                          {...inputProps(r, c)}
                          className={["transport-num", cellErr ? "is-invalid" : ""].filter(Boolean).join(" ")}
                          inputMode="decimal"
                          value={forbidden ? "M" : raw}
                          aria-label={`${unit} de ${name || `origen ${r + 1}`} a ${dest || `destino ${c + 1}`}`}
                          aria-invalid={cellErr ? true : undefined}
                          title={forbidden ? "Ruta prohibida (M). Borra la M para habilitarla." : cellErr}
                          onChange={(e) => {
                            const costs = form.costs.map((row) => [...row]);
                            costs[r][c] = e.target.value;
                            set({ costs });
                          }}
                        />
                      </td>
                    );
                  })}
                  <td className="transport-margin">
                    <input
                      {...inputProps(r, n)}
                      className={["transport-num", err?.supply[r] ? "is-invalid" : ""].filter(Boolean).join(" ")}
                      inputMode="decimal"
                      value={form.supply[r] ?? ""}
                      aria-label={`Oferta de ${name || `origen ${r + 1}`}`}
                      aria-invalid={err?.supply[r] ? true : undefined}
                      title={err?.supply[r]}
                      onChange={(e) => {
                        const supply = [...form.supply];
                        supply[r] = e.target.value;
                        set({ supply });
                      }}
                    />
                  </td>
                </tr>
              ))}
              <tr className="transport-demand-row">
                <th scope="row" className="transport-margin-head">
                  Demanda
                </th>
                {form.dests.map((dest, c) => (
                  <td key={c} className="transport-margin">
                    <input
                      {...inputProps(m, c)}
                      className={["transport-num", err?.demand[c] ? "is-invalid" : ""].filter(Boolean).join(" ")}
                      inputMode="decimal"
                      value={form.demand[c] ?? ""}
                      aria-label={`Demanda de ${dest || `destino ${c + 1}`}`}
                      aria-invalid={err?.demand[c] ? true : undefined}
                      title={err?.demand[c]}
                      onChange={(e) => {
                        const demand = [...form.demand];
                        demand[c] = e.target.value;
                        set({ demand });
                      }}
                    />
                  </td>
                ))}
                <td className={`transport-total is-${balance.tone}`} aria-label="Totales de oferta y demanda">
                  <span>{fmtNum(S, 4)}</span>
                  <small>{fmtNum(D, 4)}</small>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className={`transport-balance is-${balance.tone}`} aria-live="polite">
          {balance.text}
          {report.forbiddenCount > 0
            ? ` ${report.forbiddenCount === 1 ? "Hay 1 ruta prohibida" : `Hay ${report.forbiddenCount} rutas prohibidas`} (M).`
            : ""}
        </p>
      </fieldset>

      {showErrors && report.messages.length > 0 ? (
        <div className="pert-errors" role="alert">
          <strong>Antes de resolver:</strong>
          <ul>
            {report.messages.slice(0, 6).map((msg) => (
              <li key={msg}>{msg}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
