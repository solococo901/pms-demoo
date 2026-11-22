"use client";

// NATEUI22 — components/ChannexSync.tsx (the "Dong bo ARI" — full sync thu cong)
// Tinh gia tri bang lib/channex-compute (dung chung voi hang doi tu dong) cho cua so 30 ngay tu hom nay, gui qua /api/channex/sync.
// Doi sang token toi gian 2026-11-21.

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { currentHotelId } from "@/lib/current-hotel";
import { useParams } from "next/navigation";
import { addDaysStr, computeChannexValues, isoDay } from "@/lib/channex-compute";
import { patchChannelSettings } from "@/lib/channex-outbox";


export default function ChannexSync() {
  // Khach san lay tu URL khi co, khong thi dung khach san da luu theo tab.
  const params = useParams();
  const HOTEL_ID = typeof params.hotelId === "string" ? params.hotelId : currentHotelId();
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
        // Ghi dau thoi gian de trang Kênh bán hiện "Đồng bộ gần nhất" thật.
        void patchChannelSettings(HOTEL_ID, { last_sync_at: new Date().toISOString() });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Đồng bộ thất bại.");
    }
    setBusy(false);
  }

  return (
    <div className="cb-card mt-5 p-5">
      <h2 className="font-bold text-ink">Đồng bộ ARI lên Channex</h2>
      <p className="mt-1 text-sm text-muted">
        Đẩy <b>tồn phòng</b> (theo loại phòng) và <b>giá + restrictions</b> (theo gói giá OTA) cho số ngày tới được chọn bên dưới.
        Hai loại dữ liệu đi bằng hai lệnh riêng đúng chuẩn Channex. Gói kế thừa chỉ gửi restrictions — giá của chúng
        do Channex tự suy từ gói gốc. Thay đổi lẻ trong PMS nay đã tự động gửi qua hàng đợi (chip Channex ở góc màn hình);
        nút này dùng khi cần đồng bộ lại toàn bộ.
      </p>
      {loading ? (
        <p className="mt-3 text-sm text-muted">Đang tải...</p>
      ) : !propertyId ? (
        <p className="mt-3 rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning">
          Cần tạo cấu trúc trên Channex (thẻ phía trên) trước khi đồng bộ.
        </p>
      ) : (
        <div className="mt-4 flex items-center gap-3">
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="rounded-lg border border-line bg-surface px-2 py-2 text-sm text-ink"
            title="Số ngày đồng bộ"
          >
            <option value={30}>30 ngày tới</option>
            <option value={500}>500 ngày (toàn bộ — dùng cho kiểm định)</option>
          </select>
          <button onClick={runSync} disabled={busy} className="cb-btn-primary px-4 py-2 text-sm disabled:opacity-60">
            {busy ? "Đang đồng bộ..." : "Đồng bộ ngay"}
          </button>
          <span className="text-xs text-muted">Đồng bộ toàn bộ (full sync) — an toàn khi bấm lại nhiều lần.</span>
        </div>
      )}
      {msg && <p className="mt-3 rounded-lg bg-success-soft px-3 py-2 text-sm text-success">{msg}</p>}
      {error && <p className="mt-3 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
      {warnings.length > 0 && (
        <div className="mt-3 rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning">
          <p className="font-medium">Channex trả về cảnh báo cho một số giá trị:</p>
          {warnings.map((w, i) => <p key={i} className="mt-1 break-all text-xs">{w}</p>)}
        </div>
      )}
    </div>
  );
}
