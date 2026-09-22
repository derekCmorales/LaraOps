import { useEffect, useMemo, useState } from "react";
import { Link, Route, Routes } from "react-router-dom";
import AppFooter from "./components/AppFooter";
import CommandPalette from "./components/CommandPalette";
import { MODULE_GROUPS, searchModules } from "./lib/modulesCatalog";
import AssignmentPage from "./pages/AssignmentPage";
import EoqPage from "./pages/EoqPage";
import LpPage from "./pages/LpPage";
import PertCpmPage from "./pages/PertCpmPage";
import {
  AggregatePage,
  AsaPage,
  BreakevenPage,
  DecisionPage,
  DpPage,
  FacilityPage,
  ForecastingPage,
  GamePage,
  GoalPage,
  IlpPage,
  InventoryPage,
  JobsPage,
  MarkovPage,
  MrpPage,
  NetworksPage,
  NlpPage,
  QpPage,
  QssPage,
  QualityPage,
  QueuesPage,
  StatisticsPage,
} from "./pages/PhaseFGPages";
import TransportPage from "./pages/TransportPage";

function TopBar({ onSearch }: { onSearch: () => void }) {
  return (
    <header className="topbar">
      <Link to="/" className="topbar-brand">
        LaraOps
      </Link>
      <div className="topbar-actions">
        <button type="button" className="btn btn-ghost" onClick={onSearch}>
          Buscar <kbd className="topbar-kbd">⌘K</kbd>
        </button>
      </div>
    </header>
  );
}

function Home() {
  const [q, setQ] = useState("");
  const filtered = useMemo(() => searchModules(q), [q]);
  const byGroup = MODULE_GROUPS.map((g) => ({
    group: g,
    modules: filtered.filter((m) => m.group === g),
  })).filter((g) => g.modules.length);

  return (
    <section>
      <div className="home-hero">
        <h1>¿Qué necesitas resolver?</h1>
        <label className="search-field">
          <span aria-hidden>⌕</span>
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Busca un método o describe tu problema… (Vogel, húngaro, Dijkstra, ruta crítica)"
            aria-label="Buscar módulo"
          />
        </label>
      </div>
      {byGroup.map(({ group, modules }) => (
        <div key={group} className="module-group">
          <h2 className="module-group-title">{group}</h2>
          <div className="module-grid">
            {modules.map((m) => (
              <Link key={m.slug} to={m.path} className="module-card">
                <div className="module-card-name">
                  {m.name}
                  <span className="module-card-arrow">→</span>
                </div>
                <p className="module-card-methods">{m.methods}</p>
              </Link>
            ))}
          </div>
        </div>
      ))}
      {!filtered.length && (
        <p style={{ color: "var(--ink-400)" }}>No hay módulos que coincidan con “{q}”.</p>
      )}
    </section>
  );
}

export default function App() {
  const [cmdOpen, setCmdOpen] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCmdOpen(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="app-frame">
      <TopBar onSearch={() => setCmdOpen(true)} />
      <main className="app-main">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/eoq" element={<EoqPage />} />
          <Route path="/lp" element={<LpPage />} />
          <Route path="/ilp" element={<IlpPage />} />
          <Route path="/transport" element={<TransportPage />} />
          <Route path="/assignment" element={<AssignmentPage />} />
          <Route path="/pert-cpm" element={<PertCpmPage />} />
          <Route path="/breakeven" element={<BreakevenPage />} />
          <Route path="/statistics" element={<StatisticsPage />} />
          <Route path="/asa" element={<AsaPage />} />
          <Route path="/queues" element={<QueuesPage />} />
          <Route path="/qss" element={<QssPage />} />
          <Route path="/inventory" element={<InventoryPage />} />
          <Route path="/forecasting" element={<ForecastingPage />} />
          <Route path="/decision" element={<DecisionPage />} />
          <Route path="/game" element={<GamePage />} />
          <Route path="/networks" element={<NetworksPage />} />
          <Route path="/markov" element={<MarkovPage />} />
          <Route path="/quality" element={<QualityPage />} />
          <Route path="/goal" element={<GoalPage />} />
          <Route path="/dp" element={<DpPage />} />
          <Route path="/mrp" element={<MrpPage />} />
          <Route path="/qp" element={<QpPage />} />
          <Route path="/nlp" element={<NlpPage />} />
          <Route path="/jobs" element={<JobsPage />} />
          <Route path="/aggregate" element={<AggregatePage />} />
          <Route path="/facility" element={<FacilityPage />} />
        </Routes>
      </main>
      <AppFooter />
      <CommandPalette open={cmdOpen} onClose={() => setCmdOpen(false)} />
    </div>
  );
}
