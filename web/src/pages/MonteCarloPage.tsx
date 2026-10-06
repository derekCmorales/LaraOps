import { useMemo, useState } from "react";
import { exportMonteCarloPdf, exportMonteCarloXlsx, solveMonteCarlo } from "../api/client";
import MonteCarloEditor from "../components/MonteCarloEditor";
import MonteCarloResults from "../components/MonteCarloResults";
import ModuleWorkbench from "../components/ModuleWorkbench";
import {
  blankMonteCarloForm,
  exampleForm,
  formFromBody,
  validateMonteCarloForm,
  type McForm,
} from "../lib/monteCarloForm";
import type { SheetMatrix } from "../lib/sheetAdapters";

function formToMatrix(form: McForm): SheetMatrix {
  return [[JSON.stringify(form)]];
}

export default function MonteCarloPage() {
  const [form, setForm] = useState<McForm>(() => blankMonteCarloForm());
  const [attempted, setAttempted] = useState(false);
  const report = useMemo(() => validateMonteCarloForm(form), [form]);
  const matrix = useMemo(() => formToMatrix(form), [form]);

  function replaceForm(next: McForm) {
    setForm(next);
    setAttempted(false);
  }

  return (
    <ModuleWorkbench
      group="Aleatoriedad y espera"
      title="Simulación Monte Carlo"
      blurb="Genera números aleatorios con semilla, muestrea variables y estima el resultado de una fórmula con muchas réplicas. La misma semilla repite el experimento. Al final ves la media, un intervalo del 95% y la forma de la distribución."
      matrix={matrix}
      onMatrixChange={() => undefined}
      editor={
        <MonteCarloEditor
          form={form}
          report={report}
          showErrors={attempted}
          onChange={setForm}
          onReplace={replaceForm}
        />
      }
      buildBody={() => {
        setAttempted(true);
        if (!report.body) throw new Error("Revisa los campos marcados antes de resolver.");
        return report.body;
      }}
      solve={solveMonteCarlo}
      exportXlsx={exportMonteCarloXlsx}
      exportPdf={exportMonteCarloPdf}
      filenameBase="monte_carlo_result"
      schemaSlug="monte_carlo"
      onLoadExample={() => replaceForm(exampleForm(form.mode))}
      onImportBody={(body) => replaceForm(formFromBody(body))}
      renderResult={(result) => <MonteCarloResults result={result} />}
      mobileFriendly
    />
  );
}
