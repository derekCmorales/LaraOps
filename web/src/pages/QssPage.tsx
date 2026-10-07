import { useMemo, useState } from "react";
import { exportQssPdf, exportQssXlsx, solveQss } from "../api/client";
import ModuleWorkbench from "../components/ModuleWorkbench";
import QssEditor from "../components/QssEditor";
import QssResults from "../components/QssResults";
import { blankQssForm, exampleQssForm, formFromBody, validateQssForm, type QssForm } from "../lib/qssForm";
import type { SheetMatrix } from "../lib/sheetAdapters";

function formToMatrix(form: QssForm): SheetMatrix {
  return [[JSON.stringify(form)]];
}

export default function QssPage() {
  const [form, setForm] = useState<QssForm>(() => blankQssForm());
  const [attempted, setAttempted] = useState(false);
  const report = useMemo(() => validateQssForm(form), [form]);
  const matrix = useMemo(() => formToMatrix(form), [form]);

  function applyForm(next: QssForm) {
    setForm(next);
    setAttempted(false);
  }

  return (
    <ModuleWorkbench
      group="Aleatoriedad y espera"
      title="Simulación de colas"
      blurb="Simula una fila M/M/s evento por evento: llegadas y servicios exponenciales, uno o varios servidores y, si quieres, un cupo. Obtienes L, Lq, W, Wq y la utilización de una sola réplica."
      matrix={matrix}
      onMatrixChange={() => undefined}
      editor={<QssEditor form={form} report={report} showErrors={attempted} onChange={setForm} />}
      buildBody={() => {
        setAttempted(true);
        if (!report.body) throw new Error("Revisa los campos marcados antes de resolver.");
        return report.body;
      }}
      solve={solveQss}
      exportXlsx={exportQssXlsx}
      exportPdf={exportQssPdf}
      filenameBase="qss_result"
      schemaSlug="qss"
      onLoadExample={() => applyForm(exampleQssForm())}
      onImportBody={(body) => applyForm(formFromBody(body))}
      renderResult={(result) => <QssResults result={result} />}
      mobileFriendly
    />
  );
}
