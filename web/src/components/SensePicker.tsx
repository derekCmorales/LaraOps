import { useEffect, useMemo, useRef, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent } from "react";
import type { CustomCellEditorProps, CustomCellRendererProps } from "ag-grid-react";
import {
  isEmptyCell,
  matchSenseInput,
  senseChoicesForRow,
  type SenseChoice,
} from "../lib/lpSheetNav";

type SegmentProps = {
  choices: SenseChoice[];
  value: string;
  onPick: (value: string) => void;
  compact?: boolean;
  activeValue?: string;
};

function stopGridMouse(e: MouseEvent) {
  e.stopPropagation();
}

export function SenseSegment({ choices, value, onPick, compact = false, activeValue }: SegmentProps) {
  const current = choices.some((c) => c.value === value) ? value : choices[0]?.value;
  return (
    <div className={`sense-seg${compact ? " sense-seg-compact" : " sense-seg-pop"}`} role="listbox" aria-label="Sentido">
      {choices.map((choice) => {
        const selected = choice.value === current;
        const active = choice.value === (activeValue ?? current);
        return (
          <button
            key={choice.value}
            type="button"
            role="option"
            aria-label={choice.caption}
            aria-selected={selected}
            title={`${choice.caption} (${choice.keys})`}
            className={[
              "sense-seg-btn",
              selected ? "sense-seg-selected" : "",
              active ? "sense-seg-active" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            onMouseDown={stopGridMouse}
            onClick={(e) => {
              stopGridMouse(e);
              onPick(choice.value);
            }}
          >
            <span className="sense-seg-sym">{choice.symbol}</span>
            {!compact ? (
              <>
                <span className="sense-seg-cap">{choice.caption}</span>
                <kbd className="sense-seg-key">{choice.keys}</kbd>
              </>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

export function SenseCellRenderer(props: CustomCellRendererProps) {
  const rowIndex = props.node?.rowIndex ?? -1;
  if (rowIndex <= 0) {
    return <span className="sense-static">{props.valueFormatted ?? String(props.value ?? "")}</span>;
  }
  const choices = senseChoicesForRow(rowIndex);
  const raw = String(props.value ?? "");
  const value = choices.some((c) => c.value === raw) ? raw : choices[0]?.value ?? "";

  function pick(next: string) {
    if (props.setValue) {
      props.setValue(next);
    } else if (props.node && props.column) {
      props.node.setDataValue(props.column, next);
    }
    const col = props.column;
    const ri = props.node?.rowIndex;
    if (col && ri != null) {
      props.api.setFocusedCell(ri, col);
    }
  }

  return <SenseSegment compact choices={choices} value={value} onPick={pick} />;
}

export function SenseCellEditor(props: CustomCellEditorProps) {
  const rowIndex = props.node?.rowIndex ?? -1;
  const choices = useMemo(() => senseChoicesForRow(rowIndex), [rowIndex]);
  const isObjective = rowIndex === 1;
  const rootRef = useRef<HTMLDivElement>(null);

  const raw = String(props.value ?? "");
  const fallback = choices[0]?.value ?? "";
  const current = choices.some((c) => c.value === raw) ? raw : fallback;

  useEffect(() => {
    rootRef.current?.focus();
    if (isEmptyCell(props.value) && fallback) {
      props.onValueChange(fallback);
    }
    const fromKey = matchSenseInput(props.eventKey ?? "", isObjective);
    if (fromKey) {
      props.onValueChange(fromKey);
      props.stopEditing();
    }
    // Solo al montar el editor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function pick(next: string) {
    props.onValueChange(next);
    props.stopEditing();
  }

  function cycle(delta: number) {
    const idx = Math.max(0, choices.findIndex((c) => c.value === current));
    const next = choices[(idx + delta + choices.length) % choices.length];
    if (next) props.onValueChange(next.value);
  }

  function onKey(e: ReactKeyboardEvent<HTMLDivElement>) {
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      e.stopPropagation();
      cycle(1);
      return;
    }
    if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      e.stopPropagation();
      cycle(-1);
      return;
    }
    if (e.key === "Enter" || e.key === "Tab") {
      if (!choices.some((c) => c.value === String(props.value ?? ""))) {
        props.onValueChange(current);
      }
      if (e.key === "Enter") e.preventDefault();
      props.stopEditing();
      props.onKeyDown(e.nativeEvent);
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      props.stopEditing(true);
      return;
    }
    const matched = matchSenseInput(e.key, isObjective);
    if (matched) {
      e.preventDefault();
      e.stopPropagation();
      pick(matched);
    }
  }

  return (
    <div
      ref={rootRef}
      className="sense-pop"
      tabIndex={0}
      role="dialog"
      aria-label={isObjective ? "Sentido del objetivo" : "Sentido de la restricción"}
      onKeyDown={onKey}
    >
      <SenseSegment choices={choices} value={current} activeValue={current} onPick={pick} />
    </div>
  );
}
