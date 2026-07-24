import { useState } from "react";
import { exportAssignmentPdf, exportAssignmentXlsx, solveAssignment } from "../api/client";
import ModuleWorkbench from "../components/ModuleWorkbench";
import {
  assignmentToSheet,
  emptyAssignmentSheet,
  sheetToAssignment,
  type AssignmentBody,
  type SheetMatrix,
} from "../lib/sheetAdapters";

const EXAMPLE: AssignmentBody = {
  agents: ["A", "B", "C"],
  tasks: ["X", "Y", "Z"],
  costs: [
    [9, 2, 7],
    [6, 4, 3],
    [5, 8, 1],
  ],
  sense: "min",
};

export default function AssignmentPage() {
  const [matrix, setMatrix] = useState<SheetMatrix>(() => emptyAssignmentSheet());

  return (
    <ModuleWorkbench
      group="Redes y flujo"
      title="Asignación"
      blurb="Matriz: filas = agentes, columnas = tareas. En la primera fila define Sentido (Min/Max). Método húngaro."
      matrix={matrix}
      onMatrixChange={setMatrix}
      buildBody={() => sheetToAssignment(matrix)}
      solve={solveAssignment}
      exportXlsx={exportAssignmentXlsx}
      exportPdf={exportAssignmentPdf}
      filenameBase="assignment_result"
      schemaSlug="assignment"
      sheetHeight={300}
      onLoadExample={() => setMatrix(assignmentToSheet(EXAMPLE))}
      onImportBody={(body) => setMatrix(assignmentToSheet(body as AssignmentBody))}
    />
  );
}
