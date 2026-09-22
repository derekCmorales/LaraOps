import type { GraphXY } from "../../schema";
import type { LPRequest } from "./types";
import { collectVarNames } from "./types";

const EPS = 1e-9;
const FEAS_TOL = 1e-7;
const RANK_TOL = 1e-8;
const MAX_TRIPLES = 8000;
const NICE = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];

type Vec3 = [number, number, number];
type Plane3 = {
  a: number;
  b: number;
  c: number;
  rhs: number;
  source: string;
  viewClip?: boolean;
  display: [number, number, number, number];
};
type Vertex3 = { x: number; y: number; z: number; sources: string[]; tight: number[] };
type Face = { x: number[]; y: number[]; z: number[]; i: number[]; j: number[]; k: number[] };

export function build3dGraph(
  req: LPRequest,
  xStar: Record<string, number>,
  zStar: number,
  zOffset = 0,
  fixed?: Record<string, number> | null,
): GraphXY | null {
  const names = collectVarNames(req);
  if (names.length !== 3) return null;
  const [xName, yName, zName] = names;
  const ox = xStar[xName] ?? 0;
  const oy = xStar[yName] ?? 0;
  const oz = xStar[zName] ?? 0;
  const c1 = req.objective[xName] ?? 0;
  const c2 = req.objective[yName] ?? 0;
  const c3 = req.objective[zName] ?? 0;
  const { planes, equalities } = modelPlanes(req, xName, yName, zName);
  if (tooMany(planes.length + equalities.length + 6)) return null;
  const seed = enumerate(planes, equalities);
  const [[xMin, xMax], [yMin, yMax], [zMin, zMax]] = viewBox(planes.concat(equalities), seed, ox, oy, oz);
  const view = viewPlanes(xMin, xMax, yMin, yMax, zMin, zMax);
  if (tooMany(planes.length + view.length + equalities.length)) return null;
  const closed = enumerate(planes.concat(view), equalities);
  const fullZ = zStar + zOffset;
  const series: Record<string, unknown>[] = [];
  series.push(...faceSeries(closed, planes.concat(view, equalities), xName, yName, zName));
  const edges = edgeSeries(closed, planes.concat(view, equalities));
  if (edges) series.push(edges);
  const objective = objectiveFace(c1, c2, c3, zStar, xMin, xMax, yMin, yMax, zMin, zMax, xName, yName, zName);
  if (objective) series.push(objective);
  const labeled = seed.filter((v) => v.sources.length >= 3);
  if (labeled.length) {
    series.push({
      name: "vertices",
      role: "vertices",
      x: labeled.map((v) => clean(v.x)),
      y: labeled.map((v) => clean(v.y)),
      z: labeled.map((v) => clean(v.z)),
      meta: labeled.map((v) => ({
        x: clean(v.x),
        y: clean(v.y),
        z: clean(v.z),
        objective: clean(c1 * v.x + c2 * v.y + c3 * v.z + zOffset),
        sources: v.sources,
      })),
    });
  }
  series.push({
    name: "optimum",
    role: "point",
    x: [clean(ox)],
    y: [clean(oy)],
    z: [clean(oz)],
    meta: [{ x: clean(ox), y: clean(oy), z: clean(oz), objective: clean(fullZ), sources: ["óptimo"] }],
  });
  const sliced = Boolean(fixed && Object.keys(fixed).length);
  let subtitle = `Óptimo: ${xName} = ${fmtNum(ox)}, ${yName} = ${fmtNum(oy)}, ${zName} = ${fmtNum(oz)}, Z = ${fmtNum(fullZ)}`;
  if (fixed && sliced) {
    const held = Object.entries(fixed)
      .map(([name, value]) => `${name} = ${fmtNum(value)}`)
      .join(", ");
    subtitle += `. Fijas en el óptimo: ${held}`;
  }
  return {
    type: "xy",
    kind: "lp3d",
    series,
    x_label: xName,
    y_label: yName,
    z_label: zName,
    title: sliced ? "Corte 3D por el óptimo" : "Región factible y punto óptimo",
    subtitle,
  };
}

function modelPlanes(req: LPRequest, xName: string, yName: string, zName: string) {
  const planes: Plane3[] = [];
  const equalities: Plane3[] = [];
  const axes: Record<string, Vec3> = {
    [xName]: [1, 0, 0],
    [yName]: [0, 1, 0],
    [zName]: [0, 0, 1],
  };
  for (const name of [xName, yName, zName]) {
    const [lo, hi] = varBounds(req, name);
    const [ax, ay, az] = axes[name];
    if (lo != null) {
      const label = Math.abs(lo) < EPS ? `eje ${name}` : `cota inf ${name}`;
      planes.push({ a: -ax, b: -ay, c: -az, rhs: -lo, source: label, display: [ax, ay, az, lo] });
    }
    if (hi != null) {
      planes.push({ a: ax, b: ay, c: az, rhs: hi, source: `cota ${name}`, display: [ax, ay, az, hi] });
    }
  }
  for (const c of req.constraints) {
    const ax = c.coeffs[xName] ?? 0;
    const ay = c.coeffs[yName] ?? 0;
    const az = c.coeffs[zName] ?? 0;
    if (Math.abs(ax) < EPS && Math.abs(ay) < EPS && Math.abs(az) < EPS) continue;
    const display: [number, number, number, number] = [ax, ay, az, c.rhs];
    if (c.sense === "=") equalities.push({ a: ax, b: ay, c: az, rhs: c.rhs, source: c.id, display });
    else if (c.sense === ">=") {
      planes.push({ a: -ax, b: -ay, c: -az, rhs: -c.rhs, source: c.id, display });
    } else planes.push({ a: ax, b: ay, c: az, rhs: c.rhs, source: c.id, display });
  }
  return { planes, equalities };
}

function varBounds(req: LPRequest, name: string): [number | null, number | null] {
  if (req.bounds && name in req.bounds) return req.bounds[name];
  return [0, null];
}

function tooMany(n: number): boolean {
  if (n < 3) return false;
  return (n * (n - 1) * (n - 2)) / 6 > MAX_TRIPLES;
}

function enumerate(planes: Plane3[], equalities: Plane3[]): Vertex3[] {
  const boundaries = planes.concat(equalities);
  const found = new Map<string, Vertex3>();
  const n = boundaries.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      for (let k = j + 1; k < n; k++) {
        const hit = intersect3(boundaries[i], boundaries[j], boundaries[k]);
        if (!hit) continue;
        const [x, y, z] = hit;
        if (Math.abs(x) > 1e8 || Math.abs(y) > 1e8 || Math.abs(z) > 1e8) continue;
        if (!feasible(x, y, z, planes, equalities)) continue;
        const key = `${round8(x)}|${round8(y)}|${round8(z)}`;
        const classified = classify(x, y, z, boundaries);
        found.set(key, { x, y, z, sources: classified.sources, tight: classified.tight });
      }
    }
  }
  return [...found.values()];
}

function intersect3(p: Plane3, q: Plane3, r: Plane3): Vec3 | null {
  return solve3(
    [
      [p.a, p.b, p.c],
      [q.a, q.b, q.c],
      [r.a, r.b, r.c],
    ],
    [p.rhs, q.rhs, r.rhs],
  );
}

function feasible(x: number, y: number, z: number, planes: Plane3[], equalities: Plane3[]): boolean {
  for (const p of planes) {
    if (p.a * x + p.b * y + p.c * z > p.rhs + FEAS_TOL) return false;
  }
  for (const eq of equalities) {
    if (Math.abs(eq.a * x + eq.b * y + eq.c * z - eq.rhs) > FEAS_TOL) return false;
  }
  return true;
}

function classify(x: number, y: number, z: number, boundaries: Plane3[]) {
  const sources: string[] = [];
  const tight: number[] = [];
  boundaries.forEach((p, i) => {
    if (Math.abs(p.a * x + p.b * y + p.c * z - p.rhs) <= FEAS_TOL) {
      tight.push(i);
      if (!p.viewClip) sources.push(p.source);
    }
  });
  return { sources, tight };
}

function viewBox(lines: Plane3[], vertices: Vertex3[], ox: number, oy: number, oz: number) {
  const xs = [0, ox];
  const ys = [0, oy];
  const zs = [0, oz];
  for (const v of vertices) {
    xs.push(v.x);
    ys.push(v.y);
    zs.push(v.z);
  }
  const scale = Math.max(1, Math.abs(ox), Math.abs(oy), Math.abs(oz), ...xs.map(Math.abs), ...ys.map(Math.abs), ...zs.map(Math.abs));
  const limit = scale * 4;
  for (const line of lines) {
    for (const [coef, bucket] of [
      [line.a, xs],
      [line.b, ys],
      [line.c, zs],
    ] as [number, number[]][]) {
      if (Math.abs(coef) <= EPS) continue;
      const intercept = line.rhs / coef;
      if (!Number.isFinite(intercept) || intercept <= EPS || intercept > limit) continue;
      bucket.push(intercept);
    }
  }
  return [windowOf(xs), windowOf(ys), windowOf(zs)] as [
    [number, number],
    [number, number],
    [number, number],
  ];
}

function windowOf(values: number[]): [number, number] {
  const finite = values.filter((v) => Number.isFinite(v));
  if (!finite.length) return [0, 1];
  const rawMin = Math.min(...finite);
  const rawMax = Math.max(...finite);
  const lo = rawMin < -EPS ? -niceCeil(-rawMin * 1.12) : 0;
  let hi = niceCeil(Math.max(rawMax, 0) * 1.12);
  if (hi <= lo) hi = lo + 1;
  return [lo, lo >= -EPS ? Math.max(hi, 1) : hi];
}

function viewPlanes(xMin: number, xMax: number, yMin: number, yMax: number, zMin: number, zMax: number): Plane3[] {
  const planes: Plane3[] = [
    { a: 1, b: 0, c: 0, rhs: xMax, source: "_vista_x", viewClip: true, display: [1, 0, 0, xMax] },
    { a: 0, b: 1, c: 0, rhs: yMax, source: "_vista_y", viewClip: true, display: [0, 1, 0, yMax] },
    { a: 0, b: 0, c: 1, rhs: zMax, source: "_vista_z", viewClip: true, display: [0, 0, 1, zMax] },
  ];
  if (xMin < -EPS) planes.push({ a: -1, b: 0, c: 0, rhs: -xMin, source: "_vista_x0", viewClip: true, display: [1, 0, 0, xMin] });
  if (yMin < -EPS) planes.push({ a: 0, b: -1, c: 0, rhs: -yMin, source: "_vista_y0", viewClip: true, display: [0, 1, 0, yMin] });
  if (zMin < -EPS) planes.push({ a: 0, b: 0, c: -1, rhs: -zMin, source: "_vista_z0", viewClip: true, display: [0, 0, 1, zMin] });
  return planes;
}

function faceSeries(vertices: Vertex3[], boundaries: Plane3[], xName: string, yName: string, zName: string) {
  const buckets = new Map<string, Face & { equation: string }>();
  boundaries.forEach((plane, index) => {
    const pts = vertices.filter((v) => v.tight.includes(index)).map((v) => [v.x, v.y, v.z] as Vec3);
    const face = polygonMesh(pts, [plane.a, plane.b, plane.c]);
    if (!face) return;
    const key = plane.viewClip ? "view_limit" : `constraint:${plane.source}`;
    const equation = plane.viewClip ? "" : fmtTerms(plane.display, xName, yName, zName);
    mergeFace(buckets, key, face, equation);
  });
  return [...buckets.entries()].map(([name, bucket]) => {
    const item: Record<string, unknown> = {
      name,
      role: "face",
      x: bucket.x,
      y: bucket.y,
      z: bucket.z,
      i: bucket.i,
      j: bucket.j,
      k: bucket.k,
    };
    if (bucket.equation) item.equation = bucket.equation;
    return item;
  });
}

function mergeFace(buckets: Map<string, Face & { equation: string }>, key: string, face: Face, equation: string) {
  const bucket = buckets.get(key) ?? { x: [], y: [], z: [], i: [], j: [], k: [], equation: "" };
  const offset = bucket.x.length;
  bucket.x.push(...face.x);
  bucket.y.push(...face.y);
  bucket.z.push(...face.z);
  bucket.i.push(...face.i.map((i) => i + offset));
  bucket.j.push(...face.j.map((j) => j + offset));
  bucket.k.push(...face.k.map((k) => k + offset));
  if (equation && !bucket.equation.includes(equation)) {
    bucket.equation = bucket.equation ? `${bucket.equation} · ${equation}` : equation;
  }
  buckets.set(key, bucket);
}

function polygonMesh(points: Vec3[], normal: Vec3): Face | null {
  const ordered = orderPolygon(uniquePoints(points), normal);
  if (ordered.length < 3) return null;
  const i: number[] = [];
  const j: number[] = [];
  const k: number[] = [];
  for (let t = 1; t < ordered.length - 1; t++) {
    if (triArea(ordered[0], ordered[t], ordered[t + 1]) < 1e-10) continue;
    i.push(0);
    j.push(t);
    k.push(t + 1);
  }
  if (!i.length) return null;
  return {
    x: ordered.map((p) => clean(p[0])),
    y: ordered.map((p) => clean(p[1])),
    z: ordered.map((p) => clean(p[2])),
    i,
    j,
    k,
  };
}

function uniquePoints(points: Vec3[]): Vec3[] {
  const found = new Map<string, Vec3>();
  for (const p of points) found.set(`${round8(p[0])}|${round8(p[1])}|${round8(p[2])}`, p);
  return [...found.values()];
}

function orderPolygon(points: Vec3[], normal: Vec3): Vec3[] {
  if (points.length < 3) return [...points];
  const nrm = unit(normal);
  if (!nrm) return [...points];
  const helper: Vec3 = Math.abs(nrm[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const basisU = unit(cross(nrm, helper));
  if (!basisU) return [...points];
  const basisV = cross(nrm, basisU);
  const c = points.reduce((s, p) => [s[0] + p[0], s[1] + p[1], s[2] + p[2]] as Vec3, [0, 0, 0] as Vec3);
  const cx = c[0] / points.length;
  const cy = c[1] / points.length;
  const cz = c[2] / points.length;
  const angle = (p: Vec3) => {
    const d: Vec3 = [p[0] - cx, p[1] - cy, p[2] - cz];
    return Math.atan2(dot(d, basisV), dot(d, basisU));
  };
  return [...points].sort((p, q) => angle(p) - angle(q));
}

function edgeSeries(vertices: Vertex3[], boundaries: Plane3[]): Record<string, unknown> | null {
  const xs: (number | null)[] = [];
  const ys: (number | null)[] = [];
  const zs: (number | null)[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < vertices.length; i++) {
    for (let j = i + 1; j < vertices.length; j++) {
      const a = vertices[i];
      const b = vertices[j];
      if (!isEdge(a, b, boundaries)) continue;
      const key = segmentKey(a, b);
      if (seen.has(key) || key.startsWith("same:")) continue;
      seen.add(key);
      if (xs.length) {
        xs.push(null);
        ys.push(null);
        zs.push(null);
      }
      xs.push(clean(a.x), clean(b.x));
      ys.push(clean(a.y), clean(b.y));
      zs.push(clean(a.z), clean(b.z));
    }
  }
  if (xs.length < 2) return null;
  return { name: "edges", role: "edges", x: xs, y: ys, z: zs };
}

function isEdge(a: Vertex3, b: Vertex3, boundaries: Plane3[]): boolean {
  const common = a.tight.filter((i) => b.tight.includes(i));
  if (common.length < 2) return false;
  return rankOf(common.map((i) => [boundaries[i].a, boundaries[i].b, boundaries[i].c])) === 2;
}

function segmentKey(a: Vertex3, b: Vertex3): string {
  const pa = `${round8(a.x)}|${round8(a.y)}|${round8(a.z)}`;
  const pb = `${round8(b.x)}|${round8(b.y)}|${round8(b.z)}`;
  if (pa === pb) return `same:${pa}`;
  return pa < pb ? `${pa}~${pb}` : `${pb}~${pa}`;
}

function objectiveFace(
  c1: number,
  c2: number,
  c3: number,
  rhs: number,
  xMin: number,
  xMax: number,
  yMin: number,
  yMax: number,
  zMin: number,
  zMax: number,
  xName: string,
  yName: string,
  zName: string,
): Record<string, unknown> | null {
  if (Math.abs(c1) < EPS && Math.abs(c2) < EPS && Math.abs(c3) < EPS) return null;
  const hits = planeBoxHits(c1, c2, c3, rhs, xMin, xMax, yMin, yMax, zMin, zMax);
  const face = polygonMesh(hits, [c1, c2, c3]);
  if (!face) return null;
  return {
    name: "objective_plane",
    role: "face",
    equation: fmtTerms([c1, c2, c3, rhs], xName, yName, zName),
    ...face,
  };
}

function planeBoxHits(
  a: number,
  b: number,
  c: number,
  rhs: number,
  xMin: number,
  xMax: number,
  yMin: number,
  yMax: number,
  zMin: number,
  zMax: number,
): Vec3[] {
  const corners: Vec3[] = [
    [xMin, yMin, zMin],
    [xMax, yMin, zMin],
    [xMin, yMax, zMin],
    [xMax, yMax, zMin],
    [xMin, yMin, zMax],
    [xMax, yMin, zMax],
    [xMin, yMax, zMax],
    [xMax, yMax, zMax],
  ];
  const edges: [number, number][] = [
    [0, 1],
    [0, 2],
    [0, 4],
    [1, 3],
    [1, 5],
    [2, 3],
    [2, 6],
    [3, 7],
    [4, 5],
    [4, 6],
    [5, 7],
    [6, 7],
  ];
  const hits: Vec3[] = [];
  const normal: Vec3 = [a, b, c];
  for (const [i, j] of edges) {
    const p0 = corners[i];
    const p1 = corners[j];
    const direction: Vec3 = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
    const denom = dot(normal, direction);
    if (Math.abs(denom) < EPS) continue;
    let t = (rhs - dot(normal, p0)) / denom;
    if (t < -1e-8 || t > 1 + 1e-8) continue;
    t = Math.min(1, Math.max(0, t));
    hits.push([p0[0] + t * direction[0], p0[1] + t * direction[1], p0[2] + t * direction[2]]);
  }
  return hits;
}

function fmtTerms(shown: [number, number, number, number], xName: string, yName: string, zName: string): string {
  const [ax, ay, az, rhs] = shown;
  const terms: string[] = [];
  for (const [coef, name] of [
    [ax, xName],
    [ay, yName],
    [az, zName],
  ] as [number, string][]) {
    if (Math.abs(coef) < EPS) continue;
    const mag = fmtNum(Math.abs(coef));
    const body = mag === "1" ? name : `${mag} ${name}`;
    if (!terms.length) terms.push(coef > 0 ? body : `-${body}`);
    else terms.push(coef > 0 ? `+ ${body}` : `- ${body}`);
  }
  return `${terms.join(" ") || "0"} = ${fmtNum(rhs)}`;
}

function triArea(a: Vec3, b: Vec3, c: Vec3): number {
  const ab: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ac: Vec3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  return 0.5 * norm(cross(ab, ac));
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
function norm(a: Vec3): number {
  return Math.sqrt(dot(a, a));
}
function unit(a: Vec3): Vec3 | null {
  const n = norm(a);
  if (n < EPS) return null;
  return [a[0] / n, a[1] / n, a[2] / n];
}

function solve3(m: number[][], rhs: number[]): Vec3 | null {
  const d = det3(m);
  if (!Number.isFinite(d) || Math.abs(d) < RANK_TOL) return null;
  const col = (k: number) => m.map((row, i) => row.map((v, j) => (j === k ? rhs[i] : v)));
  const x = det3(col(0)) / d;
  const y = det3(col(1)) / d;
  const z = det3(col(2)) / d;
  if (![x, y, z].every(Number.isFinite)) return null;
  return [x, y, z];
}

function det3(m: number[][]): number {
  const a = m[0];
  const b = m[1];
  const c = m[2];
  return (
    a[0] * (b[1] * c[2] - b[2] * c[1]) -
    a[1] * (b[0] * c[2] - b[2] * c[0]) +
    a[2] * (b[0] * c[1] - b[1] * c[0])
  );
}

function rankOf(rows: number[][]): number {
  const a = rows.map((r) => [r[0], r[1], r[2]]);
  let rank = 0;
  let lead = 0;
  for (let col = 0; col < 3 && lead < a.length; col++) {
    let sel = lead;
    for (let i = lead + 1; i < a.length; i++) {
      if (Math.abs(a[i][col]) > Math.abs(a[sel][col])) sel = i;
    }
    if (Math.abs(a[sel][col]) < RANK_TOL) continue;
    const tmp = a[lead];
    a[lead] = a[sel];
    a[sel] = tmp;
    const piv = a[lead][col];
    for (let i = lead + 1; i < a.length; i++) {
      const f = a[i][col] / piv;
      for (let j = col; j < 3; j++) a[i][j] -= f * a[lead][j];
    }
    lead += 1;
    rank += 1;
  }
  return rank;
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

function fmtNum(value: number): string {
  if (Math.abs(value - Math.round(value)) < 1e-8) return String(Math.round(value));
  return value.toPrecision(4).replace(/\.?0+$/, "");
}

function clean(value: number): number {
  const rounded = Number(value.toFixed(10));
  return Math.abs(rounded) < 1e-12 ? 0 : rounded;
}

function round8(value: number): number {
  return Math.round(value * 1e8) / 1e8;
}
