import { useEffect, useState } from "react";
import type { ModuleResult } from "../api/client";
import { schemaHintFor, validateModuleJson } from "../lib/jsonSchemas";

type Props = {
  buildBody: () => unknown;
  onImportBody?: (body: unknown) => void;
  result?: ModuleResult | null;
  schemaSlug?: string;
};

function downloadJson(data: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Editor de modelo en texto JSON (pegar, editar, aplicar). */
export default function JsonModelPanel({ buildBody, onImportBody, result, schemaSlug }: Props) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open && !text) {
      try {
        setText(JSON.stringify(buildBody(), null, 2));
      } catch {
        setText("{}");
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function refreshFromForm() {
    setError(null);
    try {
      setText(JSON.stringify(buildBody(), null, 2));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function applyToForm() {
    if (!onImportBody) return;
    setError(null);
    try {
      const parsed = JSON.parse(text);
      if (schemaSlug) {
        const msg = validateModuleJson(schemaSlug, parsed);
        if (msg) {
          setError(msg);
          return;
        }
      }
      onImportBody(parsed);
    } catch (err) {
      setError(err instanceof Error ? `JSON inválido: ${err.message}` : "JSON inválido");
    }
  }

  async function copyText() {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="json-model-panel" style={{ marginTop: 16 }}>
      <button
        type="button"
        className="btn btn-ghost"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        {open ? "Ocultar modelo JSON" : "Modelo JSON (texto)"}
      </button>
      {open && (
        <div style={{ marginTop: 12 }}>
          <p className="field-hint">
            Edita el JSON del problema, pégalo desde otro archivo o cópialo. Pulsa «Aplicar al formulario» para
            cargar los datos.
            {schemaSlug && schemaHintFor(schemaSlug) ? ` ${schemaHintFor(schemaSlug)}` : ""}
          </p>
          <textarea
            className="json-textarea"
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={12}
            spellCheck={false}
            aria-label="Modelo en JSON"
            style={{
              width: "100%",
              fontFamily: "IBM Plex Mono, monospace",
              fontSize: "0.8125rem",
              padding: 12,
              border: "1px solid var(--ink-200)",
              borderRadius: 3,
              resize: "vertical",
            }}
          />
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
            {onImportBody && (
              <button type="button" className="btn" onClick={applyToForm}>
                Aplicar al formulario
              </button>
            )}
            <button type="button" className="btn btn-ghost" onClick={refreshFromForm}>
              Actualizar desde formulario
            </button>
            <button type="button" className="btn btn-quiet" onClick={() => void copyText()}>
              Copiar
            </button>
            <button
              type="button"
              className="btn btn-quiet"
              onClick={() => {
                try {
                  downloadJson(JSON.parse(text), "modelo.json");
                } catch {
                  downloadJson(buildBody(), "modelo.json");
                }
              }}
            >
              Descargar archivo
            </button>
            {result && (
              <button
                type="button"
                className="btn btn-quiet"
                onClick={() => downloadJson(result, "resultado.json")}
              >
                Descargar resultado
              </button>
            )}
          </div>
          {error && (
            <p className="error-inline" role="alert" style={{ marginTop: 8 }}>
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
