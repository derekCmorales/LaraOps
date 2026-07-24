import { useEffect, useRef, useState } from "react";

type Props = {
  onExportXlsx: () => void;
  onExportPdf?: () => void;
  disabled?: boolean;
};

export default function ExportMenu({ onExportXlsx, onExportPdf, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "e") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    }
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  return (
    <div className="export-menu" ref={ref}>
      <button type="button" className="btn btn-ghost" disabled={disabled} onClick={() => setOpen((o) => !o)}>
        Exportar ▾
      </button>
      {open && (
        <div className="export-menu-panel" role="menu">
          <button type="button" role="menuitem" onClick={() => { onExportXlsx(); setOpen(false); }}>
            Exportar a Excel
          </button>
          {onExportPdf && (
            <button type="button" role="menuitem" onClick={() => { onExportPdf(); setOpen(false); }}>
              Exportar a PDF
            </button>
          )}
        </div>
      )}
    </div>
  );
}
