import { parseDecimalDraft } from "../components/FormFields";

export type QueueModel = "M/M/1" | "M/M/s" | "M/M/1/K" | "M/M/s/K" | "M/M/s/N" | "M/G/1" | "M/D/1";
export type TimeUnit = "s" | "min" | "h" | "d";
export type RateMode = "rate" | "time";
export type CostBasis = "system" | "queue";

export const QUEUES_S_MAX = 40;
export const QUEUES_K_MAX = 500;
export const QUEUES_N_MAX = 200;

type UnitInfo = { value: TimeUnit; label: string; plural: string; short: string; hours: number };

export const TIME_UNITS: UnitInfo[] = [
  { value: "s", label: "segundo", plural: "segundos", short: "s", hours: 1 / 3600 },
  { value: "min", label: "minuto", plural: "minutos", short: "min", hours: 1 / 60 },
  { value: "h", label: "hora", plural: "horas", short: "h", hours: 1 },
  { value: "d", label: "día", plural: "días", short: "días", hours: 24 },
];

export function unitInfo(unit: TimeUnit): UnitInfo {
  return TIME_UNITS.find((u) => u.value === unit) ?? TIME_UNITS[2];
}

/** Unidad a partir de la etiqueta que viaja en el cuerpo (`time_unit: "hora"`). */
export function unitFromLabel(label: unknown): TimeUnit | null {
  if (typeof label !== "string") return null;
  const t = label.trim().toLowerCase();
  const hit = TIME_UNITS.find((u) => u.label === t || u.plural === t || u.short === t || u.value === t);
  return hit?.value ?? null;
}

export type ModelInfo = {
  value: QueueModel;
  /** Notación de Kendall que se muestra. */
  kendall: string;
  title: string;
  text: string;
  group: "infinite" | "capacity" | "population";
};

export const MODELS: ModelInfo[] = [
  {
    value: "M/M/1",
    kendall: "M/M/1",
    title: "Un servidor",
    text: "Llegadas y servicio aleatorios (exponenciales). P. ej. una caja o un cajero.",
    group: "infinite",
  },
  {
    value: "M/M/s",
    kendall: "M/M/s",
    title: "Varios servidores",
    text: "Una sola fila que atienden s servidores iguales. P. ej. un banco o un call center.",
    group: "infinite",
  },
  {
    value: "M/G/1",
    kendall: "M/G/1",
    title: "Servicio general",
    text: "Un servidor; conoces la media y la desviación estándar del tiempo de servicio.",
    group: "infinite",
  },
  {
    value: "M/D/1",
    kendall: "M/D/1",
    title: "Servicio constante",
    text: "Un servidor que tarda siempre lo mismo. P. ej. un lavado automático.",
    group: "infinite",
  },
  {
    value: "M/M/1/K",
    kendall: "M/M/1/K",
    title: "Un servidor, cupo limitado",
    text: "Caben como máximo K clientes; si está lleno, el que llega se va.",
    group: "capacity",
  },
  {
    value: "M/M/s/K",
    kendall: "M/M/s/K",
    title: "Varios servidores, cupo limitado",
    text: "s servidores y lugar para K clientes en total (fila + atención).",
    group: "capacity",
  },
  {
    value: "M/M/s/N",
    kendall: "M/M/s//N",
    title: "Población finita",
    text: "Solo N clientes posibles que regresan, p. ej. N máquinas que se descomponen y s mecánicos.",
    group: "population",
  },
];

export function modelInfo(model: QueueModel): ModelInfo {
  return MODELS.find((m) => m.value === model) ?? MODELS[0];
}

export const isMultiServer = (m: QueueModel) => m === "M/M/s" || m === "M/M/s/K" || m === "M/M/s/N";
export const hasCapacity = (m: QueueModel) => m === "M/M/1/K" || m === "M/M/s/K";
export const hasPopulation = (m: QueueModel) => m === "M/M/s/N";
export const isFiniteModel = (m: QueueModel) => hasCapacity(m) || hasPopulation(m);
export const isMarkovian = (m: QueueModel) => m !== "M/G/1" && m !== "M/D/1";

/** Estado del formulario. Los números se guardan como texto para distinguir "vacío" de 0. */
export type QueuesForm = {
  model: QueueModel;
  timeUnit: TimeUnit;
  arrivalMode: RateMode;
  lambda: string;
  arrivalTime: string;
  arrivalTimeUnit: TimeUnit;
  serviceMode: RateMode;
  mu: string;
  serviceTime: string;
  serviceTimeUnit: TimeUnit;
  s: string;
  K: string;
  N: string;
  sigma: string;
  sigmaUnit: TimeUnit;
  costWait: string;
  costServer: string;
  costBasis: CostBasis;
  optimizeS: boolean;
  sMax: string;
  waitT: string;
  waitTUnit: TimeUnit;
};

export type QueuesBody = {
  model: QueueModel;
  lambda: number;
  mu: number;
  s?: number;
  K?: number;
  N?: number;
  service_std_dev?: number;
  include_pn: boolean;
  time_unit: string;
  cost_waiting_per_unit_time?: number;
  cost_server_per_unit_time?: number;
  waiting_cost_basis?: CostBasis;
  optimize_s?: boolean;
  s_max?: number;
  wait_threshold?: number;
};

export type QueuesField =
  | "lambda"
  | "mu"
  | "s"
  | "K"
  | "N"
  | "sigma"
  | "costWait"
  | "costServer"
  | "sMax"
  | "waitT";

export type QueuesReport = {
  errors: Partial<Record<QueuesField, string>>;
  body: QueuesBody | null;
  /** Tasas en la unidad base cuando se pueden calcular (aunque haya otros errores). */
  lambda: number | null;
  mu: number | null;
  servers: number | null;
};

export function blankQueuesForm(model: QueueModel = "M/M/1"): QueuesForm {
  return {
    model,
    timeUnit: "h",
    arrivalMode: "rate",
    lambda: "",
    arrivalTime: "",
    arrivalTimeUnit: "min",
    serviceMode: "rate",
    mu: "",
    serviceTime: "",
    serviceTimeUnit: "min",
    s: "",
    K: "",
    N: "",
    sigma: "",
    sigmaUnit: "min",
    costWait: "",
    costServer: "",
    costBasis: "system",
    optimizeS: false,
    sMax: "",
    waitT: "",
    waitTUnit: "min",
  };
}

function draft(value: unknown): string {
  const n = typeof value === "number" ? value : Number(value);
  if (value == null || value === "" || !Number.isFinite(n)) return "";
  return n.toLocaleString("es-MX", { useGrouping: false, maximumFractionDigits: 12 });
}

/** Ejemplos de libro, uno por modelo; "Cargar ejemplo" usa el del modelo elegido. */
export function exampleForm(model: QueueModel): QueuesForm {
  const base = blankQueuesForm(model);
  switch (model) {
    case "M/M/1":
      // Llega un cliente cada 6 min (λ = 10/h) y atenderlo toma 4 min (μ = 15/h).
      return {
        ...base,
        arrivalMode: "time",
        arrivalTime: "6",
        serviceMode: "time",
        serviceTime: "4",
        waitT: "10",
      };
    case "M/M/s":
      return { ...base, lambda: "10", mu: "6", s: "2", costWait: "20", costServer: "15", optimizeS: true };
    case "M/M/1/K":
      return { ...base, lambda: "12", mu: "10", K: "5" };
    case "M/M/s/K":
      return { ...base, lambda: "6", mu: "4", s: "2", K: "6", waitT: "15" };
    case "M/M/s/N":
      // 10 máquinas que fallan una vez cada 10 h; 2 mecánicos tardan 2 h por reparación.
      return {
        ...base,
        arrivalMode: "time",
        arrivalTime: "10",
        arrivalTimeUnit: "h",
        serviceMode: "time",
        serviceTime: "2",
        serviceTimeUnit: "h",
        s: "2",
        N: "10",
        costWait: "60",
        costServer: "25",
      };
    case "M/G/1":
      return { ...base, lambda: "4", serviceMode: "time", serviceTime: "10", sigma: "6", sigmaUnit: "min" };
    case "M/D/1":
      return { ...base, lambda: "3", mu: "5" };
  }
}

const MODEL_VALUES = MODELS.map((m) => m.value);

export function formFromBody(body: Partial<QueuesBody> & Record<string, unknown>): QueuesForm {
  const model = (MODEL_VALUES.includes(body.model as QueueModel) ? body.model : "M/M/1") as QueueModel;
  const unit = unitFromLabel(body.time_unit) ?? "h";
  const form = blankQueuesForm(model);
  return {
    ...form,
    timeUnit: unit,
    lambda: draft(body.lambda ?? body.lambda_),
    mu: draft(body.mu),
    s: isMultiServer(model) ? draft(body.s) : "",
    K: hasCapacity(model) ? draft(body.K) : "",
    N: hasPopulation(model) ? draft(body.N) : "",
    sigma: draft(body.service_std_dev),
    sigmaUnit: unit,
    costWait: draft(body.cost_waiting_per_unit_time),
    costServer: draft(body.cost_server_per_unit_time),
    costBasis: body.waiting_cost_basis === "queue" ? "queue" : "system",
    optimizeS: Boolean(body.optimize_s),
    sMax: draft(body.s_max),
    waitT: draft(body.wait_threshold),
    waitTUnit: unit,
  };
}

type Parsed = { value: number | null; empty: boolean; invalid: boolean };

function parse(text: string): Parsed {
  const t = text.trim();
  if (!t) return { value: null, empty: true, invalid: false };
  const p = parseDecimalDraft(t);
  if (p.invalid || p.value == null) return { value: null, empty: false, invalid: true };
  return { value: p.value, empty: false, invalid: false };
}

/** Convierte un tiempo de `from` a la unidad `to`. */
export function convertTime(value: number, from: TimeUnit, to: TimeUnit): number {
  return (value * unitInfo(from).hours) / unitInfo(to).hours;
}

/** Tasa por unidad base a partir de "uno cada X <unidad>". */
function rateFromTime(time: number, timeUnit: TimeUnit, base: TimeUnit): number {
  return 1 / convertTime(time, timeUnit, base);
}

type RateCheck = { value: number | null; error?: string };

function readRate(
  mode: RateMode,
  rateText: string,
  timeText: string,
  timeUnit: TimeUnit,
  base: TimeUnit,
  messages: { missingRate: string; missingTime: string; positive: string },
): RateCheck {
  if (mode === "rate") {
    const p = parse(rateText);
    if (p.empty) return { value: null, error: messages.missingRate };
    if (p.invalid) return { value: null, error: "Escribe un número válido." };
    if (!(p.value! > 0)) return { value: null, error: messages.positive };
    return { value: p.value };
  }
  const p = parse(timeText);
  if (p.empty) return { value: null, error: messages.missingTime };
  if (p.invalid) return { value: null, error: "Escribe un número válido." };
  if (!(p.value! > 0)) return { value: null, error: "El tiempo promedio debe ser mayor que 0." };
  return { value: rateFromTime(p.value!, timeUnit, base) };
}

function readInteger(text: string, missing: string, label: string, min: number, max: number): RateCheck {
  const p = parse(text);
  if (p.empty) return { value: null, error: missing };
  if (p.invalid || !Number.isInteger(p.value) || p.value! < min) {
    return { value: null, error: `${label} debe ser un número entero mayor o igual que ${min}.` };
  }
  if (p.value! > max) return { value: null, error: `${label} puede ser como máximo ${max}.` };
  return { value: p.value };
}

function readOptional(text: string, negative: string): RateCheck & { empty: boolean } {
  const p = parse(text);
  if (p.empty) return { value: null, empty: true };
  if (p.invalid) return { value: null, empty: false, error: "Escribe un número válido." };
  if (p.value! < 0) return { value: null, empty: false, error: negative };
  return { value: p.value, empty: false };
}

/** Valida el formulario y arma el cuerpo de la petición (las tasas en la unidad base). */
export function validateQueuesForm(form: QueuesForm): QueuesReport {
  const errors: QueuesReport["errors"] = {};
  const { model, timeUnit } = form;
  const unit = unitInfo(timeUnit);
  const population = hasPopulation(model);

  const lambda = readRate(form.arrivalMode, form.lambda, form.arrivalTime, form.arrivalTimeUnit, timeUnit, {
    missingRate: population
      ? `Ingresa cuántas veces por ${unit.label} llega cada cliente (λ).`
      : `Ingresa cuántos clientes llegan por ${unit.label} (λ).`,
    missingTime: population
      ? "Ingresa cada cuánto tiempo regresa un mismo cliente."
      : "Ingresa el tiempo promedio entre una llegada y la siguiente.",
    positive: "La tasa de llegada debe ser mayor que 0.",
  });
  if (lambda.error) errors.lambda = lambda.error;

  const mu = readRate(form.serviceMode, form.mu, form.serviceTime, form.serviceTimeUnit, timeUnit, {
    missingRate: `Ingresa cuántos clientes atiende un servidor por ${unit.label} (μ).`,
    missingTime: "Ingresa cuánto tarda en promedio atender a un cliente.",
    positive: "La tasa de servicio debe ser mayor que 0.",
  });
  if (mu.error) errors.mu = mu.error;

  let servers: number | null = 1;
  if (isMultiServer(model)) {
    const s = readInteger(form.s, "Indica cuántos servidores hay.", "El número de servidores", 1, QUEUES_S_MAX);
    if (s.error) errors.s = s.error;
    servers = s.value;
  }

  let K: number | null = null;
  if (hasCapacity(model)) {
    const k = readInteger(form.K, "Indica cuántos clientes caben en total.", "La capacidad K", 1, QUEUES_K_MAX);
    if (k.error) errors.K = k.error;
    else if (servers != null && k.value! < servers) {
      errors.K = `La capacidad K debe ser al menos igual al número de servidores (${servers}).`;
    }
    K = k.value;
  }

  let N: number | null = null;
  if (population) {
    const n = readInteger(form.N, "Indica cuántos clientes hay en la población.", "La población N", 1, QUEUES_N_MAX);
    if (n.error) errors.N = n.error;
    N = n.value;
  }

  let sigma: number | null = null;
  if (model === "M/G/1") {
    const sg = readOptional(form.sigma, "La desviación estándar no puede ser negativa.");
    if (sg.empty) errors.sigma = "Ingresa la desviación estándar del tiempo de servicio (0 si es constante).";
    else if (sg.error) errors.sigma = sg.error;
    else sigma = convertTime(sg.value!, form.sigmaUnit, timeUnit);
  }

  const cw = readOptional(form.costWait, "El costo de espera no puede ser negativo.");
  if (cw.error) errors.costWait = cw.error;
  const cs = readOptional(form.costServer, "El costo por servidor no puede ser negativo.");
  if (cs.error) errors.costServer = cs.error;

  const optimize = form.optimizeS && isMultiServer(model);
  let sMax: number | null = null;
  if (optimize) {
    if (cw.empty && !errors.costWait) errors.costWait = "Para comparar servidores necesitas el costo de espera.";
    if (cs.empty && !errors.costServer) errors.costServer = "Para comparar servidores necesitas el costo por servidor.";
    if (form.sMax.trim()) {
      const sm = readInteger(form.sMax, "", "El máximo de servidores", 1, QUEUES_S_MAX);
      if (sm.error) errors.sMax = sm.error;
      sMax = sm.value;
    }
  }

  const wt = readOptional(form.waitT, "El tiempo no puede ser negativo.");
  if (wt.error) errors.waitT = wt.error;

  const base = { lambda: lambda.value, mu: mu.value, servers };
  if (Object.keys(errors).length || lambda.value == null || mu.value == null) {
    return { errors, body: null, ...base };
  }

  const body: QueuesBody = {
    model,
    lambda: lambda.value,
    mu: mu.value,
    include_pn: true,
    time_unit: unit.label,
  };
  if (isMultiServer(model)) body.s = servers!;
  if (K != null) body.K = K;
  if (N != null) body.N = N;
  if (sigma != null) body.service_std_dev = sigma;
  if (!cw.empty || !cs.empty) {
    body.cost_waiting_per_unit_time = cw.value ?? 0;
    body.cost_server_per_unit_time = cs.value ?? 0;
    body.waiting_cost_basis = form.costBasis;
  }
  if (optimize) {
    body.optimize_s = true;
    if (sMax != null) body.s_max = sMax;
  }
  if (!wt.empty && wt.value != null) body.wait_threshold = convertTime(wt.value, form.waitTUnit, timeUnit);
  return { errors, body, ...base };
}

/* ——— Formato ——— */

export function fmtNum(value: number | null | undefined, digits = 4): string {
  if (value == null || Number.isNaN(value)) return "—";
  if (!Number.isFinite(value)) return "∞";
  return value.toLocaleString("es-MX", { maximumFractionDigits: digits });
}

export function fmtPct(value: number | null | undefined, digits = 1): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toLocaleString("es-MX", { style: "percent", maximumFractionDigits: digits });
}

/**
 * Tiempo legible: el valor en la unidad base y, si conviene, su equivalente en una unidad más
 * natural (0.1333 h → "8 min").
 */
export function humanTime(value: number | null | undefined, unit: TimeUnit): { main: string; alt: string | null } {
  if (value == null || Number.isNaN(value)) return { main: "—", alt: null };
  if (!Number.isFinite(value)) return { main: "∞", alt: null };
  const info = unitInfo(unit);
  const main = `${fmtNum(value, 4)} ${value === 1 ? info.label : info.plural}`;
  const hours = value * info.hours;
  let alt: string | null = null;
  const pick = (u: TimeUnit) => {
    const v = convertTime(value, unit, u);
    const ui = unitInfo(u);
    return `${fmtNum(v, v < 10 ? 2 : 1)} ${ui.short}`;
  };
  if (unit !== "s" && hours < 1 / 60) alt = pick("s");
  else if (unit !== "min" && hours < 1 && hours >= 1 / 60) alt = pick("min");
  else if (unit === "d" && hours < 24) alt = pick("h");
  else if (unit === "min" && hours >= 1) alt = pick("h");
  else if (unit === "s" && hours >= 1 / 60) alt = pick("min");
  return { main, alt: alt ? `≈ ${alt}` : null };
}

export type QueuesPreview = {
  lambda: number;
  mu: number;
  servers: number;
  r: number;
  rho: number | null;
  stable: boolean;
  /** s mínimo para que M/M/s sea estable. */
  minServers: number;
};

/** Cálculo rápido en el navegador para la vista previa (el resultado oficial viene del API). */
export function previewQueues(model: QueueModel, lambda: number, mu: number, servers: number): QueuesPreview {
  const r = lambda / mu;
  const finite = isFiniteModel(model);
  const rho = finite ? null : lambda / (servers * mu);
  return {
    lambda,
    mu,
    servers,
    r,
    rho,
    stable: finite || (rho as number) < 1,
    minServers: Math.floor(r) + 1,
  };
}
