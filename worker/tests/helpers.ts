import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FIXTURES = path.resolve(fileURLToPath(new URL("../../api/tests/fixtures/textbook", import.meta.url)));

export function loadFixture(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path.join(FIXTURES, name), "utf8")) as Record<string, unknown>;
}

export function assertClose(a: number, b: number, atol = 1e-4): void {
  if (Math.abs(a - b) > atol) {
    throw new Error(`expected ${a} ≈ ${b} (atol=${atol})`);
  }
}

export function assertCloseMap(got: Record<string, number>, expect: Record<string, number>, atol = 1e-4): void {
  for (const [k, v] of Object.entries(expect)) {
    assertClose(got[k] ?? NaN, v, atol);
  }
}
