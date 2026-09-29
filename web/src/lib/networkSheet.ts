/** Matriz de intersecciones para redes: vacío = sin arco, número = peso, costo o capacidad. */

export type Matrix = (number | null)[][];

export type NetEdge = {
  source: string;
  target: string;
  weight: number;
  capacity?: number;
};

export function blankMatrix(n: number, diagonal: number | null = null): Matrix {
  return Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => (i === j ? diagonal : null)),
  );
}

export function resizeMatrix(m: Matrix, n: number, diagonal: number | null): Matrix {
  return Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => (i === j ? diagonal : (m[i]?.[j] ?? null))),
  );
}

export function dropIndex(m: Matrix, index: number, diagonal: number | null): Matrix {
  const next = m
    .filter((_, i) => i !== index)
    .map((row) => row.filter((_, j) => j !== index));
  for (let i = 0; i < next.length; i++) next[i][i] = diagonal;
  return next;
}

/** Si ambos lados tienen número, se conserva el de la triangular superior. */
export function symmetrize(m: Matrix, diagonal: number | null): Matrix {
  const n = m.length;
  const next = m.map((row) => [...row]);
  for (let i = 0; i < n; i++) {
    next[i][i] = diagonal;
    for (let j = i + 1; j < n; j++) {
      const upper = next[i][j];
      const lower = next[j][i];
      const value = upper == null ? (lower ?? null) : upper;
      next[i][j] = value;
      next[j][i] = value;
    }
  }
  return next;
}

export function writeCell(m: Matrix, row: number, col: number, value: number | null, symmetric: boolean): Matrix {
  if (row === col || row < 0 || col < 0 || row >= m.length || col >= m.length) return m;
  const next = m.map((line) => [...line]);
  next[row][col] = value;
  if (symmetric) next[col][row] = value;
  return next;
}

export function matrixFromEdges(
  nodes: string[],
  edges: { source: string; target: string; weight?: number | null; capacity?: number | null }[],
  field: "weight" | "capacity",
  symmetric: boolean,
  diagonal: number | null = null,
): Matrix {
  const m = blankMatrix(nodes.length, diagonal);
  const index = new Map(nodes.map((name, i) => [name, i]));
  for (const edge of edges) {
    const i = index.get(edge.source);
    const j = index.get(edge.target);
    if (i == null || j == null || i === j) continue;
    const raw = field === "capacity" ? (edge.capacity ?? edge.weight) : edge.weight;
    if (raw == null || !Number.isFinite(Number(raw))) continue;
    const value = Number(raw);
    if (field === "capacity") {
      m[i][j] = (m[i][j] ?? 0) + value;
    } else {
      m[i][j] = m[i][j] == null ? value : Math.min(m[i][j]!, value);
    }
    if (symmetric) {
      const other = m[j][i];
      m[j][i] = other == null ? m[i][j] : Math.min(other, m[i][j]!);
      m[i][j] = m[j][i];
    }
  }
  return m;
}

export function edgesFromMatrix(
  nodes: string[],
  weights: Matrix,
  options: { upperOnly?: boolean; asCapacity?: boolean; capacities?: Matrix | null } = {},
): NetEdge[] {
  const edges: NetEdge[] = [];
  for (let i = 0; i < nodes.length; i++) {
    for (let j = 0; j < nodes.length; j++) {
      if (i === j) continue;
      if (options.upperOnly && i > j) continue;
      const weight = weights[i]?.[j];
      if (weight == null || !Number.isFinite(weight)) continue;
      const edge: NetEdge = { source: nodes[i], target: nodes[j], weight };
      if (options.asCapacity) edge.capacity = weight;
      const cap = options.capacities?.[i]?.[j];
      if (!options.asCapacity && cap != null && Number.isFinite(cap)) edge.capacity = cap;
      edges.push(edge);
    }
  }
  return edges;
}

export function countLinks(m: Matrix, upperOnly: boolean): number {
  let count = 0;
  for (let i = 0; i < m.length; i++) {
    for (let j = 0; j < m.length; j++) {
      if (i === j) continue;
      if (upperOnly && i > j) continue;
      if (m[i]?.[j] != null && Number.isFinite(m[i][j]!)) count += 1;
    }
  }
  return count;
}

export function missingPairs(nodes: string[], m: Matrix): [string, string][] {
  const missing: [string, string][] = [];
  for (let i = 0; i < nodes.length; i++) {
    for (let j = 0; j < nodes.length; j++) {
      if (i === j) continue;
      const value = m[i]?.[j];
      if (value == null || !Number.isFinite(value)) missing.push([nodes[i], nodes[j]]);
    }
  }
  return missing;
}

export function nextNodeName(nodes: string[]): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  for (const letter of alphabet) {
    if (!nodes.includes(letter)) return letter;
  }
  let i = nodes.length + 1;
  while (nodes.includes(`N${i}`)) i += 1;
  return `N${i}`;
}

export function diagonalFor(problem: string): number | null {
  return problem === "tsp" ? 0 : null;
}
