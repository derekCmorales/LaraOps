import { useMemo, useState } from "react";
import { exportAssignmentPdf, exportAssignmentXlsx, solveAssignment } from "../api/client";
import AssignmentEditor from "../components/AssignmentEditor";
import ModuleWorkbench from "../components/ModuleWorkbench";
import {
  ASSIGNMENT_EXAMPLE,
  blankAssignmentForm,
  formFromBody,
  validateAssignmentForm,
  type AssignmentBody,
} from "../lib/assignmentForm";
import type { SheetMatrix } from "../lib/sheetAdapters";

export default function AssignmentPage() {
  const [form, setForm] = useState(() => blankAssignmentForm());
  const [attempted, setAttempted] = useState(false);
  const report = useMemo(() => validateAssignmentForm(form), [form]);

  // Cambia de referencia con cada edición: así el workbench limpia el error anterior.
  const matrix = useMemo<SheetMatrix>(
    () => [[form.sense], form.agents, form.tasks, ...form.cells],
    [form],
  );

  function applyBody(body: Partial<AssignmentBody>) {
    setForm(formFromBody(body));
    setAttempted(false);
  }

  return (
    <ModuleWorkbench
      group="Redes y flujo"
      title="Asignación"
      blurb="Reparte tareas entre agentes (personas, máquinas, vehículos) para que cada uno haga una sola tarea y el costo total sea mínimo, o la ganancia máxima. Se resuelve con el método húngaro, paso a paso."
      matrix={matrix}
      onMatrixChange={() => undefined}
      editor={<AssignmentEditor form={form} report={report} showErrors={attempted} onChange={setForm} />}
      buildBody={() => {
        setAttempted(true);
        if (!report.body) {
          throw new Error("Revisa los datos marcados arriba antes de resolver.");
        }
        return report.body;
      }}
      solve={solveAssignment}
      exportXlsx={exportAssignmentXlsx}
      exportPdf={exportAssignmentPdf}
      filenameBase="assignment_result"
      schemaSlug="assignment"
      onLoadExample={() => applyBody(ASSIGNMENT_EXAMPLE)}
      onImportBody={(body) => applyBody(body as Partial<AssignmentBody>)}
      mobileFriendly
    />
  );
}
