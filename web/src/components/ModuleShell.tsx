import { Link } from "react-router-dom";
import type { ReactNode } from "react";

type Props = {
  group: string;
  title: string;
  tab: "datos" | "resultados";
  onTabChange: (tab: "datos" | "resultados") => void;
  resultsEnabled: boolean;
  headerRight?: ReactNode;
  actionBar?: ReactNode;
  children: ReactNode;
};

export default function ModuleShell({
  group,
  title,
  tab,
  onTabChange,
  resultsEnabled,
  headerRight,
  actionBar,
  children,
}: Props) {
  return (
    <div className="module-shell">
      <nav className="breadcrumb" aria-label="Miga de pan">
        <Link to="/">LaraOps</Link>
        <span>/</span>
        <span>{group}</span>
        <span>/</span>
        <strong>{title}</strong>
        <span style={{ flex: 1 }} />
        {headerRight}
      </nav>

      <div className="shell-tabs" role="tablist" aria-label="Datos o resultados">
        <button
          type="button"
          className="shell-tab"
          role="tab"
          aria-selected={tab === "datos"}
          onClick={() => onTabChange("datos")}
        >
          Datos
        </button>
        <button
          type="button"
          className="shell-tab"
          role="tab"
          aria-selected={tab === "resultados"}
          disabled={!resultsEnabled && tab !== "resultados"}
          onClick={() => resultsEnabled && onTabChange("resultados")}
        >
          Resultados
        </button>
      </div>

      <p className="mobile-notice">
        La captura de modelos funciona mejor en pantalla grande. Puedes ver y exportar resultados desde
        aquí.
      </p>

      {children}
      {tab === "datos" && actionBar ? <div className="shell-actionbar">{actionBar}</div> : null}
    </div>
  );
}
