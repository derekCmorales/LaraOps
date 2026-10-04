import { useMemo, useState } from "react";
import { exportTransportPdf, exportTransportXlsx, solveTransport } from "../api/client";
import ModuleWorkbench from "../components/ModuleWorkbench";
import TransportEditor from "../components/TransportEditor";
import type { SheetMatrix } from "../lib/sheetAdapters";
import {
  blankTransportForm,
  formFromBody,
  TRANSPORT_EXAMPLE,
  validateTransportForm,
  type TransportBody,
  type TransportForm,
} from "../lib/transportForm";

/** Hoja equivalente al formulario; solo sirve para que el banco de trabajo detecte cambios. */
function formToMatrix(form: TransportForm): SheetMatrix {
  return [
    ["Origen", ...form.dests, "Oferta", form.method, form.objective],
    ...form.sources.map((name, r) => [name, ...form.costs[r], form.supply[r]]),
    ["Demanda", ...form.demand, ""],
  ];
}

export default function TransportPage() {
  const [form, setForm] = useState<TransportForm>(() => blankTransportForm());
  const [attempted, setAttempted] = useState(false);
  const report = useMemo(() => validateTransportForm(form), [form]);
  const matrix = useMemo(() => formToMatrix(form), [form]);

  function applyBody(body: Partial<TransportBody> & Record<string, unknown>) {
    setForm(formFromBody(body));
    setAttempted(false);
  }

  return (
    <ModuleWorkbench
      group="Redes y flujo"
      title="Transporte"
      blurb="Decide cuántas unidades enviar desde cada origen (plantas, almacenes) a cada destino (clientes, tiendas) para cubrir la demanda con el menor costo total, sin rebasar la oferta de nadie."
      matrix={matrix}
      onMatrixChange={() => undefined}
      editor={<TransportEditor form={form} report={report} showErrors={attempted} onChange={setForm} />}
      buildBody={() => {
        setAttempted(true);
        if (!report.body) {
          throw new Error("Revisa las celdas marcadas en rojo antes de resolver.");
        }
        return report.body;
      }}
      solve={solveTransport}
      exportXlsx={exportTransportXlsx}
      exportPdf={exportTransportPdf}
      filenameBase="transport_result"
      onLoadExample={() => applyBody(TRANSPORT_EXAMPLE)}
      onImportBody={(body) => applyBody(body as Partial<TransportBody> & Record<string, unknown>)}
      mobileFriendly
    />
  );
}
