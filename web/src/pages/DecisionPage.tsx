import { useMemo, useState } from "react";
import { exportDecisionPdf, exportDecisionXlsx, solveDecision } from "../api/client";
import DecisionEditor from "../components/DecisionEditor";
import DecisionResults from "../components/DecisionResults";
import ModuleWorkbench from "../components/ModuleWorkbench";
import {
  blankDecisionForm,
  exampleDecision,
  formFromBody,
  validateDecisionForm,
  type DecisionForm,
} from "../lib/decisionForm";
import type { SheetMatrix } from "../lib/sheetAdapters";

function formToMatrix(form: DecisionForm): SheetMatrix {
  return [[JSON.stringify(form)]];
}

export default function DecisionPage() {
  const [form, setForm] = useState<DecisionForm>(() => blankDecisionForm());
  const [attempted, setAttempted] = useState(false);
  const report = useMemo(() => validateDecisionForm(form), [form]);
  const matrix = useMemo(() => formToMatrix(form), [form]);

  function apply(next: DecisionForm) {
    setForm(next);
    setAttempted(false);
  }

  const exampleKind =
    form.mode === "bayes" ? "bayes" : form.mode === "decision_tree" ? "tree" : form.mode === "utility" ? "utility" : "payoff";

  return (
    <ModuleWorkbench
      group="Predicción y decisión"
      title="Análisis de decisiones"
      blurb="Compara alternativas cuando no sabes qué va a pasar. Usa una tabla de pagos, transforma los pagos a utilidad, dibuja un árbol o calcula si conviene pagar por una muestra. Puedes cargar el ejemplo de la tabla o el de Bayes."
      matrix={matrix}
      onMatrixChange={() => undefined}
      editor={<DecisionEditor form={form} report={report} showErrors={attempted} onChange={setForm} />}
      buildBody={() => {
        setAttempted(true);
        if (!report.body) {
          throw new Error(report.errors[0] ?? "Revisa los campos marcados antes de resolver.");
        }
        return report.body;
      }}
      solve={solveDecision}
      exportXlsx={exportDecisionXlsx}
      exportPdf={exportDecisionPdf}
      filenameBase="decision"
      schemaSlug="decision"
      onLoadExample={() => apply(exampleDecision(exampleKind))}
      onImportBody={(body) => apply(formFromBody(body))}
      mobileFriendly
      renderResult={(result) => <DecisionResults result={result} />}
    />
  );
}
