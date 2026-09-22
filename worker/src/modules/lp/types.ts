import { SolverError } from "../../errors";
import { LIMITS, assertLimit } from "../../limits";

export type ConstraintSense = "<=" | ">=" | "=";

export type LPConstraint = {
  id: string;
  coeffs: Record<string, number>;
  sense: ConstraintSense;
  rhs: number;
};

export type LPRequest = {
  sense: "min" | "max";
  objective: Record<string, number>;
  constraints: LPConstraint[];
  variable_names?: string[] | null;
  /** 2 = corte plano, 3 = poliedro. El resto se fija en el óptimo. */
  graph_variables?: string[] | null;
  bounds?: Record<string, [number | null, number | null]> | null;
  include_iterations?: boolean;
  include_sensitivity?: boolean;
  include_graph?: boolean;
};

function asRecord(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new SolverError("payload debe ser un objeto JSON");
  }
  return body as Record<string, unknown>;
}

function numMap(v: unknown): Record<string, number> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const out: Record<string, number> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) out[k] = Number(val) || 0;
  return out;
}

export function parseLpRequest(body: unknown): LPRequest {
  const o = asRecord(body);
  const sense = o.sense === "min" ? "min" : o.sense === "max" ? "max" : null;
  if (!sense) throw new SolverError("sense debe ser min o max");
  const constraintsRaw = Array.isArray(o.constraints) ? o.constraints : [];
  const constraints: LPConstraint[] = constraintsRaw.map((c, i) => {
    const row = asRecord(c);
    const s = row.sense;
    if (s !== "<=" && s !== ">=" && s !== "=") throw new SolverError(`restricción ${i}: sense inválido`);
    return {
      id: String(row.id ?? `c${i + 1}`),
      coeffs: numMap(row.coeffs),
      sense: s,
      rhs: Number(row.rhs),
    };
  });
  const req: LPRequest = {
    sense,
    objective: numMap(o.objective),
    constraints,
    variable_names: Array.isArray(o.variable_names) ? o.variable_names.map(String) : null,
    graph_variables: Array.isArray(o.graph_variables) ? o.graph_variables.map(String).filter(Boolean) : null,
    bounds: parseBounds(o.bounds),
    include_iterations: o.include_iterations !== false,
    include_sensitivity: o.include_sensitivity !== false,
    include_graph: o.include_graph !== false,
  };
  const n = collectVarNames(req).length;
  assertLimit(n <= LIMITS.lpVars, `LP limitado a ${LIMITS.lpVars} variables en el plan Free`);
  assertLimit(
    constraints.length <= LIMITS.lpConstraints,
    `LP limitado a ${LIMITS.lpConstraints} restricciones en el plan Free`,
  );
  return req;
}

function parseBounds(raw: unknown): LPRequest["bounds"] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out: Record<string, [number | null, number | null]> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (Array.isArray(v) && v.length >= 2) {
      out[k] = [v[0] == null ? null : Number(v[0]), v[1] == null ? null : Number(v[1])];
    }
  }
  return out;
}

export function collectVarNames(req: LPRequest): string[] {
  if (req.variable_names?.length) return [...req.variable_names];
  const names = new Set(Object.keys(req.objective));
  for (const c of req.constraints) Object.keys(c.coeffs).forEach((k) => names.add(k));
  return [...names].sort();
}
