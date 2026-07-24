import { senseLabel, statusLabel } from "../lib/resultLabels";

type Props = {
  status: string;
  objectiveValue?: number | null;
  objectiveSense?: string | null;
  warnings?: string[];
};

function toneFor(status: string, warnings: string[]): "ok" | "warn" | "error" {
  const s = status.toLowerCase();
  if (s.includes("infeasible") || s.includes("unbounded") || s === "error") return "error";
  if (
    warnings.some((w) =>
      /degener|múltipl|multiple|inestabl|óptimos múltiples|optimos multiples/i.test(w)
    )
  )
    return "warn";
  return "ok";
}

function formatZ(v: number): string {
  return v.toLocaleString("es-MX", { maximumFractionDigits: 4 });
}

export default function StatusBand({
  status,
  objectiveValue,
  objectiveSense,
  warnings = [],
}: Props) {
  const tone = toneFor(status, warnings);
  const sense = senseLabel(objectiveSense);

  return (
    <div className="status-band" data-tone={tone} aria-live="polite">
      <div className="status-band-label">
        <span className="status-dot" aria-hidden />
        {statusLabel(status)}
        {warnings[0] ? (
          <span className="status-band-warn" title={warnings.join(" · ")}>
            · {warnings[0]}
          </span>
        ) : null}
      </div>
      {objectiveValue != null && Number.isFinite(objectiveValue) && (
        <div className="status-band-z">
          Z = {formatZ(objectiveValue)}
          {sense ? <span>({sense})</span> : null}
        </div>
      )}
    </div>
  );
}
