import { Hono } from "hono";
import { cors } from "hono/cors";
import { HttpError, SolverError } from "./errors";
import { moduleResultToPdf } from "./export/pdf";
import { moduleResultToXlsx } from "./export/xlsx";
import { getModule, listModules } from "./registry";
import "./modules/register";

const app = new Hono();

app.use("*", cors({ origin: "*" }));

app.get("/health", (c) => c.json({ status: "ok", product: "LaraOps" }));

app.get("/api/v1/modules", (c) => c.json({ modules: listModules() }));

app.post("/api/v1/modules/:module/solve", async (c) => {
  const result = await solveModule(c.req.param("module"), await readJson(c));
  return c.json(result);
});

app.post("/api/v1/modules/:module/export.xlsx", async (c) => {
  const mod = c.req.param("module");
  const result = await solveModule(mod, await readJson(c));
  const bytes = moduleResultToXlsx(result);
  return c.body(bytes, 200, {
    "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "Content-Disposition": `attachment; filename="${mod}_result.xlsx"`,
  });
});

app.post("/api/v1/modules/:module/export.pdf", async (c) => {
  const mod = c.req.param("module");
  const result = await solveModule(mod, await readJson(c));
  const bytes = await moduleResultToPdf(result);
  return c.body(bytes, 200, {
    "Content-Type": "application/pdf",
    "Content-Disposition": `attachment; filename="${mod}_result.pdf"`,
  });
});

app.notFound((c) => c.json({ detail: "not found" }, 404));

app.onError((err, c) => {
  if (err instanceof HttpError) return c.json({ detail: err.message }, err.status);
  if (err instanceof SolverError) return c.json({ detail: err.message }, 400);
  const message = err instanceof Error ? err.message : "error interno";
  return c.json({ detail: message }, 500);
});

async function readJson(c: { req: { json: () => Promise<unknown> } }): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    throw new HttpError(400, "JSON inválido");
  }
}

async function solveModule(mod: string, body: unknown) {
  const solver = getModule(mod);
  if (!solver) {
    throw new HttpError(
      501,
      `module not deployed: ${mod}. Desplegados: ${listModules().join(", ")}. Añade el solver en worker/src/modules/ y regístralo.`,
    );
  }
  return solver(body);
}

export default app;
