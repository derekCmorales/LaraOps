import app from "../../worker/src/app";

export function onRequest(context: { request: Request; env: unknown; waitUntil: (p: Promise<unknown>) => void }) {
  return app.fetch(context.request, context.env, context);
}
