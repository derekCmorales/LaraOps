import { parseDecimalDraft } from "../components/FormFields";
import type { PertBody } from "./sheetAdapters";

export type PertActivity = PertBody["activities"][number];

export type PertRow = PertActivity & { uid: string; predText: string };

export type TimeUnit = "días" | "semanas" | "horas" | "periodos";

export type PertFieldError = { uid: string; field: string; message: string };

let seq = 1;

export function nextUid(): string {
  seq += 1;
  return `act-${seq}`;
}

export function nextActivityId(existing: string[]): string {
  const used = new Set(existing.map((id) => id.trim()).filter(Boolean));
  for (let i = 0; i < 26; i += 1) {
    const id = String.fromCharCode(65 + i);
    if (!used.has(id)) return id;
  }
  let n = used.size + 1;
  while (used.has(`A${n}`)) n += 1;
  return `A${n}`;
}

export function blankRow(existingIds: string[] = []): PertRow {
  return {
    uid: nextUid(),
    id: nextActivityId(existingIds),
    predecessors: [],
    predText: "",
    duration: null,
    a: null,
    m: null,
    b: null,
    crash_time: null,
    normal_cost: null,
    crash_cost: null,
  };
}

export function rowsFromBody(body: PertBody): PertRow[] {
  return body.activities.map((act) => ({
    uid: nextUid(),
    id: act.id,
    predecessors: [...(act.predecessors ?? [])],
    predText: (act.predecessors ?? []).join(", "),
    duration: act.duration ?? null,
    a: act.a ?? null,
    m: act.m ?? null,
    b: act.b ?? null,
    crash_time: act.crash_time ?? null,
    normal_cost: act.normal_cost ?? null,
    crash_cost: act.crash_cost ?? null,
  }));
}

export function parsePredText(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(/[,;]+/)) {
    const id = part.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export function expectedTime(a: number, m: number, b: number): number {
  return (a + 4 * m + b) / 6;
}

export function pertVariance(a: number, b: number): number {
  return ((b - a) / 6) ** 2;
}

export function crashSlope(
  normal: number,
  crashTime: number,
  normalCost: number,
  crashCost: number,
): number | null {
  const span = normal - crashTime;
  if (!(span > 1e-12)) return null;
  return (crashCost - normalCost) / span;
}

export function formatQty(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("es-MX", { maximumFractionDigits: 4 });
}

function parseOptionalTarget(raw: string, label: string): { value: number | null; error: string | null } {
  const t = raw.trim();
  if (!t) return { value: null, error: null };
  const parsed = parseDecimalDraft(t);
  if (parsed.invalid || parsed.value == null) {
    return {
      value: null,
      error: `${label} no es un número válido. Usa punto o coma decimal, por ejemplo 10 o 2,5.`,
    };
  }
  return { value: parsed.value, error: null };
}

function hasCycle(activities: PertBody["activities"]): boolean {
  const byId = new Map(activities.map((a) => [a.id, a]));
  const color = new Map<string, 0 | 1 | 2>();
  let cycle = false;
  const dfs = (id: string) => {
    if (cycle || !byId.has(id)) return;
    const state = color.get(id) ?? 0;
    if (state === 1) {
      cycle = true;
      return;
    }
    if (state === 2) return;
    color.set(id, 1);
    for (const pred of byId.get(id)!.predecessors) dfs(pred);
    color.set(id, 2);
  };
  for (const act of activities) dfs(act.id);
  return cycle;
}

export function validatePertForm(input: {
  mode: "cpm" | "pert";
  crash: boolean;
  rows: PertRow[];
  crashTarget: string;
  targetTime: string;
  targetProbability: string;
}): { errors: PertFieldError[]; formErrors: string[]; body: PertBody | null } {
  const errors: PertFieldError[] = [];
  const formErrors: string[] = [];
  if (!input.rows.length) formErrors.push("Agrega al menos una actividad.");

  const ids = input.rows.map((row) => row.id.trim());
  const seen = new Set<string>();
  for (const row of input.rows) {
    const id = row.id.trim();
    if (!id) {
      errors.push({ uid: row.uid, field: "id", message: "Escribe el nombre de la actividad." });
      continue;
    }
    if (/[,;]/.test(id)) {
      errors.push({ uid: row.uid, field: "id", message: `El nombre «${id}» no puede llevar comas.` });
    }
    if (seen.has(id)) {
      errors.push({ uid: row.uid, field: "id", message: `El nombre «${id}» está repetido.` });
    }
    seen.add(id);
  }

  const activities: PertBody["activities"] = [];
  for (const row of input.rows) {
    const id = row.id.trim() || "la actividad";
    const preds = parsePredText(row.predText);
    for (const pred of preds) {
      if (pred === row.id.trim()) {
        errors.push({ uid: row.uid, field: "preds", message: `«${id}» no puede depender de sí misma.` });
      } else if (row.id.trim() && !ids.includes(pred)) {
        errors.push({ uid: row.uid, field: "preds", message: `«${id}» depende de «${pred}», que no existe.` });
      }
    }

    if (input.mode === "cpm") {
      if (row.duration == null || !Number.isFinite(row.duration) || row.duration < 0) {
        errors.push({
          uid: row.uid,
          field: "duration",
          message: `Indica la duración de «${id}» con un número mayor o igual que 0. Puedes usar punto o coma decimal.`,
        });
      }
    } else {
      const { a, m, b } = row;
      if (a == null || m == null || b == null || ![a, m, b].every((n) => Number.isFinite(n))) {
        errors.push({
          uid: row.uid,
          field: "pert",
          message: `«${id}» necesita los tres tiempos: optimista (a), más probable (m) y pesimista (b).`,
        });
      } else if (a < 0 || !(a <= m && m <= b)) {
        errors.push({ uid: row.uid, field: "pert", message: `En «${id}» los tiempos deben cumplir 0 ≤ a ≤ m ≤ b.` });
      }
    }

    if (input.crash && input.mode === "cpm") {
      const { crash_time: crashTime, normal_cost: normalCost, crash_cost: crashCost, duration } = row;
      if (crashTime == null || normalCost == null || crashCost == null) {
        errors.push({
          uid: row.uid,
          field: "crash",
          message: `«${id}» necesita tiempo crash, costo normal y costo crash. Si no se puede acortar, repite la duración y el costo.`,
        });
      } else if (duration != null && (crashTime < 0 || crashTime > duration)) {
        errors.push({
          uid: row.uid,
          field: "crash",
          message: `En «${id}» el tiempo crash debe estar entre 0 y la duración normal.`,
        });
      } else if (crashCost < normalCost) {
        errors.push({
          uid: row.uid,
          field: "crash",
          message: `En «${id}» el costo crash debe ser mayor o igual que el costo normal.`,
        });
      }
    }

    activities.push({
      id: row.id.trim(),
      predecessors: preds,
      duration: input.mode === "cpm" ? row.duration : null,
      a: input.mode === "pert" ? row.a : null,
      m: input.mode === "pert" ? row.m : null,
      b: input.mode === "pert" ? row.b : null,
      crash_time: input.crash && input.mode === "cpm" ? row.crash_time : null,
      normal_cost: input.crash && input.mode === "cpm" ? row.normal_cost : null,
      crash_cost: input.crash && input.mode === "cpm" ? row.crash_cost : null,
    });
  }

  if (activities.some((act) => act.id) && hasCycle(activities.filter((act) => act.id))) {
    formErrors.push("La red tiene un ciclo: una actividad termina dependiendo de sí misma.");
  }

  const crashParsed = parseOptionalTarget(input.crashTarget, "La duración objetivo");
  if (input.crash && input.mode === "cpm") {
    if (crashParsed.error) formErrors.push(crashParsed.error);
    else if (crashParsed.value == null) formErrors.push("Indica la duración objetivo de la aceleración.");
    else if (crashParsed.value < 0) formErrors.push("La duración objetivo debe ser mayor o igual que 0.");
  }

  const timeParsed = parseOptionalTarget(input.targetTime, "El tiempo objetivo");
  if (input.mode === "pert" && timeParsed.error) formErrors.push(timeParsed.error);
  const probParsed = parseOptionalTarget(input.targetProbability, "La probabilidad");
  if (input.mode === "pert" && probParsed.error) formErrors.push(probParsed.error);
  if (input.mode === "pert" && probParsed.value != null && !(probParsed.value > 0 && probParsed.value < 1)) {
    formErrors.push("La probabilidad debe estar entre 0 y 1, sin incluir los extremos. Ejemplo: 0,95.");
  }

  const named = activities.filter((act) => act.id);
  const ok = errors.length === 0 && formErrors.length === 0 && named.length > 0;
  return {
    errors,
    formErrors,
    body: ok
      ? {
          mode: input.mode,
          activities: named,
          crash: Boolean(input.crash && input.mode === "cpm"),
          crash_target: input.crash && input.mode === "cpm" ? crashParsed.value : null,
          target_time: input.mode === "pert" ? timeParsed.value : null,
          target_probability: input.mode === "pert" ? probParsed.value : null,
        }
      : null,
  };
}
