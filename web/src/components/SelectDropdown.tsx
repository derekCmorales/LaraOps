import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";

export type SelectOption = { value: string; label: string };

type Props = {
  id?: string;
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  "aria-label"?: string;
};

/**
 * Dropdown propio (no &lt;select&gt; nativo).
 * El menú abierto del select del navegador/OS no se puede estilizar con CSS;
 * por eso usamos listbox + botón.
 */
export default function SelectDropdown({
  id,
  value,
  options,
  onChange,
  disabled,
  "aria-label": ariaLabel,
}: Props) {
  const autoId = useId();
  const triggerId = id ?? autoId;
  const listId = `${triggerId}-listbox`;
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);

  const selected = options.find((o) => o.value === value) ?? options[0];
  const selectedLabel = selected?.label ?? "—";

  useEffect(() => {
    if (!open) return;
    const idx = Math.max(
      0,
      options.findIndex((o) => o.value === value)
    );
    setActiveIdx(idx);
  }, [open, options, value]);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: globalThis.KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function choose(v: string) {
    onChange(v);
    setOpen(false);
  }

  function onTriggerKey(e: ReactKeyboardEvent<HTMLButtonElement>) {
    if (disabled) return;
    if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setOpen(true);
    }
  }

  function onListKey(e: ReactKeyboardEvent<HTMLUListElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(options.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      const opt = options[activeIdx];
      if (opt) choose(opt.value);
    } else if (e.key === "Home") {
      e.preventDefault();
      setActiveIdx(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setActiveIdx(options.length - 1);
    }
  }

  return (
    <div className={`dd${open ? " dd-open" : ""}`} ref={rootRef}>
      <button
        type="button"
        id={triggerId}
        className="dd-trigger"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={ariaLabel}
        onClick={() => !disabled && setOpen((o) => !o)}
        onKeyDown={onTriggerKey}
      >
        <span className="dd-value">{selectedLabel}</span>
        <span className="dd-chevron" aria-hidden>
          ▾
        </span>
      </button>
      {open && (
        <ul
          id={listId}
          className="dd-menu"
          role="listbox"
          tabIndex={-1}
          aria-labelledby={triggerId}
          onKeyDown={onListKey}
        >
          {options.map((o, i) => {
            const selectedOpt = o.value === value;
            const active = i === activeIdx;
            return (
              <li
                key={o.value}
                role="option"
                aria-selected={selectedOpt}
                className={[
                  "dd-option",
                  selectedOpt ? "dd-option-selected" : "",
                  active ? "dd-option-active" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                onMouseEnter={() => setActiveIdx(i)}
                onClick={() => choose(o.value)}
              >
                {o.label}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
