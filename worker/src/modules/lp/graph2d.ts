import type { GraphXY, NamedTable } from "../../schema";
import type { LPRequest } from "./types";
import { collectVarNames } from "./types";

const EPS = 1e-9;
const FEAS_TOL = 1e-7;
const BOX_TOL = 1e-8;
const VIEW_X = "_vista_x";
const VIEW_Y = "_vista_y";
const NICE = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];

type Plane = { a: number; b: number; rhs: number; source: string; view_clip?: boolean };
type Vertex = { x: number; y: number; sources: string[] };

export function build2dGraph(req: LPRequest, xStar: Record<string, number>, zStar: number): GraphXY | null {
  const names = collectVarNames(req);
  if (names.length !== 2) return null;
  const [xName, yName] = names;
  const ox = xStar[xName] ?? 0;
  const oy = xStar[yName] ?? 0;
  const c1 = req.objective[xName] ?? 0;
  const c2 = req.objective[yName] ?? 0;
  const { planes, equalities } = modelPlanes(req, xName, yName);
  const seed = enumerateVertices(planes, equalities);
  const [xMax, yMax] = viewBox([...planes, ...equalities], seed, ox, oy);
  const viewPlanes: Plane[] = [
    { a: 1, b: 0, rhs: xMax, source: VIEW_X, view_clip: true },
    { a: 0, b: 1, rhs: yMax, source: VIEW_Y, view_clip: true },
  ];
  const closed = enumerateVertices([...planes, ...viewPlanes], equalities);
  const fillPoly = sortCcw(closed);
  const labeled = seed.filter((v) => v.sources.length >= 2);
  const series: Record<string, unknown>[] = [];
  if (fillPoly.length >= 3 && !equalities.length) {
    series.push({
      name: "feasible_region",
      x: [...fillPoly.map((v) => clean(v.x)), clean(fillPoly[0].x)],
      y: [...fillPoly.map((v) => clean(v.y)), clean(fillPoly[0].y)],
      role: "fill",
    });
  }
  for (const c of req.constraints) {
    const ax = c.coeffs[xName] ?? 0;
    const ay = c.coeffs[yName] ?? 0;
    const clipped = clipLineToBox(ax, ay, c.rhs, 0, 0, xMax, yMax);
    if (clipped.length < 2) continue;
    series.push({
      name: `constraint:${c.id}`,
      x: clipped.map((p) => clean(p[0])),
      y: clipped.map((p) => clean(p[1])),
      role: "line",
      equation: fmtEquation(ax, ay, c.rhs, xName, yName),
    });
  }
  for (const plane of planes) {
    if (!plane.source.startsWith("cota ")) continue;
    const clipped = clipLineToBox(plane.a, plane.b, plane.rhs, 0, 0, xMax, yMax);
    if (clipped.length < 2) continue;
    series.push({
      name: `constraint:${plane.source}`,
      x: clipped.map((p) => clean(p[0])),
      y: clipped.map((p) => clean(p[1])),
      role: "line",
      equation: fmtEquation(plane.a, plane.b, plane.rhs, xName, yName),
    });
  }
  const zLine = clipLineToBox(c1, c2, zStar, 0, 0, xMax, yMax);
  if (zLine.length >= 2) {
    series.push({
      name: "objective_level",
      x: zLine.map((p) => clean(p[0])),
      y: zLine.map((p) => clean(p[1])),
      role: "line",
      equation: fmtEquation(c1, c2, zStar, xName, yName),
    });
  }
  if (labeled.length) {
    series.push({
      name: "vertices",
      x: labeled.map((v) => clean(v.x)),
      y: labeled.map((v) => clean(v.y)),
      role: "vertices",
      meta: labeled.map((v) => ({
        x: clean(v.x),
        y: clean(v.y),
        z: clean(c1 * v.x + c2 * v.y),
        sources: v.sources,
      })),
    });
  }
  series.push({
    name: "optimum",
    x: [clean(ox)],
    y: [clean(oy)],
    role: "point",
    meta: [{ x: clean(ox), y: clean(oy), z: clean(zStar), sources: ["óptimo"] }],
  });
  return {
    type: "xy",
    kind: "lp2d",
    series,
    x_label: xName,
    y_label: yName,
    title: "Región factible y punto óptimo",
    subtitle: `Óptimo: ${xName} = ${fmtNum(ox)}, ${yName} = ${fmtNum(oy)}, Z = ${fmtNum(zStar)}`,
  };
}

export function verticesNamedTable(
  graph: GraphXY,
  ox: number,
  oy: number,
  maximize: boolean,
): NamedTable | null {
  const verts = graph.series.find((s) => s.name === "vertices");
  const meta = (verts?.meta as Record<string, unknown>[] | undefined) ?? null;
  if (!meta?.length) return null;
  const xName = graph.x_label || "x";
  const yName = graph.y_label || "y";
  const rows: (number | string)[][] = meta.map((item) => {
    const x = clean(Number(item.x));
    const y = clean(Number(item.y));
    const z = clean(Number(item.z ?? 0));
    const origen = ((item.sources as string[]) ?? []).join(" ∩ ");
    const isOpt = Math.abs(x - ox) <= FEAS_TOL && Math.abs(y - oy) <= FEAS_TOL;
    return [x, y, z, origen, isOpt ? "sí" : ""];
  });
  rows.sort((a, b) => (maximize ? Number(b[2]) - Number(a[2]) : Number(a[2]) - Number(b[2])));
  return { name: "vertices_feasible", columns: [xName, yName, "Z", "origen", "optimo"], rows };
}

function varBounds(req: LPRequest, name: string): [number | null, number | null] {
  if (req.bounds && name in req.bounds) return req.bounds[name];
  return [0, null];
}

function modelPlanes(req: LPRequest, xName: string, yName: string): { planes: Plane[]; equalities: Plane[] } {
  const planes: Plane[] = [];
  const equalities: Plane[] = [];
  for (const name of [xName, yName]) {
    const [lo, hi] = varBounds(req, name);
    const ax = name === xName ? 1 : 0;
    const ay = name === xName ? 0 : 1;
    if (lo != null) {
      const label = Math.abs(lo) < EPS ? `eje ${name}` : `cota ${name}`;
      planes.push({ a: -ax, b: -ay, rhs: -lo, source: label });
    }
    if (hi != null) planes.push({ a: ax, b: ay, rhs: hi, source: `cota ${name}` });
  }
  for (const c of req.constraints) {
    const ax = c.coeffs[xName] ?? 0;
    const ay = c.coeffs[yName] ?? 0;
    if (Math.abs(ax) < EPS && Math.abs(ay) < EPS) continue;
    if (c.sense === "=") {
      equalities.push({ a: ax, b: ay, rhs: c.rhs, source: c.id });
      continue;
    }
    if (c.sense === ">=") planes.push({ a: -ax, b: -ay, rhs: -c.rhs, source: c.id });
    else planes.push({ a: ax, b: ay, rhs: c.rhs, source: c.id });
  }
  return { planes, equalities };
}

function enumerateVertices(planes: Plane[], equalities: Plane[]): Vertex[] {
  const boundaries = [...planes, ...equalities];
  const found = new Map<string, Vertex>();
  for (let i = 0; i < boundaries.length; i++) {
    for (let j = i + 1; j < boundaries.length; j++) {
      const hit = intersect(boundaries[i], boundaries[j]);
      if (!hit) continue;
      const [x, y] = hit;
      if (!feasible(x, y, planes, equalities)) continue;
      const key = `${x.toFixed(8)}:${y.toFixed(8)}`;
      found.set(key, { x, y, sources: sourcesAt(x, y, planes, equalities) });
    }
  }
  return [...found.values()];
}

function intersect(p: Plane, q: Plane): [number, number] | null {
  const det = p.a * q.b - q.a * p.b;
  if (Math.abs(det) < EPS) return null;
  const x = (p.rhs * q.b - q.rhs * p.b) / det;
  const y = (p.a * q.rhs - q.a * p.rhs) / det;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return [x, y];
}

function feasible(x: number, y: number, planes: Plane[], equalities: Plane[]): boolean {
  for (const p of planes) if (p.a * x + p.b * y > p.rhs + FEAS_TOL) return false;
  for (const eq of equalities) if (Math.abs(eq.a * x + eq.b * y - eq.rhs) > FEAS_TOL) return false;
  return true;
}

function sourcesAt(x: number, y: number, planes: Plane[], equalities: Plane[]): string[] {
  const hits: string[] = [];
  for (const p of [...planes, ...equalities]) {
    if (p.view_clip) continue;
    if (Math.abs(p.a * x + p.b * y - p.rhs) <= FEAS_TOL) hits.push(p.source);
  }
  return hits;
}

function viewBox(lines: Plane[], vertices: Vertex[], ox: number, oy: number): [number, number] {
  const xs = [0, Math.max(ox, 0)];
  const ys = [0, Math.max(oy, 0)];
  for (const v of vertices) {
    if (v.x >= -EPS) xs.push(v.x);
    if (v.y >= -EPS) ys.push(v.y);
  }
  for (const line of lines) {
    if (Math.abs(line.b) < EPS && Math.abs(line.a) > EPS) {
      const xv = line.rhs / line.a;
      if (xv > EPS) xs.push(xv);
    }
    if (Math.abs(line.a) < EPS && Math.abs(line.b) > EPS) {
      const yv = line.rhs / line.b;
      if (yv > EPS) ys.push(yv);
    }
    if (Math.abs(line.a) > EPS && Math.abs(line.b) > EPS) {
      const xInt = line.rhs / line.a;
      const yInt = line.rhs / line.b;
      if (xInt > EPS) xs.push(xInt);
      if (yInt > EPS) ys.push(yInt);
    }
  }
  return [Math.max(niceCeil(Math.max(...xs) * 1.12), 1), Math.max(niceCeil(Math.max(...ys) * 1.12), 1)];
}

function niceCeil(value: number): number {
  if (value <= 0) return 1;
  const exp = Math.floor(Math.log10(value));
  const frac = value / 10 ** exp;
  for (const n of NICE) {
    if (frac <= n + 1e-12) return clean(n * 10 ** exp);
  }
  return clean(10 * 10 ** exp);
}

function sortCcw(vertices: Vertex[]): Vertex[] {
  if (vertices.length < 3) return [...vertices];
  const cx = vertices.reduce((s, v) => s + v.x, 0) / vertices.length;
  const cy = vertices.reduce((s, v) => s + v.y, 0) / vertices.length;
  return [...vertices].sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));
}

function clipLineToBox(
  a: number,
  b: number,
  rhs: number,
  xMin: number,
  yMin: number,
  xMax: number,
  yMax: number,
): [number, number][] {
  if (Math.abs(a) < EPS && Math.abs(b) < EPS) return [];
  const pts: [number, number][] = [];
  const add = (x: number, y: number) => {
    if (xMin - BOX_TOL <= x && x <= xMax + BOX_TOL && yMin - BOX_TOL <= y && y <= yMax + BOX_TOL) {
      if (pts.every((p) => Math.abs(x - p[0]) > BOX_TOL || Math.abs(y - p[1]) > BOX_TOL)) pts.push([x, y]);
    }
  };
  if (Math.abs(b) > EPS) {
    add(xMin, (rhs - a * xMin) / b);
    add(xMax, (rhs - a * xMax) / b);
  }
  if (Math.abs(a) > EPS) {
    add((rhs - b * yMin) / a, yMin);
    add((rhs - b * yMax) / a, yMax);
  }
  if (pts.length < 2) return pts;
  pts.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  return [pts[0], pts[pts.length - 1]];
}

function fmtEquation(ax: number, ay: number, rhs: number, xName: string, yName: string): string {
  const terms: string[] = [];
  for (const [coef, name] of [
    [ax, xName],
    [ay, yName],
  ] as [number, string][]) {
    if (Math.abs(coef) < EPS) continue;
    const mag = fmtNum(Math.abs(coef));
    const body = mag === "1" ? name : `${mag} ${name}`;
    if (!terms.length) terms.push(coef > 0 ? body : `-${body}`);
    else terms.push(coef > 0 ? `+ ${body}` : `- ${body}`);
  }
  return `${terms.join(" ") || "0"} = ${fmtNum(rhs)}`;
}

function fmtNum(value: number): string {
  if (Math.abs(value - Math.round(value)) < BOX_TOL) return String(Math.round(value));
  return value.toPrecision(4).replace(/\.?0+$/, "");
}

function clean(value: number): number {
  const rounded = Number(value.toFixed(10));
  return Math.abs(rounded) < 1e-12 ? 0 : rounded;
}
