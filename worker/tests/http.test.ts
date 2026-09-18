import { describe, expect, it } from "vitest";
import app from "../src/app";
import { moduleResultToXlsx } from "../src/export/xlsx";
import { moduleResultToPdf } from "../src/export/pdf";
import { solve as solveLp } from "../src/modules/lp/solver";

describe("http + export", () => {
  it("health", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", product: "LaraOps" });
  });

  it("unknown module is 501", async () => {
    const res = await app.request("/api/v1/modules/eoq/solve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ D: 1, S: 1, H: 1 }),
    });
    expect(res.status).toBe(501);
    const body = (await res.json()) as { detail: string };
    expect(body.detail).toContain("eoq");
  });

  it("solves queues over HTTP", async () => {
    const res = await app.request("/api/v1/modules/queues/solve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "M/M/1", lambda: 10, mu: 15 }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { solution: { metrics: { L: number } } };
    expect(body.solution.metrics.L).toBeCloseTo(2, 5);
  });

  it("builds xlsx and pdf bytes", async () => {
    const result = solveLp({
      sense: "max",
      objective: { x1: 3, x2: 2 },
      constraints: [
        { id: "c1", coeffs: { x1: 2, x2: 1 }, sense: "<=", rhs: 100 },
        { id: "c2", coeffs: { x1: 1, x2: 1 }, sense: "<=", rhs: 80 },
        { id: "c3", coeffs: { x1: 1, x2: 0 }, sense: "<=", rhs: 40 },
      ],
    });
    const xlsx = moduleResultToXlsx(result);
    expect(xlsx.byteLength).toBeGreaterThan(100);
    const pdf = await moduleResultToPdf(result);
    expect(pdf.byteLength).toBeGreaterThan(100);
  });
});
