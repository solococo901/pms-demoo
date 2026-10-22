// ============================================================
// FILE 7c — app/calendar/page.tsx (Cloudbeds style)
// Staff calendar page ("/calendar") — the front desk's main
// screen. The page itself is thin: title + legend + the
// StaffCalendar component does all the work.
// ============================================================

import StaffCalendar from "@/components/StaffCalendar";
import { STATUS_LABELS, STATUS_STYLES } from "@/components/ReservationBar";
import type { ReservationStatus } from "@/lib/mock-data";

const LEGEND: ReservationStatus[] = ["pending", "confirmed", "in_house", "checked_out"];

export default function CalendarPage() {
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[#17293e]">Lịch phòng</h1>
          <p className="mt-1 text-sm text-[#68707a]">21/10/2026 – 27/10/2026 · kéo-thả để xếp phòng</p>
        </div>
        <div className="flex flex-wrap gap-3 text-xs text-[#68707a]">
          {LEGEND.map((s) => (
            <span key={s} className="flex items-center gap-1.5">
              <span className={`h-3 w-3 rounded ${STATUS_STYLES[s]}`} />
              {STATUS_LABELS[s]}
            </span>
          ))}
        </div>
      </div>

      <div className="mt-5">
        <StaffCalendar />
      </div>
    </div>
  );
}
