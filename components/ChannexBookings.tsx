"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { currentHotelId } from "@/lib/current-hotel";
import { queueChannexDates, stayDates } from "@/lib/channex-outbox";

// ============================================================
// NHAN DON TU CHANNEX (Buoc C4)
// Luong: Keo "phien ban don" (revision) tu Channex -> doi chieu
// mapping (loai phong / goi gia qua channex_id) -> ghi don vao
// Supabase -> ghi nhat ky revision -> bao da nhan (ack).
// Don moi -> confirmed; sua -> cap nhat don cu; huy -> cancelled.
// ============================================================

const HOTEL_ID = currentHotelId();
const ACCOUNT_ID = "11111111-1111-1111-1111-111111111111";

type CxRoom = {
  room_type_id?: string | null;
  rate_plan_id?: string | null;
  checkin_date?: string;
  checkout_date?: string;
  amount?: string;
  occupancy?: { adults?: number; children?: number; infants?: number };
};
type CxAttrs = {
  id: string;
  booking_id: string;
  ota_reservation_code?: string;
  ota_name?: string;
  status: string; // new | modified | cancelled
  rooms?: CxRoom[];
  customer?: { name?: string; surname?: string; phone?: string; mail?: string };
  occupancy?: { adults?: number; children?: number; infants?: number };
  arrival_date?: string;
  departure_date?: string;
  amount?: string;
  payment_collect?: string | null;
  notes?: string | null;
  inserted_at?: string;
};
type CxRevision = { id: string; attributes: CxAttrs };

function channelFromOta(otaName?: string): string {
  const n = (otaName ?? "").toLowerCase();
  if (n.includes("booking")) return "booking_com";
  if (n.includes("expedia")) return "expedia";
  if (n.includes("airbnb")) return "airbnb";
  if (n.includes("agoda")) return "agoda";
  return "frontdesk"; // Offline / khong ro -> tinh nhu don tai quay
}
function newCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const arr = new Uint32Array(10);
  crypto.getRandomValues(arr);
  let s = "";
  arr.forEach((v) => (s += chars[v % chars.length]));
  return s;
}
function money(v?: string): number {
  const n = parseFloat(v ?? "");
  return Number.isFinite(n) ? Math.round(n) : 0;
}
function addDaysStr(base: Date, days: number): string {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

export default function ChannexBookings() {
  const [propertyId, setPropertyId] = useState<string | null>(null);
  const [busy, setBusy] = useState<"" | "pull" | "test">("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lines, setLines] = useState<string[]>([]);

  useEffect(() => {
    supabase
      .from("channel_connections")
      .select("external_property_id, status")
      .eq("hotel_id", HOTEL_ID).eq("provider", "channex")
      .maybeSingle()
      .then(({ data }) => {
        if (data?.status === "connected") setPropertyId(data.external_property_id);
      });
  }, []);

  async function createTestBooking() {
    if (!propertyId) return;
    setBusy("test");
    setError(null);
    setMessage(null);
    try {
      const [typesRes, plansRes] = await Promise.all([
        supabase.from("room_types").select("id, channex_id").eq("hotel_id", HOTEL_ID).not("channex_id", "is", null),
        supabase.from("rate_plans").select("id, channex_id").eq("hotel_id", HOTEL_ID).not("channex_id", "is", null),
      ]);
      const typeId = (typesRes.data ?? []).find((t) => t.id === "deluxe")?.channex_id;
      const planId = (plansRes.data ?? []).find((p) => p.id === "bdc-flex")?.channex_id;
      if (!typeId || !planId)
        throw new Error("Chưa mapping loại phòng/gói giá trên Channex — chạy Bước 1 và 2 trước.");
      const now = new Date();
      const d1 = addDaysStr(now, 3);
      const d2 = addDaysStr(now, 4);
      const d3 = addDaysStr(now, 5);
      const code = "TEST" + String(Date.now()).slice(-6);
      const res = await fetch("/api/channex/test-booking", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          booking: {
            property_id: propertyId,
            ota_name: "Offline",
            ota_reservation_code: code,
            arrival_date: d1,
            departure_date: d3,
            arrival_hour: "15:00",
            currency: "VND",
            payment_collect: "property",
            notes: "Đơn test tạo từ PMS",
            customer: {
              name: "Khách",
              surname: "Test Channex",
              phone: "0900000000",
              mail: "test@example.com",
            },
            rooms: [
              {
                room_type_id: typeId,
                rate_plan_id: planId,
                days: { [d1]: "1000000.00", [d2]: "1000000.00" },
                occupancy: { adults: 2, children: 0, infants: 0, ages: [] },
                guests: [{ name: "Khách", surname: "Test Channex" }],
                services: [],
                taxes: [],
              },
            ],
            services: [],
          },
        }),
      });
      const json = await res.json();
      if (!json.ok)
        throw new Error(
          json.error +
            " — Nếu lỗi nhắc tới app/quyền, vào staging.channex.io, mở khách sạn → mục Apps và cài app «Booking CRS», rồi thử lại."
        );
      setMessage(
        `Đã tạo đơn test trên Channex (mã OTA ${code}, ở ${d1} → ${d3}). Đợi vài giây rồi bấm «Kéo đơn mới về PMS».`
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Tạo đơn test thất bại");
    } finally {
      setBusy("");
    }
  }

  async function pullBookings() {
    if (!propertyId) return;
    setBusy("pull");
    setError(null);
    setMessage(null);
    setLines([]);
    try {
      const res = await fetch("/api/channex/feed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ propertyId }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error ?? "Kéo đơn thất bại");
      const revisions = (json.revisions ?? []) as CxRevision[];
      if (revisions.length === 0) {
        setMessage("Chưa có đơn mới nào trên Channex.");
        return;
      }

      // Du lieu doi chieu
      const [typesRes, plansRes, resvRes, revRes] = await Promise.all([
        supabase.from("room_types").select("id, channex_id").eq("hotel_id", HOTEL_ID),
        supabase.from("rate_plans").select("id, channex_id").eq("hotel_id", HOTEL_ID),
        supabase.from("reservations").select("id, channex_booking_id").eq("hotel_id", HOTEL_ID).not("channex_booking_id", "is", null),
        supabase.from("channex_revisions").select("revision_id").eq("hotel_id", HOTEL_ID),
      ]);
      const typeByChannex = new Map(
        (typesRes.data ?? []).filter((t) => t.channex_id).map((t) => [t.channex_id as string, t.id])
      );
      const planByChannex = new Map(
        (plansRes.data ?? []).filter((p) => p.channex_id).map((p) => [p.channex_id as string, p.id])
      );
      const resByBooking = new Map(
        (resvRes.data ?? []).map((r) => [r.channex_booking_id as string, r.id])
      );
      const processed = new Set((revRes.data ?? []).map((r) => r.revision_id));

      const ackIds: string[] = [];
      const touchedDates: string[] = [];
      const out: string[] = [];
      let nNew = 0,
        nMod = 0,
        nCancel = 0;

      for (const rev of revisions) {
        const a = rev.attributes;
        if (processed.has(rev.id)) {
          ackIds.push(rev.id); // da luu tu truoc, chi can ack not
          continue;
        }
        const rooms = a.rooms ?? [];
        const first = rooms[0] ?? {};
        const roomTypeId = first.room_type_id ? typeByChannex.get(first.room_type_id) : undefined;
        if (!roomTypeId) {
          out.push(`⚠️ Bỏ qua 1 revision: loại phòng trên Channex chưa được mapping.`);
          continue; // khong ack -> van o lai trong feed de xu ly sau
        }
        const ratePlanId = first.rate_plan_id
          ? planByChannex.get(first.rate_plan_id) ?? null
          : null;
        const checkIn = a.arrival_date ?? first.checkin_date ?? addDaysStr(new Date(), 0);
        const checkOut = a.departure_date ?? first.checkout_date ?? checkIn;
        const adults =
          a.occupancy?.adults ??
          rooms.reduce((s, r) => s + (r.occupancy?.adults ?? 0), 0) ??
          2;
        const children =
          a.occupancy?.children ??
          rooms.reduce((s, r) => s + (r.occupancy?.children ?? 0), 0) ??
          0;
        const total =
          money(a.amount) ||
          rooms.reduce((s, r) => s + money(r.amount), 0);
        const collector = a.payment_collect === "ota" ? "channel_collect" : "hotel_collect";
        const guestName =
          [a.customer?.name, a.customer?.surname].filter(Boolean).join(" ").trim() ||
          "Khách OTA";
        const note =
          [
            a.notes ?? null,
            a.ota_reservation_code ? `Mã OTA: ${a.ota_reservation_code}` : null,
            rooms.length > 1 ? `Đơn gồm ${rooms.length} phòng (Channex)` : null,
            `Qua Channex (${a.ota_name ?? "OTA"})`,
          ]
            .filter(Boolean)
            .join(" · ") || null;

        const existingId = resByBooking.get(a.booking_id);
        let reservationId = existingId;
        if (existingId) {
          const patch: Record<string, unknown> = {
            guest_name: guestName,
            guest_phone: a.customer?.phone ?? null,
            channel_code: channelFromOta(a.ota_name),
            payment_collector: collector,
            room_type_id: roomTypeId,
            rate_plan_id: ratePlanId,
            check_in: checkIn,
            check_out: checkOut,
            adults,
            children,
            total_amount: total,
            note,
          };
          if (a.status === "cancelled") patch.status = "cancelled";
          else if (collector === "channel_collect") patch.paid_amount = total;
          const { error: upErr } = await supabase
            .from("reservations")
            .update(patch)
            .eq("id", existingId);
          if (upErr) throw new Error("Cập nhật đơn cũ lỗi: " + upErr.message);
        } else {
          reservationId = newCode();
          const { error: insErr } = await supabase.from("reservations").insert({
            id: reservationId,
            hotel_id: HOTEL_ID,
            account_id: ACCOUNT_ID,
            guest_name: guestName,
            guest_phone: a.customer?.phone ?? null,
            channel_code: channelFromOta(a.ota_name),
            payment_collector: collector,
            room_type_id: roomTypeId,
            rate_plan_id: ratePlanId,
            check_in: checkIn,
            check_out: checkOut,
            adults,
            children,
            total_amount: total,
            paid_amount: collector === "channel_collect" ? total : 0,
            status: a.status === "cancelled" ? "cancelled" : "confirmed",
            note,
            booked_at: a.inserted_at ?? new Date().toISOString(),
            channex_booking_id: a.booking_id,
          });
          if (insErr) throw new Error("Ghi đơn mới lỗi: " + insErr.message);
          resByBooking.set(a.booking_id, reservationId);
        }

        const { error: revErr } = await supabase.from("channex_revisions").insert({
          revision_id: rev.id,
          booking_id: a.booking_id,
          hotel_id: HOTEL_ID,
          account_id: ACCOUNT_ID,
          rev_status: a.status,
          reservation_id: reservationId,
        });
        if (revErr) throw new Error("Ghi nhật ký revision lỗi: " + revErr.message);

        ackIds.push(rev.id);
        touchedDates.push(...stayDates(checkIn, checkOut));
        if (a.status === "cancelled") nCancel += 1;
        else if (existingId) nMod += 1;
        else nNew += 1;
        out.push(
          `${a.status === "cancelled" ? "🚫 Huỷ" : existingId ? "✏️ Sửa" : "🆕 Mới"}: ${guestName} — ${checkIn} → ${checkOut} — ${total.toLocaleString("vi-VN")}₫ (đơn PMS ${reservationId})`
        );
      }

      if (ackIds.length > 0) {
        const ackRes = await fetch("/api/channex/ack", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ revisionIds: ackIds }),
        });
        const ackJson = await ackRes.json().catch(() => null);
        if (!ackJson?.ok)
          out.push("⚠️ Đơn đã lưu nhưng ack về Channex chưa trọn — kéo lại lần nữa sẽ chỉ ack bổ sung.");
      }
      // Don moi/sua/huy lam ton phong thay doi -> day lai cac dem lien quan
      if (touchedDates.length > 0) queueChannexDates([...new Set(touchedDates)]);
      setLines(out);
      setMessage(
        `Đã nhận từ Channex: ${nNew} đơn mới, ${nMod} đơn sửa, ${nCancel} đơn huỷ. Xem ở trang Đặt phòng / Lịch phòng.`
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Nhận đơn thất bại");
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="cb-card" style={{ padding: 16 }}>
      <div style={{ fontWeight: 700, fontSize: 15 }}>Nhận đơn từ Channex</div>
      <p style={{ color: "#68707a", fontSize: 13, margin: "6px 0 12px" }}>
        Đơn đặt trên các kênh bán (qua Channex) sẽ được kéo về PMS tại đây. Đơn đã lưu thành công
        mới được báo đã nhận cho Channex, kéo lại không bị trùng.
      </p>
      {!propertyId ? (
        <div style={{ color: "#b45309", fontSize: 13 }}>
          Chưa kết nối Channex — hãy chạy Bước 1 ở thẻ phía trên trước.
        </div>
      ) : (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            className="cb-btn-primary"
            onClick={pullBookings}
            disabled={busy !== ""}
            style={{ padding: "8px 14px", fontSize: 13 }}
          >
            {busy === "pull" ? "Đang kéo đơn..." : "Kéo đơn mới về PMS"}
          </button>
          <button
            className="cb-btn-ghost"
            onClick={createTestBooking}
            disabled={busy !== ""}
            style={{ padding: "8px 14px", fontSize: 13 }}
          >
            {busy === "test" ? "Đang tạo..." : "Tạo đơn test trên Channex"}
          </button>
        </div>
      )}
      {message && (
        <div
          style={{
            marginTop: 12,
            background: "#e8f7f1",
            color: "#0d7a55",
            borderRadius: 8,
            padding: "8px 10px",
            fontSize: 13,
          }}
        >
          {message}
        </div>
      )}
      {lines.length > 0 && (
        <div style={{ marginTop: 8, fontSize: 13, color: "#17293e", lineHeight: 1.7 }}>
          {lines.map((l, i) => (
            <div key={i}>{l}</div>
          ))}
        </div>
      )}
      {error && (
        <div
          style={{
            marginTop: 12,
            background: "#fdecec",
            color: "#b42318",
            borderRadius: 8,
            padding: "8px 10px",
            fontSize: 13,
          }}
        >
          {error}
        </div>
      )}
    </div>
  );
}
