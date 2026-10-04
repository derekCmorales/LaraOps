import { parseDecimalDraft } from "../components/FormFields";

export type HoldingMode = "amount" | "rate";

/** Estado del formulario EOQ. Los valores se guardan como texto para distinguir "vacío" de 0. */
export type EoqForm = {
  D: string;
  S: string;
  holdingMode: HoldingMode;
  H: string;
  /** Tasa anual de mantener en % del costo unitario (H = i · C). */
  rate: string;
  C: string;
  leadTime: string;
  workingDays: string;
};

export type EoqBody = {
  D: number;
  S: number;
  H: number;
  C: number;
  lead_time?: number;
  working_days?: number;
};

export type EoqField = "D" | "S" | "H" | "rate" | "C" | "leadTime" | "workingDays";

export type EoqReport = {
  errors: Partial<Record<EoqField, string>>;
  body: EoqBody | null;
  /** H efectivo (directo o calculado desde la tasa) cuando se puede obtener. */
  holding: number | null;
};

export const DEFAULT_WORKING_DAYS = 365;

export const EOQ_EXAMPLE: EoqBody = { D: 1000, S: 10, H: 0.5, C: 5, lead_time: 7, working_days: 250 };

export function blankEoqForm(): EoqForm {
  return {
    D: "",
    S: "",
    holdingMode: "amount",
    H: "",
    rate: "",
    C: "",
    leadTime: "",
    workingDays: String(DEFAULT_WORKING_DAYS),
  };
}

function draft(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "";
  return value.toLocaleString("es-MX", { useGrouping: false, maximumFractionDigits: 12 });
}

export function formFromBody(body: Partial<EoqBody>): EoqForm {
  const leadTime = Number(body.lead_time ?? 0);
  const C = Number(body.C ?? 0);
  return {
    D: draft(body.D),
    S: draft(body.S),
    holdingMode: "amount",
    H: draft(body.H),
    rate: "",
    C: C > 0 ? draft(C) : "",
    leadTime: leadTime > 0 ? draft(leadTime) : "",
    workingDays: draft(body.working_days ?? DEFAULT_WORKING_DAYS),
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

function required(text: string, missing: string, positive: string): { value: number | null; error?: string } {
  const p = parse(text);
  if (p.empty) return { value: null, error: missing };
  if (p.invalid) return { value: null, error: "Escribe un número válido." };
  if (!(p.value! > 0)) return { value: null, error: positive };
  return { value: p.value };
}

function optional(text: string, negative: string): { value: number; error?: string } {
  const p = parse(text);
  if (p.empty) return { value: 0 };
  if (p.invalid) return { value: 0, error: "Escribe un número válido." };
  if (p.value! < 0) return { value: 0, error: negative };
  return { value: p.value! };
}

/** Valida el formulario y arma el cuerpo de la petición. */
export function validateEoqForm(form: EoqForm): EoqReport {
  const errors: EoqReport["errors"] = {};

  const D = required(form.D, "Ingresa la demanda anual.", "La demanda debe ser mayor que 0.");
  if (D.error) errors.D = D.error;

  const S = required(form.S, "Ingresa el costo por pedido.", "El costo por pedido debe ser mayor que 0.");
  if (S.error) errors.S = S.error;

  const C = optional(form.C, "El costo unitario no puede ser negativo.");
  if (C.error) errors.C = C.error;

  let holding: number | null = null;
  if (form.holdingMode === "amount") {
    const H = required(form.H, "Ingresa el costo de mantener.", "El costo de mantener debe ser mayor que 0.");
    if (H.error) errors.H = H.error;
    holding = H.value;
  } else {
    const rate = required(form.rate, "Ingresa la tasa anual de mantener.", "La tasa debe ser mayor que 0 %.");
    if (rate.error) errors.rate = rate.error;
    if (!C.error && !(C.value > 0)) {
      errors.C = "Para usar la tasa necesitas el costo unitario (H = tasa × C).";
    }
    if (rate.value != null && C.value > 0) holding = (rate.value / 100) * C.value;
  }

  const leadTime = optional(form.leadTime, "El tiempo de entrega no puede ser negativo.");
  if (leadTime.error) errors.leadTime = leadTime.error;

  const days = required(form.workingDays, "Ingresa los días de operación por año.", "Los días por año deben ser mayores que 0.");
  if (days.error) errors.workingDays = days.error;
  else if (days.value! > 366) errors.workingDays = "Un año tiene como máximo 366 días.";

  if (Object.keys(errors).length || D.value == null || S.value == null || holding == null) {
    return { errors, body: null, holding };
  }

  const body: EoqBody = { D: D.value, S: S.value, H: holding, C: C.value };
  if (leadTime.value > 0) body.lead_time = leadTime.value;
  if (days.value !== DEFAULT_WORKING_DAYS) body.working_days = days.value!;
  return { errors, body, holding };
}

export function fmtNum(value: number, digits = 2): string {
  return value.toLocaleString("es-MX", { maximumFractionDigits: digits });
}

export type EoqPreview = {
  qStar: number;
  orders: number;
  relevant: number;
  reorderPoint: number | null;
};

/** Cálculo rápido en el navegador para la vista previa (el resultado oficial viene del API). */
export function previewEoq(body: EoqBody): EoqPreview {
  const qStar = Math.sqrt((2 * body.D * body.S) / body.H);
  const orders = body.D / qStar;
  const relevant = orders * body.S + (qStar / 2) * body.H;
  const days = body.working_days ?? DEFAULT_WORKING_DAYS;
  const reorderPoint = body.lead_time ? (body.D / days) * body.lead_time : null;
  return { qStar, orders, relevant, reorderPoint };
}
