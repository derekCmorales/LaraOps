import { useMemo, useState } from "react";
import { exportQueuesPdf, exportQueuesXlsx, solveQueues } from "../api/client";
import ModuleWorkbench from "../components/ModuleWorkbench";
import QueuesEditor from "../components/QueuesEditor";
import type { SheetMatrix } from "../lib/sheetAdapters";
import {
  blankQueuesForm,
  exampleForm,
  formFromBody,
  validateQueuesForm,
  type QueuesBody,
  type QueuesForm,
} from "../lib/queuesForm";

/** Hoja equivalente al formulario; solo sirve para que el banco de trabajo detecte cambios. */
function formToMatrix(form: QueuesForm): SheetMatrix {
  return [Object.values(form).map((v) => String(v))];
}

export default function QueuesPage() {
  const [form, setForm] = useState<QueuesForm>(() => blankQueuesForm());
  const [attempted, setAttempted] = useState(false);
  const report = useMemo(() => validateQueuesForm(form), [form]);
  const matrix = useMemo(() => formToMatrix(form), [form]);

  function applyForm(next: QueuesForm) {
    setForm(next);
    setAttempted(false);
  }

  return (
    <ModuleWorkbench
      group="Aleatoriedad y espera"
      title="Teoría de colas"
      blurb="Calcula cuánto esperan los clientes, cuántos hay en la fila y qué tan ocupados están los servidores. Elige el modelo que se parece a tu sistema, captura llegadas y servicio (como tasa o como tiempo promedio) y, si quieres, costos para encontrar el número de servidores más barato."
      matrix={matrix}
      onMatrixChange={() => undefined}
      editor={<QueuesEditor form={form} report={report} showErrors={attempted} onChange={setForm} />}
      buildBody={() => {
        setAttempted(true);
        if (!report.body) {
          throw new Error("Revisa los campos marcados antes de resolver.");
        }
        return report.body;
      }}
      solve={solveQueues}
      exportXlsx={exportQueuesXlsx}
      exportPdf={exportQueuesPdf}
      filenameBase="queues_result"
      schemaSlug="queues"
      onLoadExample={() => applyForm(exampleForm(form.model))}
      onImportBody={(body) => applyForm(formFromBody(body as Partial<QueuesBody> & Record<string, unknown>))}
      mobileFriendly
    />
  );
}
