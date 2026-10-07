import { useEffect, useState } from "react";
import { Link, Route, Routes, useLocation } from "react-router-dom";
import AppFooter from "./components/AppFooter";
import CommandPalette from "./components/CommandPalette";
import TrackNav from "./components/TrackNav";
import { recordVisit } from "./lib/learning";
import { moduleByPath } from "./lib/modulesCatalog";
import HomePage from "./pages/HomePage";
import AssignmentPage from "./pages/AssignmentPage";
import EoqPage from "./pages/EoqPage";
import LpPage from "./pages/LpPage";
import PertCpmPage from "./pages/PertCpmPage";
import DecisionPage from "./pages/DecisionPage";
import GamePage from "./pages/GamePage";
import MarkovPage from "./pages/MarkovPage";
import MonteCarloPage from "./pages/MonteCarloPage";
import QssPage from "./pages/QssPage";
import QueuesPage from "./pages/QueuesPage";
import {
  AggregatePage,
  AsaPage,
  BreakevenPage,
  DpPage,
  FacilityPage,
  ForecastingPage,
  GoalPage,
  IlpPage,
  InventoryPage,
  JobsPage,
  MrpPage,
  NetworksPage,
  NlpPage,
  QpPage,
  QualityPage,
  StatisticsPage,
} from "./pages/PhaseFGPages";
import TransportPage from "./pages/TransportPage";

const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

function TopBar({ onSearch }: { onSearch: () => void }) {
  return (
    <header className="topbar">
      <Link to="/" className="topbar-brand">
        LaraOps
      </Link>
      <div className="topbar-actions">
        <button type="button" className="btn btn-ghost" onClick={onSearch}>
          Buscar <kbd className="topbar-kbd">{IS_MAC ? "⌘K" : "Ctrl K"}</kbd>
        </button>
      </div>
    </header>
  );
}

export default function App() {
  const [cmdOpen, setCmdOpen] = useState(false);
  const location = useLocation();
  const current = moduleByPath(location.pathname);

  // Cada módulo abierto alimenta «Continúa donde te quedaste» y el avance de las rutas.
  useEffect(() => {
    if (current?.migrated) recordVisit(current.slug);
  }, [current]);

  // Al cambiar de página se empieza arriba, no a media pantalla del módulo anterior.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);

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
          <Route path="/" element={<HomePage />} />
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
          <Route path="/monte-carlo" element={<MonteCarloPage />} />
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
        {current?.migrated ? <TrackNav slug={current.slug} /> : null}
      </main>
      <AppFooter />
      <CommandPalette open={cmdOpen} onClose={() => setCmdOpen(false)} />
    </div>
  );
}
