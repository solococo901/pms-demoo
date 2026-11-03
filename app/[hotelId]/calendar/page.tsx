// ============================================================
// FILE 7c — app/calendar/page.tsx (Cloudbeds style)
// Staff calendar page ("/calendar") — the front desk's main
// screen. The page itself is thin: title + legend + the
// StaffCalendar component does all the work.
// ============================================================

import StaffCalendar from "@/components/StaffCalendar";

export default function CalendarPage() {
  return (
    <div>
      <StaffCalendar />
    </div>
  );
}
