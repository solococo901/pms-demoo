// ============================================================
// CHANNEX OUTBOX — lib/channex-outbox.ts
// Hang doi dong bo: moi thay doi trong PMS duoc tinh lai thanh
// gia tri Channex va ghi vao bang channex_outbox (trang thai
// pending). Bo gui nen (ChannexOutbox) dinh ky lay cac muc
// pending gui len Channex qua /api/channex/sync; gui xong danh
// dau sent, loi thi cong attempts va thu lai sau (toi da 5 lan).
// ============================================================

import { supabase } from "@/lib/supabase";
import { currentHotelId } from "@/lib/current-hotel";
import {
  addDaysStr,
  computeChannexValues,
  isoDay,
  type AvailabilityValue,
  type RestrictionValue,
} from "@/lib/channex-compute";

const ACCOUNT_ID = "11111111-1111-1111-1111-111111111111";
const MAX_ATTEMPTS = 5;

async function enqueueValues(
  availability: AvailabilityValue[],
  restrictions: RestrictionValue[],
  hotelId: string
) {
  const rows = [
    ...availability.map((v) => ({
      hotel_id: hotelId,
      account_id: ACCOUNT_ID,
      kind: "availability",
      dedupe_key: `availability|${v.room_type_id}|${v.date}`,
      payload: v as unknown as Record<string, unknown>,
    })),
    ...restrictions.map((v) => ({
      hotel_id: hotelId,
      account_id: ACCOUNT_ID,
      kind: "restrictions",
      dedupe_key: `restrictions|${v.rate_plan_id}|${v.date}`,
      payload: v as unknown as Record<string, unknown>,
    })),
  ];
  if (rows.length === 0) return;
  // Ban choi moi thay the ban choi cu chua gui (cung khoa)
  await supabase
    .from("channex_outbox")
    .delete()
    .eq("hotel_id", hotelId)
    .eq("status", "pending")
    .in("dedupe_key", rows.map((r) => r.dedupe_key));
  const { error } = await supabase.from("channex_outbox").insert(rows);
  if (error) throw new Error("Ghi hàng đợi Channex lỗi: " + error.message);
  window.dispatchEvent(new Event("channex-outbox"));
}

// Tinh lai + xep hang doi cho cac ngay vua thay doi.
// Goi duoc tu moi diem luu trong PMS: cac ngay duoc GOM lai,
// sau 1,5 giay im lang moi tinh 1 lan (sua hang loat khong
// phai tinh lai tung o).
const pendingByHotel = new Map<string, Set<string>>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

export function queueChannexDates(dates: string[], hotelId: string = currentHotelId()) {
  const today = isoDay(new Date());
  let added = false;
  for (const d of dates) {
    if (d >= today) {
      if (!pendingByHotel.has(hotelId)) pendingByHotel.set(hotelId, new Set());
      pendingByHotel.get(hotelId)!.add(d);
      added = true;
    }
  }
  if (!added || flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    const jobs = [...pendingByHotel.entries()];
    pendingByHotel.clear();
    void (async () => {
      for (const [hid, set] of jobs) {
        try {
          const { availability, restrictions } = await computeChannexValues([...set], hid);
          await enqueueValues(availability, restrictions, hid);
        } catch (e) {
          console.warn("Channex queue:", e);
        }
      }
    })();
  }, 1500);
}

export type DrainResult = { sent: number; pending: number; failed: number };

// Gui tat ca muc pending (toi da 300) len Channex.
export async function drainChannexOutbox(hotelId: string, propertyId: string): Promise<DrainResult> {
  const { data: rows, error } = await supabase
    .from("channex_outbox")
    .select("id, kind, payload, attempts")
    .eq("hotel_id", hotelId)
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(300);
  if (error) throw new Error(error.message);
  if (!rows || rows.length === 0) return { sent: 0, pending: 0, failed: 0 };

  const availability = rows
    .filter((r) => r.kind === "availability")
    .map((r) => r.payload);
  const restrictions = rows
    .filter((r) => r.kind === "restrictions")
    .map((r) => r.payload);

  const res = await fetch("/api/channex/sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ propertyId, availability, restrictions }),
  });
  const data = await res.json().catch(() => null);

  if (data?.ok) {
    await supabase
      .from("channex_outbox")
      .update({ status: "sent", sent_at: new Date().toISOString(), last_error: null })
      .in("id", rows.map((r) => r.id));
    return { sent: rows.length, pending: 0, failed: 0 };
  }

  const errMsg = data?.error ?? `Channex sync HTTP ${res.status}`;
  let failed = 0;
  for (const r of rows) {
    const attempts = (r.attempts ?? 0) + 1;
    const giveUp = attempts >= MAX_ATTEMPTS;
    if (giveUp) failed += 1;
    await supabase
      .from("channex_outbox")
      .update({
        attempts,
        last_error: errMsg,
        status: giveUp ? "failed" : "pending",
      })
      .eq("id", r.id);
  }
  throw new Error(errMsg);
}

export async function countPendingOutbox(hotelId: string): Promise<number> {
  const { count } = await supabase
    .from("channex_outbox")
    .select("id", { count: "exact", head: true })
    .eq("hotel_id", hotelId)
    .eq("status", "pending");
  return count ?? 0;
}

// Cac dem cua 1 luot o: check_in .. truoc check_out.
export function stayDates(checkIn: string, checkOut: string): string[] {
  const out: string[] = [];
  for (let d = checkIn; d < checkOut && out.length < 370; d = addDaysStr(d, 1))
    out.push(d);
  return out;
}

// Moi ngay trong khoang from..to (gom ca ngay cuoi) — cho cac
// khoang chan phong / dong ban.
export function rangeDates(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to && out.length < 370; d = addDaysStr(d, 1)) out.push(d);
  return out;
}
