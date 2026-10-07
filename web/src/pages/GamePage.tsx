import { useMemo, useState } from "react";
import { exportGamePdf, exportGameXlsx, solveGame } from "../api/client";
import GameEditor from "../components/GameEditor";
import GameResults from "../components/GameResults";
import ModuleWorkbench from "../components/ModuleWorkbench";
import {
  GAME_MIXED_EXAMPLE,
  blankGameForm,
  formFromBody,
  validateGameForm,
  type GameBody,
} from "../lib/gameForm";
import type { SheetMatrix } from "../lib/sheetAdapters";

export default function GamePage() {
  const [form, setForm] = useState(blankGameForm);
  const [attempted, setAttempted] = useState(false);
  const report = useMemo(() => validateGameForm(form), [form]);
  const matrix = useMemo<SheetMatrix>(() => [form.rowStrategies, form.colStrategies, ...form.cells], [form]);

  function apply(body: unknown) {
    setForm(formFromBody(body));
    setAttempted(false);
  }

  return (
    <ModuleWorkbench
      group="Predicción y decisión"
      title="Teoría de juegos"
      blurb="Juego de suma cero. El jugador fila cobra el número de la matriz y el jugador columna se lo paga. La fila busca el pago más alto y la columna el más bajo. Si no hay punto de silla, el valor se logra mezclando estrategias."
      matrix={matrix}
      onMatrixChange={() => undefined}
      editor={<GameEditor form={form} report={report} showErrors={attempted} onChange={setForm} />}
      buildBody={() => {
        setAttempted(true);
        if (!report.body) {
          throw new Error("Revisa los pagos y los nombres marcados antes de resolver.");
        }
        return report.body;
      }}
      solve={solveGame}
      exportXlsx={exportGameXlsx}
      exportPdf={exportGamePdf}
      filenameBase="game_result"
      schemaSlug="game"
      onLoadExample={() => apply(GAME_MIXED_EXAMPLE)}
      onImportBody={(body) => apply(body as Partial<GameBody>)}
      mobileFriendly
      renderResult={(result) => <GameResults result={result} />}
    />
  );
}
