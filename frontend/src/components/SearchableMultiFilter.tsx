import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type MultiFilterOption = {
  value: string;
  label: string;
};

type Props = {
  label: string;
  options: MultiFilterOption[];
  values: string[];
  onChange: (values: string[]) => void;
  allLabel: string;
  searchPlaceholder?: string;
  className?: string;
  compact?: boolean;
  /** Column-header style: label is the trigger, green header look. */
  variant?: "default" | "header";
};

type MenuPos = { top: number; left: number; width: number; openUp: boolean };

export default function SearchableMultiFilter({
  label,
  options,
  values,
  onChange,
  allLabel,
  searchPlaceholder = "بحث…",
  className = "",
  compact = false,
  variant = "default"
}: Props) {
  const isHeader = variant === "header";
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [menuPos, setMenuPos] = useState<MenuPos | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  function updateMenuPos() {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const width = Math.max(rect.width, isHeader ? 220 : 200);
    const spaceBelow = window.innerHeight - rect.bottom;
    const openUp = spaceBelow < 280 && rect.top > spaceBelow;
    const left = Math.min(
      Math.max(8, rect.left + rect.width / 2 - width / 2),
      window.innerWidth - width - 8
    );
    setMenuPos({
      top: openUp ? rect.top - 6 : rect.bottom + 6,
      left,
      width,
      openUp
    });
  }

  useLayoutEffect(() => {
    if (!open) {
      setMenuPos(null);
      return;
    }
    updateMenuPos();
    function onScrollOrResize() {
      updateMenuPos();
    }
    window.addEventListener("resize", onScrollOrResize);
    window.addEventListener("scroll", onScrollOrResize, true);
    return () => {
      window.removeEventListener("resize", onScrollOrResize);
      window.removeEventListener("scroll", onScrollOrResize, true);
    };
  }, [open, isHeader]);

  useEffect(() => {
    if (!open) return;
    function onDocClick(event: MouseEvent) {
      const target = event.target as Node;
      if (rootRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
      setQuery("");
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  useEffect(() => {
    if (open) {
      window.setTimeout(() => searchRef.current?.focus(), 0);
    }
  }, [open]);

  const selectedLabels = useMemo(() => {
    const map = new Map(options.map((item) => [item.value, item.label]));
    return values.map((value) => map.get(value) ?? value);
  }, [options, values]);

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return options;
    return options.filter(
      (item) => item.label.toLowerCase().includes(term) || item.value.toLowerCase().includes(term)
    );
  }, [options, query]);

  const triggerText = isHeader
    ? label
    : values.length === 0
      ? allLabel
      : values.length === 1
        ? selectedLabels[0]
        : `${values.length} محدد`;

  function toggle(value: string) {
    onChange(values.includes(value) ? values.filter((item) => item !== value) : [...values, value]);
  }

  const menu = open && menuPos && (
    <div
      ref={menuRef}
      className={`searchable-multi-filter-menu is-portal ${menuPos.openUp ? "is-open-up" : ""}`}
      role="listbox"
      aria-multiselectable="true"
      style={{
        position: "fixed",
        top: menuPos.openUp ? undefined : menuPos.top,
        bottom: menuPos.openUp ? window.innerHeight - menuPos.top : undefined,
        left: menuPos.left,
        width: menuPos.width,
        zIndex: 1200
      }}
    >
      <div className="searchable-multi-filter-search">
        <input
          ref={searchRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={searchPlaceholder}
          aria-label={`بحث في ${label}`}
        />
      </div>
      <div className="searchable-multi-filter-toolbar">
        <button type="button" className="secondary-button compact" onClick={() => onChange([])}>
          مسح
        </button>
        <button
          type="button"
          className="secondary-button compact"
          onClick={() => onChange(filtered.map((item) => item.value))}
          disabled={filtered.length === 0}
        >
          تحديد الظاهر
        </button>
      </div>
      {filtered.length === 0 && <p className="hint-text">لا نتائج مطابقة.</p>}
      <div className="searchable-multi-filter-options">
        {filtered.map((item) => {
          const checked = values.includes(item.value);
          return (
            <label key={item.value} className="searchable-multi-filter-option">
              <input type="checkbox" checked={checked} onChange={() => toggle(item.value)} />
              <span>{item.label}</span>
            </label>
          );
        })}
      </div>
    </div>
  );

  return (
    <div
      className={[
        "searchable-multi-filter",
        compact || isHeader ? "is-compact" : "",
        isHeader ? "is-header" : "",
        values.length ? "has-selection" : "",
        className
      ]
        .filter(Boolean)
        .join(" ")}
      ref={rootRef}
    >
      {!isHeader && <span className="searchable-multi-filter-label">{label}</span>}
      <button
        ref={triggerRef}
        type="button"
        className={`searchable-multi-filter-trigger ${values.length ? "is-active" : ""}`}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={
          values.length
            ? `${label}: ${values.length} محدد`
            : `${label}: ${allLabel}`
        }
        title={values.length ? selectedLabels.join("، ") : allLabel}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="searchable-multi-filter-trigger-text">{triggerText}</span>
        {values.length > 0 && (
          <span className="searchable-multi-filter-count" aria-hidden>
            {values.length}
          </span>
        )}
        <span className="searchable-multi-filter-caret" aria-hidden>
          ▾
        </span>
      </button>
      {menu ? createPortal(menu, document.body) : null}
    </div>
  );
}

export function parseMultiParam(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function serializeMultiParam(values: string[]): string {
  return values.join(",");
}
