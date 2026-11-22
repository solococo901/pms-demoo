"use client";
import { IconCalendar } from "@/components/icons";

// NATEUI21 — components/DatePicker.tsx (lich chon ngay dung chung cho ca PMS)
// DatePicker chon 1 ngay (co khoa min/max, hien khoang khi chon theo cap); DateRangePicker chon khoang ngay; popup dat co dinh theo vi tri nut.
// Doi sang token toi gian 2026-11-21.

import { useEffect, useRef, useState, type ReactNode } from "react";

const MONTHS = ["Tháng 1", "Tháng 2", "Tháng 3", "Tháng 4", "Tháng 5", "Tháng 6", "Tháng 7", "Tháng 8", "Tháng 9", "Tháng 10", "Tháng 11", "Tháng 12"];
const WEEKDAYS = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"];

const localISO = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const toDate = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y || 1970, (m || 1) - 1, d || 1);
};
const addDays = (iso: string, n: number) => {
  const d = toDate(iso);
  d.setDate(d.getDate() + n);
  return localISO(d);
};
const fmtDate = (iso: string) => {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
};

type CalView = { y: number; m: number };

function monthCells(y: number, m: number): (string | null)[] {
  const first = new Date(y, m, 1);
  const startDow = (first.getDay() + 6) % 7; // Thu 2 = 0
  const days = new Date(y, m + 1, 0).getDate();
  const cells: (string | null)[] = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= days; d++) cells.push(localISO(new Date(y, m, d)));
  return cells;
}

const BTN_INPUT =
  "inline-flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none hover:border-primary";
const BTN_CHIP =
  "inline-flex items-center gap-1.5 rounded-full border border-line bg-surface-muted px-3 py-1.5 text-xs font-medium text-ink outline-none hover:border-primary";

function CalendarPopup({ rect, view, setView, dayClass, onDay, onHover, footer }: {
  rect: { left: number; top: number; bottom: number };
  view: CalView;
  setView: (v: CalView) => void;
  dayClass: (day: string) => string;
  onDay: (day: string) => void;
  onHover?: (day: string | null) => void;
  footer?: ReactNode;
}) {
  const cells = monthCells(view.y, view.m);
  const todayISO = localISO(new Date());
  const shiftMonth = (d: number) => {
    const dt = new Date(view.y, view.m + d, 1);
    setView({ y: dt.getFullYear(), m: dt.getMonth() });
  };
  const W = 304;
  const H = 360;
  const vw = typeof window !== "undefined" ? window.innerWidth : 1200;
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;
  const left = Math.min(Math.max(rect.left, 8), Math.max(vw - W - 8, 8));
  const top = rect.bottom + H + 12 > vh ? Math.max(rect.top - H - 8, 8) : rect.bottom + 8;
  return (
    <div className="fixed z-50 w-[304px] rounded-xl border border-line bg-surface p-3 shadow-2xl" style={{ left, top }}>
      <div className="flex items-center justify-between gap-2">
        <button type="button" className="cb-btn-ghost px-2 py-1 text-sm" onClick={() => shiftMonth(-1)}>‹</button>
        <div className="flex gap-1">
          <select className="cb-input-pill px-2 py-1 text-sm" value={view.m} onChange={(e) => setView({ ...view, m: Number(e.target.value) })}>
            {MONTHS.map((label, i) => (<option key={label} value={i}>{label}</option>))}
          </select>
          <select className="cb-input-pill px-2 py-1 text-sm" value={view.y} onChange={(e) => setView({ ...view, y: Number(e.target.value) })}>
            {Array.from({ length: 11 }, (_, i) => 2024 + i).map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>
        <button type="button" className="cb-btn-ghost px-2 py-1 text-sm" onClick={() => shiftMonth(1)}>›</button>
      </div>
      <div className="mt-3 grid grid-cols-7 gap-1 text-center text-[11px] font-medium text-muted">
        {WEEKDAYS.map((d) => (<div key={d}>{d}</div>))}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-1" onMouseLeave={() => onHover?.(null)}>
        {cells.map((day, i) =>
          day === null ? (
            <div key={`b-${i}`} />
          ) : (
            <button
              key={day}
              type="button"
              onClick={() => onDay(day)}
              onMouseEnter={() => onHover?.(day)}
              className={`rounded-lg py-1.5 text-sm ${dayClass(day)} ${day === todayISO ? "ring-1 ring-primary" : ""}`}
            >
              {toDate(day).getDate()}
            </button>
          )
        )}
      </div>
      {footer && <div className="mt-3 border-t border-[var(--nui-bg)] pt-2">{footer}</div>}
    </div>
  );
}

function useEscapeClose(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
}

type PickerBase = {
  min?: string;
  className?: string;
  fullWidth?: boolean;
  variant?: "input" | "chip";
};

function pickerButtonClass(variant: "input" | "chip", fullWidth: boolean, extra?: string) {
  return `${variant === "chip" ? BTN_CHIP : BTN_INPUT}${fullWidth ? " w-full justify-start" : ""}${extra ? ` ${extra}` : ""}`;
}

// ---------- chon 1 ngay ----------
export function DatePicker({ value, onChange, min, rangeStart, placeholder, clearable, className, fullWidth, variant = "input" }: {
  value: string;
  onChange: (iso: string) => void;
  // rangeStart: ngay dau cua cap (vd ngay den) — hien xanh dam, khoa cac ngay <= no khi co min, re chuot xem truoc khoang o.
  rangeStart?: string;
  placeholder?: string;
  clearable?: boolean;
} & PickerBase) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<CalView>(() => {
    const d = value ? toDate(value) : new Date();
    return { y: d.getFullYear(), m: d.getMonth() };
  });
  const [hover, setHover] = useState<string | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const [rect, setRect] = useState<{ left: number; top: number; bottom: number } | null>(null);
  useEscapeClose(open, () => setOpen(false));
  const openPicker = () => {
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setRect({ left: r.left, top: r.top, bottom: r.bottom });
    const d = value ? toDate(value) : new Date();
    setView({ y: d.getFullYear(), m: d.getMonth() });
    setHover(null);
    setOpen(true);
  };
  const dayClass = (day: string) => {
    if (min && day < min) return "cursor-not-allowed text-muted opacity-40";
    if (rangeStart && day === rangeStart) return "bg-primary font-bold text-white";
    if (rangeStart && hover && day > rangeStart && day <= hover) return "bg-primary-soft";
    if (rangeStart && !hover && value && day > rangeStart && day < value) return "bg-primary-soft";
    if (day === value) return "bg-primary font-bold text-white";
    return "hover:bg-[var(--nui-bg)]";
  };
  const pick = (day: string) => {
    if (min && day < min) return;
    onChange(day);
    setHover(null);
    setOpen(false);
  };
  return (
    <div className={fullWidth ? "relative block w-full" : "relative inline-block"}>
      <button ref={btnRef} type="button" className={pickerButtonClass(variant, !!fullWidth, className)} onClick={() => (open ? setOpen(false) : openPicker())}>
        <IconCalendar className="h-4 w-4 shrink-0" />
        <span>{value ? fmtDate(value) : placeholder ?? "Chọn ngày"}</span>
      </button>
      {open && rect && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <CalendarPopup
            rect={rect} view={view} setView={setView} dayClass={dayClass} onDay={pick} onHover={setHover}
            footer={
              <div>
                {rangeStart && (
                  <p className="mb-2 text-xs text-muted">
                    Đã chọn ngày đến {fmtDate(rangeStart)} — các ngày từ ngày này trở về trước đã khoá, rê chuột để xem trước khoảng ở.
                  </p>
                )}
                <div className="flex items-center justify-between gap-2">
                  <button type="button" className="cb-btn-ghost px-3 py-1 text-xs" onClick={() => { onChange(localISO(new Date())); setOpen(false); }}>
                    Hôm nay
                  </button>
                  {clearable && value && (
                    <button type="button" className="cb-btn-ghost px-3 py-1 text-xs" onClick={() => { onChange(""); setOpen(false); }}>
                      Xoá lựa chọn
                    </button>
                  )}
                </div>
              </div>
            }
          />
        </>
      )}
    </div>
  );
}

// ---------- chon khoang ngay ----------
export function DateRangePicker({ from, to, onChange, min, fromLabel, toLabel, className, fullWidth, variant = "input" }: {
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
  fromLabel?: string;
  toLabel?: string;
} & PickerBase) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<CalView>(() => {
    const d = from ? toDate(from) : new Date();
    return { y: d.getFullYear(), m: d.getMonth() };
  });
  const [start, setStart] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const [rect, setRect] = useState<{ left: number; top: number; bottom: number } | null>(null);
  useEscapeClose(open, () => setOpen(false));
  const openPicker = () => {
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setRect({ left: r.left, top: r.top, bottom: r.bottom });
    const d = from ? toDate(from) : new Date();
    setView({ y: d.getFullYear(), m: d.getMonth() });
    setStart(null);
    setHover(null);
    setOpen(true);
  };
  const pick = (day: string) => {
    if (min && day < min) return;
    if (!start) {
      setStart(day);
      return;
    }
    const f = day < start ? day : start;
    const t = day < start ? start : day;
    onChange(f, t === f ? addDays(f, 1) : t);
    setStart(null);
    setHover(null);
    setOpen(false);
  };
  const dayClass = (day: string) => {
    if (min && day < min) return "cursor-not-allowed text-muted opacity-40";
    if (start && day === start) return "bg-primary font-bold text-white";
    if (!start && from && (day === from || day === to)) return "bg-primary font-bold text-white";
    if (!start && from && to && day > from && day < to) return "bg-primary-soft";
    if (start && hover && day > start && day <= hover) return "bg-primary-soft";
    return "hover:bg-[var(--nui-bg)]";
  };
  const label = from && to ? `${fmtDate(from)} → ${fmtDate(to)}` : "Chọn ngày đến → ngày đi";
  return (
    <div className={fullWidth ? "relative block w-full" : "relative inline-block"}>
      <button ref={btnRef} type="button" className={pickerButtonClass(variant, !!fullWidth, className)} onClick={() => (open ? setOpen(false) : openPicker())}>
        <IconCalendar className="h-4 w-4 shrink-0" />
        <span>{label}</span>
      </button>
      {open && rect && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <CalendarPopup
            rect={rect} view={view} setView={setView} dayClass={dayClass} onDay={pick} onHover={setHover}
            footer={
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-muted">
                  {start
                    ? `Đã chọn ${fromLabel ?? "ngày đến"} ${fmtDate(start)} — bấm tiếp ${toLabel ?? "ngày đi"}`
                    : from && to
                      ? `Đang chọn ${fmtDate(from)} → ${fmtDate(to)} — bấm lại ngày đến để đổi`
                      : "Bấm ngày bắt đầu, rồi ngày kết thúc"}
                </span>
                {start && (
                  <button type="button" className="cb-btn-ghost shrink-0 px-3 py-1 text-xs" onClick={() => setStart(null)}>
                    Đặt lại
                  </button>
                )}
              </div>
            }
          />
        </>
      )}
    </div>
  );
}
