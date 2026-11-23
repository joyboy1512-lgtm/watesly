import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { formatContactDate } from "../lib/contactHelpers";

type Props = {
  label: string;
  dates: string[];
  values: string[];
  onChange: (values: string[]) => void;
  allLabel?: string;
  className?: string;
  variant?: "default" | "header";
};

type MenuPos = { top: number; left: number; width: number; openUp: boolean };

function monthKey(date: string) {
  return date.slice(0, 7);
}

function monthLabel(key: string) {
  const [year, month] = key.split("-");
  const value = new Date(Number(year), Number(month) - 1, 1);
  return new Intl.DateTimeFormat("ar", { month: "long", year: "numeric" }).format(value);
}

function dayLabel(date: string) {
  return formatContactDate(`${date}T12:00:00`);
}

export default function ExcelDateMultiFilter({
  label,
  dates,
  values,
  onChange,
  allLabel = "كل التواريخ",
  className = "",
  variant = "default"
}: Props) {
  const isHeader = variant === "header";
  const [open, setOpen] = useState(false);
  const [expandedMonth, setExpandedMonth] = useState<string | null>(null);
  const [menuPos, setMenuPos] = useState<MenuPos | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const months = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const date of dates) {
      const key = monthKey(date);
      const list = map.get(key) ?? [];
      list.push(date);
      map.set(key, list);
    }
    return Array.from(map.entries())
      .map(([key, days]) => ({
        key,
        label: monthLabel(key),
        days: days.sort((a, b) => b.localeCompare(a))
      }))
      .sort((a, b) => b.key.localeCompare(a.key));
  }, [dates]);

  function updateMenuPos() {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const width = Math.max(rect.width, 260);
    const spaceBelow = window.innerHeight - rect.bottom;
    const openUp = spaceBelow < 320 && rect.top > spaceBelow;
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
  }, [open, expandedMonth]);

  useEffect(() => {
    if (!open) return;
    function onDocClick(event: MouseEvent) {
      const target = event.target as Node;
      if (rootRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
      setExpandedMonth(null);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  function toggleDay(day: string) {
    onChange(values.includes(day) ? values.filter((item) => item !== day) : [...values, day]);
  }

  function toggleMonth(days: string[]) {
    const allSelected = days.every((day) => values.includes(day));
    if (allSelected) {
      const remove = new Set(days);
      onChange(values.filter((item) => !remove.has(item)));
      return;
    }
    onChange(Array.from(new Set([...values, ...days])));
  }

  const menu = open && menuPos && (
    <div
      ref={menuRef}
      className={`searchable-multi-filter-menu excel-date-filter-menu is-portal ${menuPos.openUp ? "is-open-up" : ""}`}
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
      <div className="searchable-multi-filter-toolbar">
        <button type="button" className="secondary-button compact" onClick={() => onChange([])}>
          مسح
        </button>
        <button
          type="button"
          className="secondary-button compact"
          onClick={() => onChange(dates.slice())}
          disabled={dates.length === 0}
        >
          تحديد الكل
        </button>
      </div>
      {months.length === 0 && <p className="hint-text">لا توجد تواريخ.</p>}
      <div className="excel-date-filter-months">
        {months.map((month) => {
          const selectedCount = month.days.filter((day) => values.includes(day)).length;
          const allSelected = selectedCount === month.days.length && month.days.length > 0;
          const someSelected = selectedCount > 0 && !allSelected;
          const expanded = expandedMonth === month.key;
          return (
            <div key={month.key} className={`excel-date-filter-month ${expanded ? "is-expanded" : ""}`}>
              <div className="excel-date-filter-month-row">
                <label className="excel-date-filter-month-check">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    ref={(input) => {
                      if (input) input.indeterminate = someSelected;
                    }}
                    onChange={() => toggleMonth(month.days)}
                  />
                  <span>{month.label}</span>
                  <em>({month.days.length})</em>
                </label>
                <button
                  type="button"
                  className="excel-date-filter-expand"
                  aria-expanded={expanded}
                  onClick={() => setExpandedMonth(expanded ? null : month.key)}
                >
                  {expanded ? "▾" : "◂"}
                </button>
              </div>
              {expanded && (
                <div className="excel-date-filter-days">
                  {month.days.map((day) => (
                    <label key={day} className="searchable-multi-filter-option">
                      <input
                        type="checkbox"
                        checked={values.includes(day)}
                        onChange={() => toggleDay(day)}
                      />
                      <span>{dayLabel(day)}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );

  return (
    <div
      className={[
        "searchable-multi-filter",
        "excel-date-multi-filter",
        isHeader ? "is-compact is-header" : "is-compact",
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
        aria-label={values.length ? `${label}: ${values.length} محدد` : `${label}: ${allLabel}`}
        title={values.length ? values.map(dayLabel).join("، ") : allLabel}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="searchable-multi-filter-trigger-text">{isHeader ? label : values.length ? `${values.length} محدد` : allLabel}</span>
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
