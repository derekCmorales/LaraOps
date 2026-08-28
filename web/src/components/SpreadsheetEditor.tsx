import { useCallback, useMemo, useRef } from "react";
import { AgGridReact } from "ag-grid-react";
import {
  AllCommunityModule,
  ColDef,
  ModuleRegistry,
  CellValueChangedEvent,
  CellEditingStoppedEvent,
  ProcessDataFromClipboardParams,
  SuppressKeyboardEventParams,
  ValueParserParams,
} from "ag-grid-community";
import "ag-grid-community/styles/ag-grid.css";
import "ag-grid-community/styles/ag-theme-quartz.css";
import type { Cell, SheetMatrix } from "../lib/sheetAdapters";
import {
  blankLpConstraintRow,
  classifyLpCell,
  coerceLpValue,
  matchSenseInput,
  senseChoicesForRow,
} from "../lib/lpSheetNav";
import { SenseCellEditor, SenseCellRenderer } from "./SensePicker";

ModuleRegistry.registerModules([AllCommunityModule]);

export type SheetEditorKind = "generic" | "lp";

type Props = {
  matrix: SheetMatrix;
  onChange: (next: SheetMatrix | ((prev: SheetMatrix) => SheetMatrix)) => void;
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
  const rhsCol = kind === "lp" ? width - 1 : -1;
  const labelCol = kind === "lp" ? 0 : -1;
  const objectiveRowIndex = kind === "lp" ? 1 : 0;
  const lpSemantic = kind === "lp" && isSemanticHeaderRow(headerRow);

  const cols: ColDef[] = Array.from({ length: width }, (_, i) => {
    const def: ColDef = {
      field: `c${i}`,
      headerName:
        lpSemantic && headerRow[i] != null && String(headerRow[i]).trim() !== ""
          ? String(headerRow[i])
          : useSemanticHeaders && headerRow[i] != null && headerRow[i] !== ""
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
        if (params.data) {
          const ri = params.node?.rowIndex ?? -1;
          params.data[`c${i}`] = coerceLpValue(classifyLpCell(ri, i, width), params.newValue, i, ri);
        }
        return true;
      };
    }

    if (kind === "lp" && i > 0 && i < width - 2) {
      def.cellDataType = "text";
      def.cellEditor = "agTextCellEditor";
      def.cellClassRules = {
        "sheet-varname-col": (params) => lpSemantic && params.node?.rowIndex === 0,
        "sheet-num-col": (params) => !lpSemantic || params.node?.rowIndex !== 0,
      };
      def.valueParser = (params: ValueParserParams) => {
        const ri = params.node?.rowIndex ?? -1;
        return coerceLpValue(classifyLpCell(ri, i, width), params.newValue, i, ri);
      };
    }

    if (kind === "lp" && i === rhsCol) {
      def.cellDataType = "text";
      def.cellEditor = "agTextCellEditor";
      def.cellClass = "sheet-num-col";
      def.editable = (params) => {
        const ri = params.node?.rowIndex ?? -1;
        return ri !== 0 && ri !== objectiveRowIndex;
      };
      def.valueParser = (params: ValueParserParams) => {
        const ri = params.node?.rowIndex ?? -1;
        return coerceLpValue(classifyLpCell(ri, i, width), params.newValue, i, ri);
      };
    }

    if (kind === "lp" && i === senseCol) {
      def.minWidth = 156;
      def.maxWidth = 220;
      def.flex = 0.7;
      def.cellClass = "sheet-sense-col";
      def.editable = (params) => (params.node?.rowIndex ?? -1) > 0;
      def.cellRenderer = SenseCellRenderer;
      def.cellEditor = SenseCellEditor;
      def.cellEditorPopup = true;
      def.cellEditorPopupPosition = "under";
      def.suppressKeyboardEvent = suppressSenseKeys;
      def.valueParser = (params: ValueParserParams) => {
        const ri = params.node?.rowIndex ?? -1;
        return coerceLpValue(classifyLpCell(ri, i, width), params.newValue, i, ri);
      };
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

function suppressSenseKeys(params: SuppressKeyboardEventParams): boolean {
  if (params.editing) return false;
  const key = params.event.key;
  if (key === "Tab" || key === "Enter" || key === "F2" || key === "Escape") return false;
  const ri = params.node?.rowIndex ?? -1;
  if (ri <= 0) return false;
  const isObjective = ri === 1;
  const choices = senseChoicesForRow(ri);
  if (key === "Delete" || key === "Backspace") {
    params.node.setDataValue(params.column, choices[0]?.value ?? "≤");
    params.event.preventDefault();
    params.event.stopPropagation();
    return true;
  }
  const matched = matchSenseInput(key, isObjective);
  if (!matched) return false;
  params.node.setDataValue(params.column, matched);
  params.event.preventDefault();
  params.event.stopPropagation();
  return true;
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

function patchMatrixCell(
  matrix: SheetMatrix,
  rowIndex: number,
  colIndex: number,
  value: unknown,
  kind: SheetEditorKind
): SheetMatrix {
  const next = matrix.map((row) => [...row]);
  const row = next[rowIndex];
  if (!row) return matrix;
  while (row.length <= colIndex) row.push("");
  if (kind === "lp" && rowIndex === 1 && colIndex === 0) {
    row[0] = "Objetivo (Z)";
  } else {
    row[colIndex] = value === undefined || value === null ? "" : (value as Cell);
  }
  return next;
}

function colIndexFromField(field: string): number | null {
  const match = /^c(\d+)$/.exec(field);
  return match ? Number(match[1]) : null;
}

export default function SpreadsheetEditor({ matrix, onChange, height = 280, kind = "generic" }: Props) {
  const gridRef = useRef<AgGridReact<RowData>>(null);
  const { cols, rows, headerRow } = useMemo(() => matrixToRows(matrix, kind), [matrix, kind]);
  const colCount = cols.length;
  const minRows = kind === "lp" ? 3 : headerRow ? 2 : 1;
  const minCols = kind === "lp" ? 5 : 2;

  const syncFromGrid = useCallback(() => {
    const api = gridRef.current?.api;
    if (!api) return;
    const next: RowData[] = [];
    api.forEachNode((node) => {
      if (node.data) next.push(node.data);
    });
    onChange(rowsToMatrix(next, colCount, headerRow, kind));
  }, [colCount, headerRow, kind, onChange]);

  const commitLpCell = useCallback(
    (rowIndex: number, colIndex: number, value: unknown) => {
      onChange((prev) => patchMatrixCell(prev, rowIndex, colIndex, value, kind));
    },
    [kind, onChange]
  );

  const onCellValueChanged = useCallback(
    (e: CellValueChangedEvent<RowData>) => {
      if (kind === "lp") {
        const ri = e.node.rowIndex ?? -1;
        const ci = colIndexFromField(e.column.getColId());
        if (ri >= 0 && ci != null) {
          commitLpCell(ri, ci, e.newValue);
          return;
        }
      }
      syncFromGrid();
    },
    [kind, commitLpCell, syncFromGrid]
  );

  const onCellEditingStopped = useCallback(
    (e: CellEditingStoppedEvent<RowData>) => {
      if (kind !== "lp" || !e.valueChanged) return;
      const ri = e.node.rowIndex ?? -1;
      const ci = colIndexFromField(e.column.getColId());
      if (ri < 0 || ci == null) return;
      commitLpCell(ri, ci, e.newValue);
    },
    [kind, commitLpCell]
  );

  function addRow() {
    if (kind === "lp") {
      const constraintNumber = Math.max(1, matrix.length - 1);
      onChange([...matrix, blankLpConstraintRow(colCount, constraintNumber)]);
      return;
    }
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
      if (colCount <= minCols) return;
      onChange(matrix.map((r) => [...r.slice(0, -3), ...r.slice(-2)]));
      return;
    }
    if (colCount <= minCols) return;
    onChange(matrix.map((r) => r.slice(0, -1)));
  }

  function removeLastRow() {
    if (matrix.length <= minRows) return;
    onChange(matrix.slice(0, -1));
  }

  const processDataFromClipboard = useCallback(
    (params: ProcessDataFromClipboardParams): string[][] | null => {
      const data = params.data;
      if (!data?.length) return null;
      const api = gridRef.current?.api;
      const start = api?.getFocusedCell();
      const startRow = start?.rowIndex ?? 0;
      const startCol = start?.column ? cols.findIndex((c) => c.field === start.column.getColId()) : 0;
      const needRows = startRow + data.length;
      const needCols = startCol + Math.max(...data.map((r) => r.length));
      let next = matrix.map((r) => [...r]);
      while (next.length < needRows) {
        if (kind === "lp") {
          next.push(blankLpConstraintRow(Math.max(colCount, needCols), next.length - 1));
        } else {
          next.push(Array.from({ length: Math.max(colCount, needCols) }, () => "" as Cell));
        }
      }
      next = next.map((r) => {
        const copy = [...r];
        while (copy.length < needCols) copy.push(kind === "lp" ? 0 : "");
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
      return null;
    },
    [cols, colCount, matrix, onChange, kind]
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
          disabled={matrix.length <= minRows}
        >
          − Fila
        </button>
        <button
          type="button"
          className="btn btn-quiet"
          onClick={removeLastColumn}
          aria-label="Quitar última columna"
          disabled={colCount <= minCols}
        >
          − Columna
        </button>
        <span className="field-hint sheet-hint">
          Tab → siguiente · Enter ↓ · En signo: &lt; = &gt; o clic
        </span>
      </div>
      <div
        className="ag-theme-quartz sheet-grid"
        style={{ height, width: "100%" }}
        role="grid"
        aria-label="Hoja de datos del modelo"
        onKeyDown={(e) => {
          if (e.key === "Enter") e.stopPropagation();
        }}
      >
        <AgGridReact<RowData>
          ref={gridRef}
          rowData={rows}
          columnDefs={cols}
          getRowId={(p) => String(p.data.__rid)}
          onCellValueChanged={onCellValueChanged}
          onCellEditingStopped={onCellEditingStopped}
          processDataFromClipboard={processDataFromClipboard}
          localeText={LOCALE_ES}
          singleClickEdit
          stopEditingWhenCellsLoseFocus
          enterNavigatesVertically
          enterNavigatesVerticallyAfterEdit
          undoRedoCellEditing
          animateRows={false}
          headerHeight={34}
          rowHeight={kind === "lp" ? 40 : 36}
          defaultColDef={{ sortable: false, filter: false, suppressHeaderMenuButton: true }}
          ensureDomOrder
        />
      </div>
    </div>
  );
}
