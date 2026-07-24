import { useCallback, useMemo, useRef } from "react";
import { AgGridReact } from "ag-grid-react";
import {
  AllCommunityModule,
  ColDef,
  ModuleRegistry,
  CellValueChangedEvent,
  ProcessDataFromClipboardParams,
} from "ag-grid-community";
import "ag-grid-community/styles/ag-grid.css";
import "ag-grid-community/styles/ag-theme-quartz.css";
import type { Cell, SheetMatrix } from "../lib/sheetAdapters";

ModuleRegistry.registerModules([AllCommunityModule]);

export type SheetEditorKind = "generic" | "lp";

type Props = {
  matrix: SheetMatrix;
  onChange: (next: SheetMatrix) => void;
  height?: number;
  kind?: SheetEditorKind;
};

type RowData = Record<string, Cell> & { __rid: number };

const LOCALE_ES = {
  noRowsToShow: "Sin filas",
  loadingOoo: "Cargando…",
  copy: "Copiar",
  paste: "Pegar",
  cut: "Cortar",
  copyWithHeaders: "Copiar con encabezados",
};

function isSemanticHeaderRow(row: Cell[]): boolean {
  return row.some((c) => typeof c === "string" && String(c).trim().length > 0);
}

function matrixToRows(
  matrix: SheetMatrix,
  kind: SheetEditorKind
): {
  cols: ColDef[];
  rows: RowData[];
  headerRow: Cell[] | null;
} {
  const width = Math.max(1, ...matrix.map((r) => r.length));
  const headerRow = matrix[0] ?? [];
  const useSemanticHeaders = kind !== "lp" && isSemanticHeaderRow(headerRow);
  const dataMatrix =
    kind === "lp" && isSemanticHeaderRow(headerRow) ? matrix : useSemanticHeaders ? matrix.slice(1) : matrix;
  const senseCol = kind === "lp" && isSemanticHeaderRow(headerRow) ? width - 2 : -1;
  const labelCol = kind === "lp" ? 0 : -1;
  const objectiveRowIndex = kind === "lp" ? 1 : 0;
  const lpSemantic = kind === "lp" && isSemanticHeaderRow(headerRow);

  const cols: ColDef[] = Array.from({ length: width }, (_, i) => {
    const def: ColDef = {
      field: `c${i}`,
      headerName: lpSemantic ? colLabel(i) : useSemanticHeaders && headerRow[i] != null && headerRow[i] !== ""
          ? String(headerRow[i])
          : colLabel(i),
      editable: true,
      resizable: true,
      minWidth: 96,
      flex: 1,
    };

    if (kind === "lp" && i === labelCol) {
      def.cellClass = "col-text sheet-label-col";
      def.editable = (params) => params.node?.rowIndex !== objectiveRowIndex;
      def.valueGetter = (params) => {
        const ri = params.node?.rowIndex ?? -1;
        if (ri === objectiveRowIndex) return "Objetivo (Z)";
        if (ri === 0 && lpSemantic) return params.data?.[`c${i}`] ?? "Fila";
        return params.data?.[`c${i}`] ?? "";
      };
      def.valueSetter = (params) => {
        if (params.node?.rowIndex === objectiveRowIndex) return false;
        if (params.data) params.data[`c${i}`] = params.newValue;
        return true;
      };
    }

    if (kind === "lp" && lpSemantic && i > 0 && i < width - 2) {
      def.cellClass = "sheet-varname-col";
      def.editable = (params) => params.node?.rowIndex === 0;
    }

    if (kind === "lp" && i === senseCol) {
      def.cellClass = "sheet-sense-col";
      def.cellEditor = "agSelectCellEditor";
      def.cellEditorParams = (params: { node?: { rowIndex?: number } }) => ({
        values:
          params.node?.rowIndex === objectiveRowIndex
            ? ["Máx", "Mín"]
            : ["≤", "≥", "="],
      });
    }

    if (kind === "lp" && i > 0 && i < width - 2) {
      def.cellClass = "sheet-num-col";
    }

    return def;
  });

  const rows: RowData[] = dataMatrix.map((r, idx) => {
    const row: RowData = { __rid: idx };
    for (let i = 0; i < width; i++) {
      if (kind === "lp" && idx === objectiveRowIndex && i === labelCol) {
        row[`c${i}`] = "Objetivo (Z)";
      } else {
        row[`c${i}`] = r[i] ?? "";
      }
    }
    return row;
  });
  return { cols, rows, headerRow: lpSemantic ? null : useSemanticHeaders ? headerRow : null };
}

function rowsToMatrix(
  rows: RowData[],
  colCount: number,
  headerRow: Cell[] | null,
  kind: SheetEditorKind
): SheetMatrix {
  const data = rows.map((row, ri) => {
    const out: Cell[] = [];
    for (let i = 0; i < colCount; i++) {
      if (kind === "lp" && ri === 1 && i === 0) {
        out.push("Objetivo (Z)");
      } else {
        const v = row[`c${i}`];
        out.push(v === undefined || v === "" ? "" : v);
      }
    }
    return out;
  });
  return headerRow ? [headerRow, ...data] : data;
}

function colLabel(i: number): string {
  let n = i;
  let s = "";
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

export default function SpreadsheetEditor({ matrix, onChange, height = 280, kind = "generic" }: Props) {
  const gridRef = useRef<AgGridReact<RowData>>(null);
  const { cols, rows, headerRow } = useMemo(() => matrixToRows(matrix, kind), [matrix, kind]);
  const colCount = cols.length;

  const syncFromGrid = useCallback(() => {
    const api = gridRef.current?.api;
    if (!api) return;
    const next: RowData[] = [];
    api.forEachNode((node) => {
      if (node.data) next.push(node.data);
    });
    onChange(rowsToMatrix(next, colCount, headerRow, kind));
  }, [colCount, headerRow, kind, onChange]);

  const onCellValueChanged = useCallback(
    (_e: CellValueChangedEvent<RowData>) => {
      syncFromGrid();
    },
    [syncFromGrid]
  );

  function addRow() {
    const blank: Cell[] = Array.from({ length: colCount }, () => "");
    onChange([...matrix, blank]);
  }

  function addColumn() {
    if (kind === "lp" && matrix.length > 0 && matrix[0].length >= 3) {
      const varCount = matrix[0].length - 3;
      const newName = `x${varCount + 1}`;
      onChange(
        matrix.map((r, ri) => {
          const before = r.slice(0, -2);
          const tail = r.slice(-2);
          if (ri === 0) return [...before, newName, ...tail];
          return [...before, 0, ...tail];
        })
      );
      return;
    }
    onChange(matrix.map((r) => [...r, ""]));
  }

  function removeLastColumn() {
    if (kind === "lp") {
      if (colCount <= 5) return;
      onChange(matrix.map((r) => [...r.slice(0, -3), ...r.slice(-2)]));
      return;
    }
    if (colCount <= 2) return;
    onChange(matrix.map((r) => r.slice(0, -1)));
  }

  function removeLastRow() {
    const minRows = kind === "lp" ? 3 : headerRow ? 2 : 1;
    if (matrix.length <= minRows) return;
    onChange(matrix.slice(0, -1));
  }

  const processDataFromClipboard = useCallback(
    (params: ProcessDataFromClipboardParams): string[][] | null => {
      const data = params.data;
      if (!data?.length) return null;
      // Expandir matriz si el pegado es más grande
      const api = gridRef.current?.api;
      const start = api?.getFocusedCell();
      const startRow = start?.rowIndex ?? 0;
      const startCol = start?.column ? cols.findIndex((c) => c.field === start.column.getColId()) : 0;
      const needRows = startRow + data.length;
      const needCols = startCol + Math.max(...data.map((r) => r.length));
      let next = matrix.map((r) => [...r]);
      while (next.length < needRows) {
        next.push(Array.from({ length: Math.max(colCount, needCols) }, () => "" as Cell));
      }
      next = next.map((r) => {
        const copy = [...r];
        while (copy.length < needCols) copy.push("");
        return copy;
      });
      data.forEach((row, ri) => {
        row.forEach((cell, ci) => {
          const r = startRow + ri;
          const c = startCol + ci;
          if (next[r]) next[r][c] = cell;
        });
      });
      onChange(next);
      return null; // ya aplicamos nosotros
    },
    [cols, colCount, matrix, onChange]
  );

  return (
    <div className="sheet-wrap">
      <div className="sheet-toolbar">
        <button type="button" className="btn btn-quiet" onClick={addRow} aria-label="Agregar fila">
          + Fila
        </button>
        <button type="button" className="btn btn-quiet" onClick={addColumn} aria-label="Agregar columna">
          + Columna
        </button>
        <button
          type="button"
          className="btn btn-quiet"
          onClick={removeLastRow}
          aria-label="Quitar última fila"
          disabled={matrix.length <= (headerRow ? 2 : 1)}
        >
          − Fila
        </button>
        <button
          type="button"
          className="btn btn-quiet"
          onClick={removeLastColumn}
          aria-label="Quitar última columna"
          disabled={colCount <= 2}
        >
          − Columna
        </button>
        <span className="field-hint sheet-hint">
          Clic para editar · Tab / Enter para navegar · Ctrl+V pega desde Excel
        </span>
      </div>
      <div
        className="ag-theme-quartz sheet-grid"
        style={{ height, width: "100%" }}
        role="grid"
        aria-label="Hoja de datos del modelo"
      >
        <AgGridReact<RowData>
          ref={gridRef}
          rowData={rows}
          columnDefs={cols}
          getRowId={(p) => String(p.data.__rid)}
          onCellValueChanged={onCellValueChanged}
          processDataFromClipboard={processDataFromClipboard}
          localeText={LOCALE_ES}
          singleClickEdit
          stopEditingWhenCellsLoseFocus
          animateRows={false}
          headerHeight={34}
          rowHeight={36}
          defaultColDef={{ sortable: false, filter: false, suppressHeaderMenuButton: true }}
          ensureDomOrder
        />
      </div>
    </div>
  );
}
