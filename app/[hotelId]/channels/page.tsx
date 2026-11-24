"use client";

// RATES11 — app/[hotelId]/channels/page.tsx (Kenh ban)
// Bo o nhap "% Hoa hong" o the kenh (Vos: % chi dat o Lich gia) — the kenh chi hien "Đặt ở Lịch giá".
// Moi o kenh hien trang thai THAT doc tu DB; doi sang token toi gian 2026-11-21.
// Da ket noi = co goi gia mang channex_id; tat ban = tao block dong ban theo kenh.

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { CHANNELS } from "@/lib/mock-data";
import ChannexSetup from "@/components/ChannexSetup";
import ChannexSync from "@/components/ChannexSync";
import ChannexBookings from "@/components/ChannexBookings";
import { supabase } from "@/lib/supabase";
import { currentHotelId } from "@/lib/current-hotel";
import { addDaysStr, isoDay } from "@/lib/channex-compute";
import { queueChannexDates, rangeDates } from "@/lib/channex-outbox";
import { IconBuilding } from "@/components/icons";

const ACCOUNT_ID = "11111111-1111-1111-1111-111111111111";
// Ly do danh dau block do cong tac tat-ban tao ra (de bat lai chi xoa dung cac block nay).
const OFF_REASON = "Tắt bán trên kênh";
const OFF_DAYS = 365;
type OffBlock = {
  id: string; channelCode: string; roomTypeId: string;
};

const inputCls = "rounded-lg border border-line px-3 py-2 text-ink outline-none focus:border-primary";

function relTime(iso: string | null): string {
  if (!iso) return "chưa từng";
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return "vừa xong";
  if (mins < 60) return `${mins} phút trước`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} giờ trước`;
  return `${Math.floor(hours / 24)} ngày trước`;
}

export default function ChannelsPage() {
  const params = useParams();
  const HOTEL_ID = typeof params.hotelId === "string" ? params.hotelId : currentHotelId();
  const [environment, setEnvironment] = useState<"staging" | "production">("staging");
  const [channexStatus, setChannexStatus] = useState<"unchecked" | "checking" | "ok" | "error">("unchecked");
  const [channexMsg, setChannexMsg] = useState("");
  const [channexProps, setChannexProps] = useState<{ id: string; title: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState<Record<string, boolean>>({});
  const [offBlocks, setOffBlocks] = useState<OffBlock[]>([]);
  const [roomTypeIds, setRoomTypeIds] = useState<string[]>([]);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [busyCode, setBusyCode] = useState<string | null>(null);

  // Kiem tra ket noi that: trinh duyet goi route may chu giu API key.
  async function testChannex() {
    setChannexStatus("checking");
    setChannexMsg("");
    try {
      const res = await fetch("/api/channex/test");
      const data = await res.json();
      if (data.env) setEnvironment(data.env);
      if (data.ok) {
        setChannexStatus("ok");
        setChannexProps(data.properties ?? []);
        setChannexMsg(
          `Đã nối được tới Channex (${data.env}). Tài khoản có ${data.count} property.`
        );
      } else {
        setChannexStatus("error");
        setChannexProps([]);
        setChannexMsg(data.error ?? "Không kết nối được.");
      }
    } catch {
      setChannexStatus("error");
      setChannexMsg("Không gọi được route kiểm tra của ứng dụng.");
    }
  }

  // ----- LOAD real channel state from Supabase -----
  useEffect(() => {
    (async () => {
      const [plansRes, blocksRes, typesRes, connRes] = await Promise.all([
        supabase.from("rate_plans").select("channel_code, channex_id").eq("hotel_id", HOTEL_ID),
        supabase.from("inventory_blocks").select("id, scope, channel_code, room_type_id, reason").eq("hotel_id", HOTEL_ID),
        supabase.from("room_types").select("id").eq("hotel_id", HOTEL_ID),
        supabase.from("channel_connections").select("settings").eq("hotel_id", HOTEL_ID).eq("provider", "channex").maybeSingle(),
      ]);
      const conn: Record<string, boolean> = {};
      for (const p of plansRes.data ?? []) {
        if (p.channex_id) conn[p.channel_code] = true;
      }
      setConnected(conn);
      setOffBlocks(
        (blocksRes.data ?? [])
          .filter((b) => b.scope === "channel" && b.reason === OFF_REASON)
          .map((b) => ({ id: b.id, channelCode: b.channel_code ?? "", roomTypeId: b.room_type_id }))
      );
      setRoomTypeIds((typesRes.data ?? []).map((t) => t.id));
      const settings = (connRes.data?.settings ?? {}) as Record<string, any>;
      setLastSyncAt(settings.last_sync_at ?? null);
      setLoading(false);
    })();
  }, [HOTEL_ID]);

  const isOff = (code: string) => offBlocks.some((b) => b.channelCode === code);
  const isSelling = (code: string) => !!connected[code] && !isOff(code);

  // Tat ban = tao block dong ban theo kenh cho moi loai phong (365 ngay), bat lai = xoa cac block do.
  async function setSelling(code: string, sell: boolean) {
    if (!connected[code] || busyCode) return;
    setBusyCode(code);
    const today = isoDay(new Date());
    const to = addDaysStr(today, OFF_DAYS);
    if (!sell) {
      const missing = roomTypeIds.filter(
        (tid) => !offBlocks.some((b) => b.channelCode === code && b.roomTypeId === tid)
      );
      const rows = missing.map((tid) => ({
        id: `ib-off-${code}-${tid}`,
        hotel_id: HOTEL_ID, account_id: ACCOUNT_ID,
        scope: "channel", channel_code: code, room_type_id: tid,
        from_date: today, to_date: to, reason: OFF_REASON,
      }));
      if (rows.length > 0) {
        const { error } = await supabase.from("inventory_blocks").insert(rows);
        if (error) { alert("Tắt bán không thành công: " + error.message); setBusyCode(null); return; }
        setOffBlocks((prev) => [
          ...prev,
          ...rows.map((r) => ({ id: r.id, channelCode: code, roomTypeId: r.room_type_id })),
        ]);
      }
      queueChannexDates(rangeDates(today, to), HOTEL_ID);
    } else {
      const doomed = offBlocks.filter((b) => b.channelCode === code);
      if (doomed.length > 0) {
        const { error } = await supabase.from("inventory_blocks").delete().in("id", doomed.map((b) => b.id));
        if (error) { alert("Mở bán lại không thành công: " + error.message); setBusyCode(null); return; }
        setOffBlocks((prev) => prev.filter((b) => !doomed.some((d) => d.id === b.id)));
      }
      queueChannexDates(rangeDates(today, to), HOTEL_ID);
    }
    setBusyCode(null);
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-ink">Kênh bán</h1>
      <p className="mt-1 text-sm text-muted">
        Các OTA nối qua Channex — một kết nối tới Channex là đủ cho mọi OTA. Website và Lễ tân bán trực tiếp trong PMS.
      </p>

      {/* Channex account box */}
      <div className="cb-card mt-5 p-5">
        <div className="flex items-center justify-between">
          <h2 className="font-bold text-ink">Tài khoản Channex</h2>
          <span className={`rounded-full px-3 py-1 text-xs font-medium ${channexStatus === "ok" ? "bg-success-soft text-success" : channexStatus === "error" ? "bg-danger-soft text-danger" : "bg-[var(--nui-bg)] text-muted"}`}>
            {channexStatus === "ok" ? "● Kết nối tốt" : channexStatus === "error" ? "● Kết nối lỗi" : channexStatus === "checking" ? "● Đang kiểm tra..." : "○ Chưa kiểm tra"}
          </span>
        </div>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="text-sm text-ink">
            Môi trường (đọc từ máy chủ)
            <select value={environment} disabled className={`${inputCls} mt-1 block opacity-70`}>
              <option value="staging">Staging (thử nghiệm)</option>
              <option value="production">Production (chạy thật)</option>
            </select>
          </label>
          <div className="flex-1 rounded-lg bg-primary-soft px-3 py-2 text-sm text-muted">
            API key được đọc từ file <b className="text-ink">.env.local</b> phía máy chủ —
            trình duyệt không bao giờ nhìn thấy key.
          </div>
          <button
            onClick={testChannex}
            disabled={channexStatus === "checking"}
            className="cb-btn-primary px-4 py-2 text-sm disabled:opacity-60"
          >
            {channexStatus === "checking" ? "Đang kiểm tra..." : "Kiểm tra kết nối"}
          </button>
        </div>
        <p className="mt-2 text-xs text-muted">
          Đang ở môi trường <b className="text-ink">{environment}</b>:
          {environment === "staging" ? " dùng để học và test, không bán phòng thật." : " bán phòng thật — cần qua kiểm duyệt (certification) của Channex."}
        </p>
        {channexMsg && (
          <p className={`mt-2 rounded-lg px-3 py-2 text-sm ${channexStatus === "ok" ? "bg-success-soft text-success" : "bg-danger-soft text-danger"}`}>
            {channexMsg}
          </p>
        )}
        {channexProps.length > 0 && (
          <ul className="mt-2 space-y-1 text-sm text-ink">
            {channexProps.map((pr) => (
              <li key={pr.id} className="flex items-center gap-1.5 rounded-lg bg-primary-soft px-3 py-1.5">
                <IconBuilding className="h-4 w-4 shrink-0" /> {pr.title} <span className="text-xs text-muted">({pr.id})</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <ChannexSetup />
      <ChannexSync />
      <ChannexBookings />

      {/* one card per channel — real state from the DB */}
      {loading ? (
        <p className="mt-5 text-sm text-muted">Đang tải trạng thái kênh...</p>
      ) : (
        <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {CHANNELS.map((c) => {
            const isOta = c.type === "ota";
            if (!isOta) {
              return (
                <div key={c.code} className="cb-card p-5">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="font-bold text-ink">{c.name}</div>
                      <div className="text-xs text-muted">
                        {c.type === "direct" ? "Kênh trực tiếp" : "Tại quầy"}
                      </div>
                    </div>
                    <span className="rounded-full bg-[var(--nui-bg)] px-2.5 py-1 text-[11px] font-medium text-muted">
                      Trong PMS
                    </span>
                  </div>
                  <p className="mt-4 text-sm text-muted">
                    Bán trực tiếp trong PMS — không qua Channex, không cần kết nối.
                  </p>
                </div>
              );
            }
            const on = isSelling(c.code);
            const conn = !!connected[c.code];
            return (
              <div key={c.code} className="cb-card p-5">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="font-bold text-ink">{c.name}</div>
                    <div className="text-xs text-muted">OTA — qua Channex</div>
                  </div>
                  <span className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${conn ? "bg-success-soft text-success" : "bg-danger-soft text-danger"}`}>
                    {conn ? "Đã kết nối" : "Chưa kết nối"}
                  </span>
                </div>

                <div className="mt-4 space-y-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-muted">Đang bán trên kênh này</span>
                    <button
                      onClick={() => setSelling(c.code, !on)}
                      disabled={!conn || busyCode === c.code}
                      className={`h-6 w-11 rounded-full p-0.5 transition ${on ? "bg-success" : "bg-line"} disabled:opacity-50`}
                      title={conn ? "Bật/tắt bán trên kênh này (đẩy stop-sell lên Channex)" : "Cần tạo cấu trúc trên Channex trước"}
                    >
                      <span className={`block h-5 w-5 rounded-full bg-surface transition ${on ? "translate-x-5" : ""}`} />
                    </button>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted">Phần trăm cộng thêm</span>
                    <span className="text-ink">Đặt ở Lịch giá</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted">Đồng bộ gần nhất</span>
                    <span className="text-ink">{relTime(lastSyncAt)}</span>
                  </div>
                </div>

                {!conn && (
                  <p className="mt-4 rounded-lg bg-primary-soft px-3 py-2 text-[13px] text-muted">
                    Chưa có gói giá trên Channex — nhập giá ở Lịch giá rồi bấm “Tạo cấu trúc trên Channex” ở thẻ phía trên.
                  </p>
                )}
                {conn && !on && (
                  <p className="mt-4 rounded-lg bg-warning-soft px-3 py-2 text-[13px] text-warning">
                    Đang tắt bán trên kênh này (đã đẩy stop-sell lên Channex).
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}

      <p className="mt-4 text-xs text-muted">
        Trạng thái kênh đọc từ dữ liệu thật: đã kết nối = có gói giá trên Channex; tắt bán = đóng bán trên kênh đó (đẩy stop-sell lên Channex).
        Tắt/bật xong nên bấm “Đồng bộ ngay” ở thẻ phía trên để đẩy ngay, nếu không hàng đợi tự đẩy dần trong vài phút.
      </p>
    </div>
  );
}
