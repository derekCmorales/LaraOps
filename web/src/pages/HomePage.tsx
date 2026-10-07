import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  SITUATIONS,
  TRACKS,
  clearHistory,
  moduleBySlug,
  recentModules,
  visitedSlugs,
  type Track,
} from "../lib/learning";
import { MODULE_GROUPS, MIGRATED_MODULES, searchDisabledModules, searchModules, type ModuleMeta } from "../lib/modulesCatalog";

/** Búsquedas de ejemplo: muestran que se puede escribir el problema, no solo el método. */
const TRY_QUERIES = ["fila en el banco", "fábricas y almacenes", "ruta más corta", "competir con un rival"];

function groupModules(modules: ModuleMeta[]) {
  return MODULE_GROUPS.map((group) => ({
    group,
    modules: modules.filter((m) => m.group === group),
  })).filter((g) => g.modules.length);
}

function ModuleCard({ module, visited }: { module: ModuleMeta; visited?: boolean }) {
  return (
    <Link to={module.path} className="module-card">
      <div className="module-card-name">
        {module.name}
        {visited ? (
          <span className="module-card-seen" title="Ya lo abriste">
            ✓ visto
          </span>
        ) : (
          <span className="module-card-arrow" aria-hidden>
            →
          </span>
        )}
      </div>
      <p className="module-card-methods">{module.methods}</p>
      <p className="module-card-group">{module.group}</p>
    </Link>
  );
}

function TrackCard({ track, visited }: { track: Track; visited: Set<string> }) {
  const steps = track.steps.map((step) => ({ ...step, module: moduleBySlug(step.slug) })).filter((s) => s.module?.migrated);
  const done = steps.filter((step) => visited.has(step.slug)).length;
  const next = steps.find((step) => !visited.has(step.slug)) ?? steps[0];
  const pct = steps.length ? Math.round((done / steps.length) * 100) : 0;

  return (
    <article className="track-card" aria-labelledby={`track-${track.id}`}>
      <header className="track-head">
        <div>
          <h3 id={`track-${track.id}`}>{track.title}</h3>
          <p>{track.subtitle}</p>
        </div>
        <span className="track-count">
          {done} de {steps.length}
        </span>
      </header>
      <div
        className="track-bar"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={steps.length}
        aria-valuenow={done}
        aria-label={`Módulos abiertos de ${track.title}`}
      >
        <span style={{ width: `${pct}%` }} />
      </div>
      <ol className="track-steps">
        {steps.map((step, i) => {
          const seen = visited.has(step.slug);
          const isNext = step === next && done < steps.length;
          return (
            <li key={step.slug} className={isNext ? "is-next" : undefined}>
              <span className={seen ? "track-dot is-done" : "track-dot"} aria-hidden>
                {seen ? "✓" : i + 1}
              </span>
              <Link to={step.module!.path}>
                <strong>{step.module!.name}</strong>
                <span>{step.learn}</span>
              </Link>
              {seen ? <span className="sr-only">(visto)</span> : null}
            </li>
          );
        })}
      </ol>
      {next ? (
        <Link to={next.module!.path} className="btn track-cta">
          {done === 0 ? "Empezar" : done === steps.length ? "Repasar" : "Seguir"} con {next.module!.name} →
        </Link>
      ) : null}
    </article>
  );
}

export default function HomePage() {
  const [q, setQ] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const [recent, setRecent] = useState<ModuleMeta[]>(() => recentModules());
  const [visited, setVisited] = useState<Set<string>>(() => visitedSlugs());
  const results = useMemo(() => searchModules(q), [q]);
  const disabled = useMemo(() => searchDisabledModules(q), [q]);
  const searching = q.trim().length > 0;
  const byGroup = groupModules(MIGRATED_MODULES);
  const disabledByGroup = groupModules(searchDisabledModules(""));

  // En pantallas grandes el cursor ya espera en la búsqueda; en el teléfono no se abre el teclado solo.
  useEffect(() => {
    if (window.matchMedia?.("(min-width: 768px)").matches) inputRef.current?.focus();
  }, []);

  // «/» enfoca la búsqueda desde cualquier parte de la página.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      e.preventDefault();
      inputRef.current?.focus();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <section className="home">
      <header className="home-hero">
        <p className="home-eyebrow">Investigación de Operaciones, paso a paso</p>
        <h1>¿Qué necesitas resolver?</h1>
        <p className="home-lede">
          Busca por método o escribe tu problema con tus palabras. Cada módulo trae un ejemplo resuelto y explica qué
          significa cada resultado.
        </p>
        <label className="search-field">
          <span aria-hidden>⌕</span>
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && results[0]) navigate(results[0].path);
              if (e.key === "Escape") setQ("");
            }}
            placeholder="Ej.: Vogel, húngaro, fila en el banco, cuánto pedir…"
            aria-label="Buscar módulo o describir el problema"
            aria-describedby="home-search-help"
            enterKeyHint="go"
          />
          {q ? (
            <button type="button" className="search-clear" onClick={() => setQ("")} aria-label="Borrar búsqueda">
              ×
            </button>
          ) : (
            <kbd className="search-kbd" aria-hidden>
              /
            </kbd>
          )}
        </label>
        <p id="home-search-help" className="home-try">
          <span>Prueba:</span>
          {TRY_QUERIES.map((text) => (
            <button key={text} type="button" className="chip" onClick={() => setQ(text)}>
              {text}
            </button>
          ))}
        </p>
      </header>

      {searching ? (
        <section className="home-section" aria-live="polite">
          <h2 className="home-section-title">
            {results.length
              ? `${results.length} ${results.length === 1 ? "módulo" : "módulos"} para «${q.trim()}»`
              : `Nada para «${q.trim()}»`}
          </h2>
          {results.length ? (
            <>
              <p className="home-section-note">Enter abre el primero.</p>
              <div className="module-grid">
                {results.map((m) => (
                  <ModuleCard key={m.slug} module={m} visited={visited.has(m.slug)} />
                ))}
              </div>
            </>
          ) : (
            <p className="home-section-note">
              Prueba con otra palabra o elige abajo la situación que se parece a la tuya.{" "}
              <button type="button" className="link-btn" onClick={() => setQ("")}>
                Ver todo
              </button>
            </p>
          )}
          {disabled.length ? (
            <p className="home-section-note">
              También coincide, pero aún no se puede resolver aquí: {disabled.map((m) => m.name).join(", ")}.
            </p>
          ) : null}
        </section>
      ) : null}

      {!searching && recent.length ? (
        <section className="home-section" aria-labelledby="home-recent">
          <div className="home-section-head">
            <h2 id="home-recent" className="home-section-title">
              Continúa donde te quedaste
            </h2>
            <button
              type="button"
              className="link-btn"
              onClick={() => {
                clearHistory();
                setRecent([]);
                setVisited(new Set());
              }}
            >
              Borrar historial
            </button>
          </div>
          <div className="recent-row">
            {recent.map((m) => (
              <Link key={m.slug} to={m.path} className="recent-chip">
                <strong>{m.name}</strong>
                <span>{m.group}</span>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {!searching ? (
        <>
          <section className="home-section" aria-labelledby="home-situations">
            <h2 id="home-situations" className="home-section-title">
              ¿No sabes qué método usar?
            </h2>
            <p className="home-section-note">Elige la situación que se parece a la tuya. El nombre del método va abajo.</p>
            <div className="situation-grid">
              {SITUATIONS.map((s) => {
                const m = moduleBySlug(s.slug);
                if (!m?.migrated) return null;
                return (
                  <Link key={s.slug} to={m.path} className="situation-card">
                    <strong>{s.problem}</strong>
                    <span className="situation-example">{s.example}</span>
                    <span className="situation-method">
                      {m.name} <span aria-hidden>→</span>
                    </span>
                  </Link>
                );
              })}
            </div>
          </section>

          <section className="home-section" aria-labelledby="home-tracks">
            <h2 id="home-tracks" className="home-section-title">
              Aprende en orden
            </h2>
            <p className="home-section-note">
              Las dos rutas siguen el orden del curso. Se marca cada módulo que abres en este navegador.
            </p>
            <div className="track-grid">
              {TRACKS.map((track) => (
                <TrackCard key={track.id} track={track} visited={visited} />
              ))}
            </div>
          </section>

          <section className="home-section" aria-labelledby="home-all">
            <h2 id="home-all" className="home-section-title">
              Todos los módulos
            </h2>
            <div className="catalog-columns">
              {byGroup.map(({ group, modules }) => (
                <div key={group} className="catalog-group">
                  <h3 className="module-group-title">{group}</h3>
                  <ul>
                    {modules.map((m) => (
                      <li key={m.slug}>
                        <Link to={m.path}>
                          <strong>
                            {m.name}
                            {visited.has(m.slug) ? <span className="catalog-seen"> ✓</span> : null}
                          </strong>
                          <span>{m.methods}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
            {disabledByGroup.length ? (
              <details className="disabled-modules">
                <summary>
                  En preparación
                  <span className="disabled-modules-count">{disabledByGroup.reduce((n, g) => n + g.modules.length, 0)}</span>
                </summary>
                <div className="disabled-modules-body">
                  <p className="disabled-modules-note">Todavía no se pueden resolver. El listado es solo de referencia.</p>
                  <div className="catalog-columns">
                    {disabledByGroup.map(({ group, modules }) => (
                      <div key={group} className="catalog-group is-soon">
                        <h3 className="module-group-title">{group}</h3>
                        <ul>
                          {modules.map((m) => (
                            <li key={m.slug}>
                              <div>
                                <strong>{m.name}</strong>
                                <span>{m.methods}</span>
                              </div>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                </div>
              </details>
            ) : null}
          </section>
        </>
      ) : null}
    </section>
  );
}
