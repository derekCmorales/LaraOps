import { useMemo, useState } from "react";
import { exportMarkovPdf, exportMarkovXlsx, solveMarkov } from "../api/client";
import MarkovEditor from "../components/MarkovEditor";
import MarkovResults from "../components/MarkovResults";
import ModuleWorkbench from "../components/ModuleWorkbench";
import { blankMarkovForm, formFromBody, loadExample, validateMarkovForm, type MarkovForm } from "../lib/markovForm";
import type { SheetMatrix } from "../lib/sheetAdapters";

function formToMatrix(form: MarkovForm): SheetMatrix {
  return [[form.mode, form.example, JSON.stringify(form.chain), JSON.stringify(form.mdp)]];
}

export default function MarkovPage() {
  const [form, setForm] = useState<MarkovForm>(() => blankMarkovForm());
  const [attempted, setAttempted] = useState(false);
  const report = useMemo(() => validateMarkovForm(form), [form]);
  const matrix = useMemo(() => formToMatrix(form), [form]);

  function apply(next: MarkovForm) {
    setForm(next);
    setAttempted(false);
  }

  return (
    <ModuleWorkbench
      group="Aleatoriedad y espera"
      title="Cadenas de Markov"
      blurb="Una cadena de Markov salta de estado en estado con probabilidades fijas. Aquí ves a qué clase pertenece cada estado, la distribución de largo plazo y, si hay estados que se abandonan, la probabilidad de terminar en cada clase. En el modo de decisión eliges una acción por estado y el programa busca la política de menor costo o mayor recompensa."
      matrix={matrix}
      onMatrixChange={() => undefined}
      editor={
        <MarkovEditor
          form={form}
          report={report}
          showErrors={attempted}
          onChange={setForm}
          onLoadExample={() => apply(loadExample(form, form.example))}
        />
      }
      buildBody={() => {
        setAttempted(true);
        if (!report.body) {
          throw new Error("Revisa los campos marcados antes de resolver.");
        }
        return report.body;
      }}
      solve={solveMarkov}
      exportXlsx={exportMarkovXlsx}
      exportPdf={exportMarkovPdf}
      filenameBase="markov_result"
      schemaSlug="markov"
      onLoadExample={() => apply(loadExample(form, form.example))}
      onImportBody={(body) => apply(formFromBody(body, form))}
      mobileFriendly
      renderResult={(result) => <MarkovResults result={result} />}
    />
  );
}
