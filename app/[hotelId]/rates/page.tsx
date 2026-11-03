// ============================================================
// FILE RATECAL3b — app/rates/page.tsx (Cloudbeds style)
// Rates page ("/rates") — ADMIN only screen.
// Per-channel prices and inventory.
// Staff accounts will be blocked from this route in Round B
// (permission check); for now the page is just hidden from
// the staff menu conceptually — the layout still shows it.
// ============================================================

import RatesCalendar from "@/components/RatesCalendar";

export default function RatesPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold text-[#17293e]">Bán phòng</h1>
      <p className="mt-1 text-sm text-[#68707a]">
        Giá bán theo từng kênh. PMS chỉ đưa giá và tồn cho kênh, còn lại kênh tự lo. Quỹ phòng là chung cho mọi kênh và đã trừ phòng đang sửa.
      </p>
      <div className="mt-5">
        <RatesCalendar />
      </div>
    </div>
  );
}
