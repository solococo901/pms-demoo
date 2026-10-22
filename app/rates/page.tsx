// ============================================================
// FILE 9a — app/rates/page.tsx (Cloudbeds style)
// Rates page ("/rates") — ADMIN only screen.
// Per-channel rate plans, prices and restrictions.
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
        Giá và hạn chế riêng theo từng kênh, có gói kế thừa giá theo công thức — sửa gói gốc, gói con tự chạy theo. Quỹ phòng là chung cho mọi kênh và đã trừ phòng đang sửa.
      </p>
      <div className="mt-5">
        <RatesCalendar />
      </div>
    </div>
  );
}
