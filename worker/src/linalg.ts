export function zeros(m: number, n: number): number[][] {
  return Array.from({ length: m }, () => Array(n).fill(0));
}

export function cloneMat(A: number[][]): number[][] {
  return A.map((row) => row.slice());
}

export function identity(n: number): number[][] {
  const I = zeros(n, n);
  for (let i = 0; i < n; i++) I[i][i] = 1;
  return I;
}

export function matmul(A: number[][], B: number[][]): number[][] {
  const m = A.length;
  const k = A[0]?.length ?? 0;
  const n = B[0]?.length ?? 0;
  const C = zeros(m, n);
  for (let i = 0; i < m; i++) {
    for (let t = 0; t < k; t++) {
      const a = A[i][t];
      if (a === 0) continue;
      for (let j = 0; j < n; j++) C[i][j] += a * B[t][j];
    }
  }
  return C;
}

export function matvec(A: number[][], x: number[]): number[] {
  return A.map((row) => row.reduce((s, v, j) => s + v * x[j], 0));
}

export function vecmat(x: number[], A: number[][]): number[] {
  const n = A[0]?.length ?? 0;
  const y = Array(n).fill(0);
  for (let i = 0; i < x.length; i++) {
    const xi = x[i];
    if (xi === 0) continue;
    const row = A[i];
    for (let j = 0; j < n; j++) y[j] += xi * row[j];
  }
  return y;
}

export function dot(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

export function column(A: number[][], j: number): number[] {
  return A.map((row) => row[j]);
}

export function columns(A: number[][], idx: number[]): number[][] {
  return A.map((row) => idx.map((j) => row[j]));
}

export function addScaledRow(target: number[], source: number[], factor: number): void {
  for (let j = 0; j < target.length; j++) target[j] += factor * source[j];
}

export function invert(A: number[][]): number[][] {
  const n = A.length;
  if (n === 0) return [];
  const m = A.map((row, i) => {
    if (row.length !== n) throw new Error("matrix must be square");
    const aug = row.slice();
    for (let j = 0; j < n; j++) aug.push(i === j ? 1 : 0);
    return aug;
  });
  for (let col = 0; col < n; col++) {
    let pivot = col;
    let best = Math.abs(m[col][col]);
    for (let r = col + 1; r < n; r++) {
      const v = Math.abs(m[r][col]);
      if (v > best) {
        best = v;
        pivot = r;
      }
    }
    if (best < 1e-14) throw new Error("singular matrix");
    if (pivot !== col) {
      const tmp = m[col];
      m[col] = m[pivot];
      m[pivot] = tmp;
    }
    const div = m[col][col];
    for (let j = 0; j < 2 * n; j++) m[col][j] /= div;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = m[r][col];
      if (f === 0) continue;
      for (let j = 0; j < 2 * n; j++) m[r][j] -= f * m[col][j];
    }
  }
  return m.map((row) => row.slice(n));
}

export function pinv(A: number[][]): number[][] {
  try {
    return invert(A);
  } catch {
    const n = A.length;
    const ridge = A.map((row, i) => row.map((v, j) => v + (i === j ? 1e-10 : 0)));
    return invert(ridge);
  }
}

export function finite(x: number): boolean {
  return Number.isFinite(x);
}
