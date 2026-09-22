# Desplegar LaraOps en Cloudflare Pages (plan Free)

Producción es un **solo origen**:

- **Pages** sirve el SPA Vite (`web/dist`).
- **Pages Functions** (Workers) cubren `/health` y `/api/v1/*`.
- Dominio: `https://laraops.larasolutions.dev`

No hay base de datos. Los solvers desplegados (LP, transporte, asignación, redes/transbordo, colas, PERT/CPM + aceleración, EOQ) corren en TypeScript dentro del Worker. En el home aparecen los workbenches con `migrated: true`: LP, transporte, asignación, redes, PERT/CPM, EOQ y teoría de colas. El resto queda en un desplegable cerrado, «Módulos no disponibles».

## Primera vez

1. Cuenta Cloudflare Free (no hace falta tarjeta).
2. Instala Wrangler y autentica: `npx wrangler login` (o usa un API token).
3. Crea el proyecto Pages si no existe:

```bash
npx wrangler pages project create laraops --production-branch main
```

4. Build y deploy:

```bash
npm install
cd web && npm install && cd ..
npm run deploy
```

Quedará algo como `https://laraops.pages.dev`.

## Subdominio `laraops.larasolutions.dev`

El apex `larasolutions.dev` está en otro registrar. En Cloudflare Pages:

1. Proyecto `laraops` → **Custom domains** → `laraops.larasolutions.dev`.
2. En el DNS del registrar, crea:

```
CNAME  laraops  laraops.pages.dev
```

3. Espera el SSL (Universal, Free). No hace falta mover el dominio entero a Cloudflare.

Si el CNAME pide un target distinto, usa el que muestre el dashboard (a veces `<proyecto>.pages.dev`).

## GitHub Actions

El workflow [`.github/workflows/deploy-cloudflare.yml`](../.github/workflows/deploy-cloudflare.yml) corre tests en PRs y **despliega solo en push a `main`**. El primer deploy crea el proyecto Pages `laraops` si aún no existe (queda en `https://laraops.pages.dev`).

Usa Node 22 (Wrangler 4 no corre en Node 20).

Secrets del repo (obligatorios; sin ellos el job de `main` falla antes de Wrangler):

1. [Settings → Secrets and variables → Actions](https://github.com/derekCmorales/LaraOps/settings/secrets/actions)
2. `CLOUDFLARE_API_TOKEN` — token con permiso **Account → Cloudflare Pages → Edit** (Read no alcanza: lista proyectos pero Cloudflare responde 403 al crear o desplegar)
3. `CLOUDFLARE_ACCOUNT_ID` — ID de la cuenta

Si el token es Account API Token, evita el template de solo lectura. Tras cambiar permisos, vuelve a pegar el valor en el secret de GitHub y relanza **Actions → Deploy Cloudflare Pages → Run workflow**.

El deploy **solo corre en push a `main`**. Los pull requests ejecutan tests y el build, no Wrangler (los secrets no deben llegar a PRs).

## Local

```bash
npm install
cd web && npm install && cd ..
npm run test:worker
npm run dev
```

- UI: http://127.0.0.1:5173 (Vite; `/api` y `/health` se proxifican al Worker)
- Worker: http://127.0.0.1:8788

La API Python (`npm run dev:python`) sigue disponible como referencia; producción ya no la usa.

## Límites del Free que importan

- ~100 000 peticiones/día al Worker.
- ~10 ms de CPU por invocación: problemas de clase caben; hay techos (p. ej. 25 variables LP, TSP exacto ≤10 nodos).
- Sin cold start de instancia: la primera resolución no espera un minuto como en Render Free.

## Añadir un módulo después

1. Porta el solver a `worker/src/modules/<nombre>/solver.ts`.
2. `register("<nombre>", solve)` en [`worker/src/modules/register.ts`](../worker/src/modules/register.ts).
3. Marca `migrated: true` en [`web/src/lib/modulesCatalog.ts`](../web/src/lib/modulesCatalog.ts) para que aparezca en el home.
4. Tests Vitest en `worker/tests/`.

El frontend ya llama `/api/v1/modules/<api>/solve` same-origin; no hace falta `VITE_API_URL` en Pages.

## Render (fallback)

El Blueprint [`render.yaml`](../render.yaml) y [`docs/deploy-render.md`](deploy-render.md) siguen en el repo por si hace falta el FastAPI completo. No es el camino de producción.
