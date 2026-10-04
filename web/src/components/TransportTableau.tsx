import { fmt, isDummyDest, isDummySource, numeric, type Num, type TransportModel } from "../lib/transportResult";

export type TableauHighlight = {
  /** Celda recién asignada (solución inicial). */
  picked?: [number, number] | null;
  enter?: [number, number] | null;
  leave?: [number, number] | null;
  cycle?: [number, number, number][];
  crossedRows?: Set<number>;
  crossedCols?: Set<number>;
};

type Props = {
  model: TransportModel;
  alloc: number[][];
  basis: [number, number][];
  caption: string;
  /** Oferta/demanda a mostrar en los márgenes (p. ej. lo que queda por asignar). */
  supply?: number[];
  demand?: number[];
  marginLabel?: { supply: string; demand: string };
  u?: Num[];
  v?: Num[];
  reduced?: Num[][];
  rowPenalties?: Num[];
  colPenalties?: Num[];
  highlight?: TableauHighlight;
  /** Signo del objetivo: en maximización un costo reducido positivo mejora. */
  maximize?: boolean;
};

function inBasis(basis: [number, number][], r: number, c: number): boolean {
  return basis.some(([a, b]) => a === r && b === c);
}

function same(cell: [number, number] | null | undefined, r: number, c: number): boolean {
  return !!cell && cell[0] === r && cell[1] === c;
}

function label(name: string): string {
  if (isDummySource(name)) return "Ficticio";
  if (isDummyDest(name)) return "Ficticio";
  return name;
}

export default function TransportTableau({
  model,
  alloc,
  basis,
  caption,
  supply,
  demand,
  marginLabel = { supply: "Oferta", demand: "Demanda" },
  u,
  v,
  reduced,
  rowPenalties,
  colPenalties,
  highlight = {},
  maximize = false,
}: Props) {
  const signs = new Map((highlight.cycle ?? []).map(([r, c, s]) => [`${r}:${c}`, s]));
  const showPen = !!rowPenalties || !!colPenalties;
  const supplyVals = supply ?? model.supply;
  const demandVals = demand ?? model.demand;

  return (
    <div className="tt-wrap">
      <table className="tt">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <th scope="col" className="tt-corner" />
            {model.dests.map((d, c) => (
              <th
                key={c}
                scope="col"
                className={[isDummyDest(d) ? "is-dummy" : "", highlight.crossedCols?.has(c) ? "is-crossed" : ""]
                  .filter(Boolean)
                  .join(" ")}
                title={isDummyDest(d) ? "Destino ficticio: absorbe la oferta que no se envía" : d}
              >
                {label(d)}
              </th>
            ))}
            <th scope="col" className="tt-margin">
              {marginLabel.supply}
            </th>
            {u ? (
              <th scope="col" className="tt-dual">
                uᵢ
              </th>
            ) : null}
            {showPen ? (
              <th scope="col" className="tt-pen">
                Penal.
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {model.sources.map((s, r) => (
            <tr key={r} className={highlight.crossedRows?.has(r) ? "is-crossed" : undefined}>
              <th
                scope="row"
                className={isDummySource(s) ? "is-dummy" : undefined}
                title={isDummySource(s) ? "Origen ficticio: representa la demanda que no se cubre" : s}
              >
                {label(s)}
              </th>
              {model.dests.map((d, c) => {
                const cost = model.costs[r]?.[c];
                const forbidden = cost === "M";
                const basic = inBasis(basis, r, c);
                const q = alloc[r]?.[c] ?? 0;
                const red = reduced?.[r]?.[c];
                const redN = numeric(red);
                const improving = redN != null && (maximize ? redN > 1e-9 : redN < -1e-9);
                const sign = signs.get(`${r}:${c}`);
                const cls = [
                  "tt-cell",
                  basic ? "is-basic" : "",
                  basic && Math.abs(q) < 1e-9 ? "is-zero" : "",
                  forbidden ? "is-forbidden" : "",
                  isDummySource(s) || isDummyDest(d) ? "is-dummy" : "",
                  same(highlight.picked, r, c) ? "is-picked" : "",
                  same(highlight.enter, r, c) ? "is-enter" : "",
                  same(highlight.leave, r, c) ? "is-leave" : "",
                  sign === 1 ? "is-plus" : sign === -1 ? "is-minus" : "",
                  highlight.crossedRows?.has(r) || highlight.crossedCols?.has(c) ? "is-crossed" : "",
                ]
                  .filter(Boolean)
                  .join(" ");
                const aria = [
                  `${s} a ${d}`,
                  forbidden ? "ruta prohibida" : `costo ${fmt(cost)}`,
                  basic ? `envío ${fmt(q)}` : "sin envío",
                  red != null && !basic ? `costo reducido ${fmt(red)}` : "",
                  sign === 1 ? "signo más en el ciclo" : sign === -1 ? "signo menos en el ciclo" : "",
                ]
                  .filter(Boolean)
                  .join(", ");
                return (
                  <td key={c} className={cls} aria-label={aria}>
                    <span className="tt-cost">{forbidden ? "M" : fmt(cost)}</span>
                    {sign ? <span className="tt-sign">{sign === 1 ? "+" : "−"}</span> : null}
                    {basic ? (
                      <span className="tt-alloc">{fmt(q)}</span>
                    ) : red != null ? (
                      <span className={improving ? "tt-reduced is-improving" : "tt-reduced"}>
                        {fmt(red)}
                      </span>
                    ) : (
                      <span className="tt-alloc tt-empty" aria-hidden>
                        ·
                      </span>
                    )}
                  </td>
                );
              })}
              <td className="tt-margin">{fmt(supplyVals[r])}</td>
              {u ? <td className="tt-dual">{fmt(u[r])}</td> : null}
              {showPen ? <td className="tt-pen">{rowPenalties?.[r] != null ? fmt(rowPenalties[r]) : ""}</td> : null}
            </tr>
          ))}
          <tr className="tt-demand">
            <th scope="row">{marginLabel.demand}</th>
            {model.dests.map((_, c) => (
              <td key={c} className="tt-margin">
                {fmt(demandVals[c])}
              </td>
            ))}
            <td className="tt-margin tt-total" />
            {u ? <td className="tt-dual" /> : null}
            {showPen ? <td className="tt-pen" /> : null}
          </tr>
          {v ? (
            <tr className="tt-dual-row">
              <th scope="row">vⱼ</th>
              {model.dests.map((_, c) => (
                <td key={c} className="tt-dual">
                  {fmt(v[c])}
                </td>
              ))}
              <td />
              {u ? <td /> : null}
              {showPen ? <td /> : null}
            </tr>
          ) : null}
          {showPen ? (
            <tr className="tt-pen-row">
              <th scope="row">Penal.</th>
              {model.dests.map((_, c) => (
                <td key={c} className="tt-pen">
                  {colPenalties?.[c] != null ? fmt(colPenalties[c]) : ""}
                </td>
              ))}
              <td />
              {u ? <td /> : null}
              <td />
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
