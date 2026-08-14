# Desplegar LaraOps en Render (plan gratuito)

LaraOps no usa base de datos. En Render van **dos servicios**:

| Servicio | Tipo | Qué es |
|---|---|---|
| `laraops-api` | Web Service (Free) | FastAPI + solvers |
| `laraops-web` | Static Site | Frontend Vite (CDN, no se duerme) |

El archivo `render.yaml` en la raíz del repo define ambos.

## Antes de empezar

1. Sube el repo a GitHub (público o privado).
2. Crea una cuenta en [render.com](https://render.com) e inicia sesión con GitHub.
3. No hace falta tarjeta para el plan Free. Sin tarjeta, si se acaba el ancho de banda o los minutos de build, Render **suspende** servicios el resto del mes.

## Opción A — Blueprint (recomendada)

1. En el dashboard: **New → Blueprint**.
2. Conecta el repositorio de LaraOps.
3. Render lee `render.yaml` y propone `laraops-api` + `laraops-web`.
4. **Apply**. Espera a que la API quede `Live` (el primer build de Python con NumPy/SciPy puede tardar varios minutos).
5. Abre la URL del estático (`https://laraops-web.onrender.com`) y resuelve un EOQ de prueba.

`VITE_API_URL` se toma de la URL pública de la API. Si el frontend se construyó **antes** de que la API existiera, entra a `laraops-web` → **Manual Deploy → Deploy latest commit** para reconstruir.

## Opción B — A mano (si no usas el Blueprint)

### 1. API

**New → Web Service**

- Repo: este proyecto
- Root Directory: `api`
- Runtime: Python
- Instance type: **Free**
- Build: `pip install .`
- Start: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
- Health Check Path: `/health`
- Env: `PYTHON_VERSION=3.12.8`

Anota la URL, por ejemplo `https://laraops-api.onrender.com`.

### 2. Frontend

**New → Static Site**

- Root Directory: `web`
- Build: `npm install && npm run build`
- Publish directory: `dist`
- Env de **build**: `VITE_API_URL=https://laraops-api.onrender.com` (la URL del paso 1, sin slash final)
- Redirect/Rewrite: `/*` → `/index.html` (tipo rewrite)

## Comprobar que funciona

1. API: `https://laraops-api.onrender.com/health` debe devolver `{"status":"ok","product":"LaraOps"}`.
2. Docs: `https://laraops-api.onrender.com/docs`.
3. Web: abre el Static Site, entra a EOQ y pulsa Resolver (`Q* = 200` con los defaults).

La primera petición a la API tras ~15 min de inactividad tarda **cerca de 1 minuto** (spin-up del plan Free). Render muestra una página de carga. El frontend no se duerme.

## Dominio propio (opcional)

En cada servicio: **Settings → Custom Domain**.

Si el frontend no es `*.onrender.com`, añade en la API:

```
CORS_ORIGINS=https://tudominio.com
```

Luego **Manual Deploy** de la API. Por defecto la API acepta cualquier origen `https://*.onrender.com` (previews incluidos). No hay login ni cookies; está pensado para un solver público de clase.

Si cambias `VITE_API_URL`, hay que **rebuild** el Static Site (Vite incrusta esa URL en el JS).

## Límites del Free que te afectan

- API Free: 512 MB RAM / 0.1 CPU. Problemas de clase van bien; ILP/NLP enormes pueden fallar por memoria.
- 750 horas/mes de instancia Free. Mientras la API duerme **no** consume horas.
- 5 GB de ancho de banda y 500 minutos de build al mes (API + web).
- Disco efímero: irrelevante (no hay DB).
- No hay red privada entre Free y el estático: el navegador llama a la API por HTTPS público. Así está pensado.

## Problemas frecuentes

| Síntoma | Qué hacer |
|---|---|
| El frontend carga pero Resolver falla (CORS o Network) | Revisa `VITE_API_URL` (rebuild del web). Comprueba `/health` de la API. |
| Primera resolución tarda ~1 min | Normal: la API se despertó. Las siguientes son rápidas. |
| Build de la API falla con Python | Confirma `PYTHON_VERSION=3.12.8` y Root Directory `api`. |
| Ruta `/lp` en recarga da 404 | Falta el rewrite `/*` → `/index.html`. El Blueprint ya lo trae. |
| “Resolver” no pega a la API local | En local sigue `VITE_API_URL=http://127.0.0.1:8000` (o el default). |

## Local vs Render

Local no cambia:

```bash
npm install
npm run dev
```

- Web: http://127.0.0.1:5173
- API: http://127.0.0.1:8000
