import { useState } from "react";
import { exportTransportPdf, exportTransportXlsx, solveTransport } from "../api/client";
import ModuleWorkbench from "../components/ModuleWorkbench";
import SelectDropdown from "../components/SelectDropdown";
import {
  emptyTransportSheet,
  sheetToTransport,
  transportToSheet,
  type SheetMatrix,
  type TransportBody,
} from "../lib/sheetAdapters";

const EXAMPLE: TransportBody = {
  supply: { A: 20, B: 30 },
  demand: { X: 10, Y: 40 },
  costs: { A: { X: 2, Y: 3 }, B: { X: 4, Y: 1 } },
  method: "modi_auto",
};

export default function TransportPage() {
  const [matrix, setMatrix] = useState<SheetMatrix>(() => emptyTransportSheet());
  const [method, setMethod] = useState("modi_auto");

  return (
    <ModuleWorkbench
      group="Redes y flujo"
      title="Transporte"
      blurb="Matriz de costos: filas = orígenes, columnas = destinos. Última columna = Oferta, última fila = Demanda."
      matrix={matrix}
      onMatrixChange={setMatrix}
      buildBody={() => sheetToTransport(matrix, method)}
      solve={solveTransport}
      exportXlsx={exportTransportXlsx}
      exportPdf={exportTransportPdf}
      filenameBase="transport_result"
      sheetHeight={280}
      onLoadExample={() => {
        setMatrix(transportToSheet(EXAMPLE));
        setMethod(EXAMPLE.method);
      }}
      onImportBody={(body) => {
        const b = body as TransportBody;
        setMatrix(transportToSheet(b));
        if (b.method) setMethod(b.method);
      }}
      toolbar={
        <div className="config-panel" style={{ marginBottom: 12, maxWidth: 320 }}>
          <div className="field">
            <label>Método</label>
            <SelectDropdown
              value={method}
              onChange={setMethod}
              aria-label="Método"
              options={[
                { value: "modi_auto", label: "Vogel + MODI" },
                { value: "vogel", label: "Vogel" },
                { value: "least_cost", label: "Costo mínimo" },
                { value: "northwest", label: "Esquina noroeste" },
              ]}
            />
          </div>
        </div>
      }
    />
  );
}
