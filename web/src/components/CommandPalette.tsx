import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { searchModules } from "../lib/modulesCatalog";

type Props = {
  open: boolean;
  onClose: () => void;
  initialQuery?: string;
};

export default function CommandPalette({ open, onClose, initialQuery = "" }: Props) {
  const [q, setQ] = useState(initialQuery);
  const [active, setActive] = useState(0);
  const navigate = useNavigate();
  const results = useMemo(() => searchModules(q).slice(0, 12), [q]);

  useEffect(() => {
    if (open) {
      setQ(initialQuery);
      setActive(0);
    }
  }, [open, initialQuery]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive((i) => Math.min(results.length - 1, i + 1));
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive((i) => Math.max(0, i - 1));
      }
      if (e.key === "Enter" && results[active]) {
        navigate(results[active].path);
        onClose();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, results, active, navigate, onClose]);

  if (!open) return null;

  return (
    <div className="cmdk-backdrop" role="dialog" aria-modal="true" aria-label="Buscar módulo">
      <div className="cmdk">
        <input
          autoFocus
          placeholder="Busca un método o describe tu problema…"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setActive(0);
          }}
        />
        <div className="cmdk-list">
          {results.map((m, i) => (
            <button
              key={m.slug}
              type="button"
              className="cmdk-item"
              data-active={i === active}
              onMouseEnter={() => setActive(i)}
              onClick={() => {
                navigate(m.path);
                onClose();
              }}
            >
              <strong>{m.name}</strong>
              <span>
                {m.group} · {m.methods}
              </span>
            </button>
          ))}
          {!results.length && <p style={{ padding: 12, color: "var(--ink-400)" }}>Sin coincidencias.</p>}
        </div>
      </div>
    </div>
  );
}
