// ============================================================
// FILE RATECAL3e — app/[hotelId]/rates/page.tsx (Cloudbeds style)
// Rates page ("/rates") — ADMIN only screen.
// Per-channel prices and inventory. Ten trang la "Lịch giá"
// cho khop ten trong menu (truoc day la "Bán phòng").
// ============================================================

import RatesCalendar from "@/components/RatesCalendar";

export default function RatesPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold text-[#17293e]">Lịch giá</h1>
      <p className="mt-1 text-sm text-[#68707a]">
        Giá bán theo từng kênh. PMS chỉ đưa giá và tồn cho kênh, còn lại kênh tự lo. Quỹ phòng là chung cho mọi kênh và đã trừ phòng đang sửa.
      </p>
      <div className="mt-5">
        <RatesCalendar />
      </div>
    </div>
  );
}
