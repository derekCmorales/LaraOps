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
  const listRef = useRef<HTMLUListElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const typeBuf = useRef("");
  const typeTimer = useRef<number | null>(null);
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);

  const selected = options.find((o) => o.value === value) ?? options[0];
  const selectedLabel = selected?.label ?? "—";

  useEffect(() => {
    if (disabled || options.length === 0) return;
    if (options.some((o) => o.value === value)) return;
    onChange(options[0].value);
  }, [disabled, options, value, onChange]);

  useEffect(() => {
    return () => {
      if (typeTimer.current != null) window.clearTimeout(typeTimer.current);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const idx = Math.max(
      0,
      options.findIndex((o) => o.value === value)
    );
    setActiveIdx(idx);
    const id = window.requestAnimationFrame(() => listRef.current?.focus());
    return () => window.cancelAnimationFrame(id);
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
        triggerRef.current?.focus();
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
    triggerRef.current?.focus();
  }

  function moveActive(delta: number) {
    setActiveIdx((i) => {
      if (options.length === 0) return 0;
      return (i + delta + options.length) % options.length;
    });
  }

  function typeahead(key: string) {
    if (key.length !== 1 || !/\S/.test(key)) return false;
    typeBuf.current += key.toLowerCase();
    if (typeTimer.current != null) window.clearTimeout(typeTimer.current);
    typeTimer.current = window.setTimeout(() => {
      typeBuf.current = "";
    }, 600);
    const buf = typeBuf.current;
    const idx = options.findIndex(
      (o) => o.label.toLowerCase().startsWith(buf) || o.value.toLowerCase().startsWith(buf)
    );
    if (idx >= 0) {
      setActiveIdx(idx);
      return true;
    }
    return false;
  }

  function onNavKey(e: ReactKeyboardEvent, fromTrigger: boolean) {
    if (disabled) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) setOpen(true);
      else moveActive(1);
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) setOpen(true);
      else moveActive(-1);
      return;
    }
    if (e.key === "Home" && open) {
      e.preventDefault();
      setActiveIdx(0);
      return;
    }
    if (e.key === "End" && open) {
      e.preventDefault();
      setActiveIdx(options.length - 1);
      return;
    }
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      const opt = options[activeIdx];
      if (opt) choose(opt.value);
      return;
    }
    if (e.key === "Tab") {
      if (open) {
        const opt = options[activeIdx];
        if (opt) onChange(opt.value);
        setOpen(false);
      }
      return;
    }
    if (open && typeahead(e.key)) {
      e.preventDefault();
      return;
    }
    if (fromTrigger && !open && typeahead(e.key)) {
      e.preventDefault();
      setOpen(true);
    }
  }

  const activeId = `${listId}-opt-${activeIdx}`;

  return (
    <div className={`dd${open ? " dd-open" : ""}`} ref={rootRef}>
      <button
        type="button"
        id={triggerId}
        ref={triggerRef}
        className="dd-trigger"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={ariaLabel}
        onClick={() => !disabled && setOpen((o) => !o)}
        onKeyDown={(e) => onNavKey(e, true)}
      >
        <span className="dd-value">{selectedLabel}</span>
        <span className="dd-chevron" aria-hidden>
          ▾
        </span>
      </button>
      {open && (
        <ul
          id={listId}
          ref={listRef}
          className="dd-menu"
          role="listbox"
          tabIndex={0}
          aria-labelledby={triggerId}
          aria-activedescendant={activeId}
          onKeyDown={(e) => onNavKey(e, false)}
        >
          {options.map((o, i) => {
            const selectedOpt = o.value === (selected?.value ?? value);
            const active = i === activeIdx;
            return (
              <li
                key={o.value}
                id={`${listId}-opt-${i}`}
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
