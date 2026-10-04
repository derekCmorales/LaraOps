import { useMemo, useState } from "react";
import { exportEoqPdf, exportEoqXlsx, solveEoq } from "../api/client";
import EoqEditor from "../components/EoqEditor";
import ModuleWorkbench from "../components/ModuleWorkbench";
import { blankEoqForm, EOQ_EXAMPLE, formFromBody, validateEoqForm, type EoqBody } from "../lib/eoqForm";
import { eoqToSheet } from "../lib/sheetAdapters";

export default function EoqPage() {
  const [form, setForm] = useState(blankEoqForm);
  const [attempted, setAttempted] = useState(false);
  const report = useMemo(() => validateEoqForm(form), [form]);

  const matrix = useMemo(
    () => eoqToSheet(report.body ?? { D: 0, S: 0, H: 0, C: 0 }),
    [report.body],
  );

  function applyBody(body: Partial<EoqBody>) {
    setForm(formFromBody(body));
    setAttempted(false);
  }

  return (
    <ModuleWorkbench
      group="Inventarios y producción"
      title="EOQ"
      blurb="Cantidad económica de pedido: cuántas unidades pedir cada vez para que el costo de ordenar más el de mantener inventario sea mínimo. Con el tiempo de entrega también obtienes el punto de reorden."
      matrix={matrix}
      onMatrixChange={() => undefined}
      editor={<EoqEditor form={form} report={report} showErrors={attempted} onChange={setForm} />}
      buildBody={() => {
        setAttempted(true);
        if (!report.body) {
          throw new Error("Revisa los campos marcados antes de resolver.");
        }
        return report.body;
      }}
      solve={solveEoq}
      exportXlsx={exportEoqXlsx}
      exportPdf={exportEoqPdf}
      filenameBase="eoq_result"
      onLoadExample={() => applyBody(EOQ_EXAMPLE)}
      onImportBody={(body) => applyBody(body as Partial<EoqBody>)}
      mobileFriendly
    />
  );
}
