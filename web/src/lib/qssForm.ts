import { parseDecimalDraft } from "../components/FormFields";

export type QssField =
  | "arrival_rate"
  | "service_rate"
  | "num_servers"
  | "simulation_time"
  | "seed"
  | "capacity"
  | "warmup";

export type QssForm = {
  arrival_rate: string;
  service_rate: string;
  num_servers: string;
  simulation_time: string;
  seed: string;
  capacity: string;
  warmup: string;
  useCapacity: boolean;
};

export type QssBody = {
  arrival_rate: number;
  service_rate: number;
  num_servers: number;
  simulation_time: number;
  seed: number;
  warmup: number;
  capacity: number | null;
};

export type QssReport = {
  errors: Partial<Record<QssField, string>>;
  body: QssBody | null;
  arrival: number | null;
  service: number | null;
  servers: number | null;
};

export function blankQssForm(): QssForm {
  return {
    arrival_rate: "",
    service_rate: "",
    num_servers: "",
    simulation_time: "",
    seed: "",
    capacity: "",
    warmup: "",
    useCapacity: false,
  };
}

export function exampleQssForm(): QssForm {
  return {
    arrival_rate: "4",
    service_rate: "5",
    num_servers: "1",
    simulation_time: "800",
    seed: "42",
    capacity: "",
    warmup: "80",
    useCapacity: false,
  };
}

function draft(value: unknown): string {
  const n = typeof value === "number" ? value : Number(value);
  if (value == null || value === "" || !Number.isFinite(n)) return "";
  return n.toLocaleString("es-MX", { useGrouping: false, maximumFractionDigits: 12 });
}

export function formFromBody(body: unknown): QssForm {
  const form = blankQssForm();
  if (!body || typeof body !== "object" || Array.isArray(body)) return form;
  const o = body as Record<string, unknown>;
  const capacity = o.capacity;
  const limited = typeof capacity === "number" && Number.isFinite(capacity);
  return {
    arrival_rate: draft(o.arrival_rate),
    service_rate: draft(o.service_rate),
    num_servers: draft(o.num_servers),
    simulation_time: draft(o.simulation_time),
    seed: draft(o.seed),
    warmup: draft(o.warmup),
    capacity: limited ? draft(capacity) : "",
    useCapacity: limited,
  };
}

type Parsed = { empty: boolean; invalid: boolean; value: number | null };

function parseNum(text: string): Parsed {
  const t = text.trim();
  if (!t) return { empty: true, invalid: false, value: null };
  const p = parseDecimalDraft(t);
  if (p.invalid || p.value == null) return { empty: false, invalid: true, value: null };
  return { empty: false, invalid: false, value: p.value };
}

function readPositive(text: string, missing: string, label: string): { value: number | null; error?: string } {
  const p = parseNum(text);
  if (p.empty) return { value: null, error: missing };
  if (p.invalid || p.value == null) return { value: null, error: "Escribe un número válido." };
  if (!(p.value > 0)) return { value: null, error: `${label} debe ser mayor que 0.` };
  return { value: p.value };
}

export function validateQssForm(form: QssForm): QssReport {
  const errors: QssReport["errors"] = {};
  const arrival = readPositive(form.arrival_rate, "Ingresa la tasa de llegada λ.", "La tasa de llegada");
  if (arrival.error) errors.arrival_rate = arrival.error;
  const service = readPositive(form.service_rate, "Ingresa la tasa de servicio μ.", "La tasa de servicio");
  if (service.error) errors.service_rate = service.error;

  const serversParsed = parseNum(form.num_servers);
  let servers: number | null = null;
  if (serversParsed.empty) errors.num_servers = "Indica el número de servidores.";
  else if (serversParsed.invalid || serversParsed.value == null || !Number.isInteger(serversParsed.value) || serversParsed.value < 1) {
    errors.num_servers = "El número de servidores debe ser un entero mayor o igual que 1.";
  } else if (serversParsed.value > 100) errors.num_servers = "El número de servidores no puede superar 100.";
  else servers = serversParsed.value;

  const time = readPositive(form.simulation_time, "Ingresa el tiempo de simulación.", "El tiempo de simulación");
  if (time.error) errors.simulation_time = time.error;
  else if (time.value != null && time.value > 1_000_000) {
    errors.simulation_time = "El tiempo de simulación no puede superar 1000000.";
  }

  const seedParsed = parseNum(form.seed);
  let seed: number | null = null;
  if (seedParsed.empty) errors.seed = "Indica la semilla.";
  else if (seedParsed.invalid || seedParsed.value == null) errors.seed = "La semilla debe ser un número.";
  else seed = seedParsed.value;

  let warmup = 0;
  if (form.warmup.trim()) {
    const w = parseNum(form.warmup);
    if (w.invalid || w.value == null) errors.warmup = "El calentamiento debe ser un número.";
    else if (w.value < 0) errors.warmup = "El calentamiento no puede ser negativo.";
    else if (time.value != null && w.value >= time.value) {
      errors.warmup = "El calentamiento debe ser menor que el tiempo de simulación.";
    } else warmup = w.value ?? 0;
  }

  let capacity: number | null = null;
  if (form.useCapacity) {
    const c = parseNum(form.capacity);
    if (c.empty) errors.capacity = "Indica el cupo del sistema.";
    else if (c.invalid || c.value == null || !Number.isInteger(c.value) || c.value < 1) {
      errors.capacity = "La capacidad debe ser un entero mayor o igual que 1.";
    } else capacity = c.value;
  }

  const base = { arrival: arrival.value, service: service.value, servers };
  if (Object.keys(errors).length || arrival.value == null || service.value == null || servers == null || time.value == null || seed == null) {
    return { errors, body: null, ...base };
  }
  return {
    errors,
    body: {
      arrival_rate: arrival.value,
      service_rate: service.value,
      num_servers: servers,
      simulation_time: time.value,
      seed,
      warmup,
      capacity,
    },
    ...base,
  };
}

export function fmtNum(value: number | null | undefined, digits = 4): string {
  if (value == null || Number.isNaN(value)) return "—";
  if (!Number.isFinite(value)) return "∞";
  return value.toLocaleString("es-MX", { maximumFractionDigits: digits });
}

export function fmtPct(value: number | null | undefined, digits = 1): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toLocaleString("es-MX", { style: "percent", maximumFractionDigits: digits });
}
