import { useEffect, useMemo, useRef, useState } from "react";

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
};

export default function SearchableMultiFilter({
  label,
  options,
  values,
  onChange,
  allLabel,
  searchPlaceholder = "بحث…",
  className = "",
  compact = false
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
        setQuery("");
      }
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

  const triggerText =
    values.length === 0
      ? allLabel
      : values.length === 1
        ? selectedLabels[0]
        : `${values.length} محددة`;

  function toggle(value: string) {
    onChange(values.includes(value) ? values.filter((item) => item !== value) : [...values, value]);
  }

  return (
    <div
      className={`searchable-multi-filter ${compact ? "is-compact" : ""} ${className}`.trim()}
      ref={rootRef}
    >
      <span className="searchable-multi-filter-label">{label}</span>
      <button
        type="button"
        className={`searchable-multi-filter-trigger ${values.length ? "is-active" : ""}`}
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => setOpen((current) => !current)}
      >
        <span className="searchable-multi-filter-trigger-text">{triggerText}</span>
        <span className="searchable-multi-filter-caret" aria-hidden>
          ▾
        </span>
      </button>
      {open && (
        <div className="searchable-multi-filter-menu" role="listbox" aria-multiselectable="true">
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
      )}
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
