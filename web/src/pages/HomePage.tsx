import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { MIGRATED_MODULES, MODULE_GROUPS, searchDisabledModules, searchModules, type ModuleMeta } from "../lib/modulesCatalog";
import { clearRecent, recentModules } from "../lib/recent";

function groupModules(modules: ModuleMeta[]) {
  return MODULE_GROUPS.map((group) => ({
    group,
    modules: modules.filter((m) => m.group === group),
  })).filter((g) => g.modules.length);
}

function ModuleRow({ module, showGroup }: { module: ModuleMeta; showGroup?: boolean }) {
  return (
    <li>
      <Link to={module.path} className="catalog-item">
        <strong>{module.name}</strong>
        <span>
          {showGroup ? `${module.group} · ` : ""}
          {module.methods}
        </span>
      </Link>
    </li>
  );
}

export default function HomePage() {
  const [q, setQ] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const [recent, setRecent] = useState<ModuleMeta[]>(() => recentModules());
  const searching = q.trim().length > 0;
  const results = useMemo(() => searchModules(q), [q]);
  const disabledMatches = useMemo(() => (searching ? searchDisabledModules(q) : []), [q, searching]);
  const byGroup = groupModules(MIGRATED_MODULES);
  const disabledByGroup = groupModules(searchDisabledModules(""));
  const disabledCount = disabledByGroup.reduce((n, g) => n + g.modules.length, 0);

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
      <div className="home-hero">
        <h1>¿Qué necesitas resolver?</h1>
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
            placeholder="Busca un método o describe tu problema…"
            aria-label="Buscar módulo"
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
        {!searching && recent.length ? (
          <p className="home-recent">
            <span className="home-recent-label">Recientes</span>
            {recent.map((m) => (
              <Link key={m.slug} to={m.path}>
                {m.name}
              </Link>
            ))}
            <button
              type="button"
              className="home-recent-clear"
              onClick={() => {
                clearRecent();
                setRecent([]);
              }}
              aria-label="Borrar recientes"
              title="Borrar recientes"
            >
              ×
            </button>
          </p>
        ) : null}
      </div>

      {searching ? (
        <div className="home-results" aria-live="polite">
          {results.length ? (
            <ul className="catalog-list">
              {results.map((m) => (
                <ModuleRow key={m.slug} module={m} showGroup />
              ))}
            </ul>
          ) : (
            <p className="home-empty">
              No hay módulos que coincidan con «{q.trim()}».{" "}
              <button type="button" className="link-btn" onClick={() => setQ("")}>
                Ver todos
              </button>
            </p>
          )}
          {disabledMatches.length ? (
            <p className="home-empty">Aún no disponible: {disabledMatches.map((m) => m.name).join(", ")}.</p>
          ) : null}
        </div>
      ) : (
        <>
          <div className="catalog">
            {byGroup.map(({ group, modules }) => (
              <div key={group} className="catalog-group">
                <h2 className="module-group-title">{group}</h2>
                <ul className="catalog-list">
                  {modules.map((m) => (
                    <ModuleRow key={m.slug} module={m} />
                  ))}
                </ul>
              </div>
            ))}
          </div>

          {disabledCount ? (
            <details className="disabled-modules">
              <summary>
                Módulos no disponibles
                <span className="disabled-modules-count">{disabledCount}</span>
              </summary>
              <div className="disabled-modules-body">
                <p className="disabled-modules-note">Aún no se pueden resolver. El listado es solo de referencia.</p>
                <div className="catalog">
                  {disabledByGroup.map(({ group, modules }) => (
                    <div key={group} className="catalog-group is-soon">
                      <h2 className="module-group-title">{group}</h2>
                      <ul className="catalog-list">
                        {modules.map((m) => (
                          <li key={m.slug}>
                            <div className="catalog-item" aria-disabled="true">
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
        </>
      )}
    </section>
  );
}
