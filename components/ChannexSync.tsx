"use client";

// ============================================================
// CHANNEX SYNC — components/ChannexSync.tsx
// The "Đồng bộ ARI" card (full sync thu cong): tinh gia tri
// bang lib/channex-compute (dung chung voi hang doi tu dong)
// cho cua so 30 ngay tu hom nay, gui qua /api/channex/sync.
// ============================================================

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { currentHotelId } from "@/lib/current-hotel";
import { addDaysStr, computeChannexValues, isoDay } from "@/lib/channex-compute";

const HOTEL_ID = currentHotelId();

export default function ChannexSync() {
  const [propertyId, setPropertyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [days, setDays] = useState(30);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("channel_connections").select("external_property_id")
        .eq("hotel_id", HOTEL_ID).eq("provider", "channex").single();
      setPropertyId(data?.external_property_id ?? null);
      setLoading(false);
    })();
  }, []);

  async function runSync() {
    if (!propertyId) return;
    setBusy(true);
    setMsg("");
    setError("");
    setWarnings([]);
    try {
      const start = isoDay(new Date());
      const dates = Array.from({ length: days }, (_, i) => addDaysStr(start, i));
      const { availability, restrictions } = await computeChannexValues(dates);
      const res = await fetch("/api/channex/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ propertyId, availability, restrictions }),
      });
      const data = await res.json();
      if (!data.ok) {
        setError(data.error ?? "Đồng bộ thất bại.");
      } else {
        setMsg(
          `Đã đồng bộ lên Channex (${data.env}): ${data.availabilitySent} giá trị tồn phòng + ${data.restrictionsSent} giá trị giá/restrictions, cho ${days} ngày từ ${start}.`
        );
        if (data.warningCount > 0) {
          setWarnings(
            (data.warnings ?? []).map((w: unknown) =>
              typeof w === "string" ? w : JSON.stringify(w).slice(0, 300)
            )
          );
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Đồng bộ thất bại.");
    }
    setBusy(false);
  }

  return (
    <div className="cb-card mt-5 p-5">
      <h2 className="font-bold text-[#17293e]">Đồng bộ ARI lên Channex</h2>
      <p className="mt-1 text-sm text-[#68707a]">
        Đẩy <b>tồn phòng</b> (theo loại phòng) và <b>giá + restrictions</b> (theo gói giá OTA) cho số ngày tới được chọn bên dưới.
        Hai loại dữ liệu đi bằng hai lệnh riêng đúng chuẩn Channex. Gói kế thừa chỉ gửi restrictions — giá của chúng
        do Channex tự suy từ gói gốc. Thay đổi lẻ trong PMS nay đã tự động gửi qua hàng đợi (chip Channex ở góc màn hình);
        nút này dùng khi cần đồng bộ lại toàn bộ.
      </p>
      {loading ? (
        <p className="mt-3 text-sm text-[#68707a]">Đang tải...</p>
      ) : !propertyId ? (
        <p className="mt-3 rounded-lg bg-[#fdf3e3] px-3 py-2 text-sm text-[#9a6a12]">
          Cần tạo cấu trúc trên Channex (thẻ phía trên) trước khi đồng bộ.
        </p>
      ) : (
        <div className="mt-4 flex items-center gap-3">
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="rounded-lg border border-[#dde3ea] bg-white px-2 py-2 text-sm text-[#17293e]"
            title="Số ngày đồng bộ"
          >
            <option value={30}>30 ngày tới</option>
            <option value={500}>500 ngày (toàn bộ — dùng cho kiểm định)</option>
          </select>
          <button onClick={runSync} disabled={busy} className="cb-btn-primary px-4 py-2 text-sm disabled:opacity-60">
            {busy ? "Đang đồng bộ..." : "Đồng bộ ngay"}
          </button>
          <span className="text-xs text-[#68707a]">Đồng bộ toàn bộ (full sync) — an toàn khi bấm lại nhiều lần.</span>
        </div>
      )}
      {msg && <p className="mt-3 rounded-lg bg-[#e6f7f1] px-3 py-2 text-sm text-[#0e7a56]">{msg}</p>}
      {error && <p className="mt-3 rounded-lg bg-[#fdecec] px-3 py-2 text-sm text-[#e5484d]">{error}</p>}
      {warnings.length > 0 && (
        <div className="mt-3 rounded-lg bg-[#fdf3e3] px-3 py-2 text-sm text-[#9a6a12]">
          <p className="font-medium">Channex trả về cảnh báo cho một số giá trị:</p>
          {warnings.map((w, i) => <p key={i} className="mt-1 break-all text-xs">{w}</p>)}
        </div>
      )}
    </div>
  );
}
