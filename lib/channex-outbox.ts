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

// Nhung ngay tinh gia tri Channex that bai (loi DB/mang khi
// tinh): truoc day chi ghi console.warn roi mat luon — chip
// van hien "da dong bo" trong khi Channex chua nhan duoc gi.
// Gio luu lai de chip canh bao va cho thu lai.
export type QueueError = { hotelId: string; dates: string[]; message: string; at: string };
const queueErrors = new Map<string, QueueError>();

export function getChannexQueueErrors(): QueueError[] {
  return [...queueErrors.values()];
}

// Tinh lai cac ngay loi truoc do va xep hang doi. Thanh cong
// thi xoa loi; that bai thi giu nguyen de chip van canh bao.
export async function retryChannexQueue(hotelId: string): Promise<void> {
  const err = queueErrors.get(hotelId);
  if (!err) return;
  const { availability, restrictions } = await computeChannexValues(err.dates, hotelId);
  await enqueueValues(availability, restrictions, hotelId);
  queueErrors.delete(hotelId);
  window.dispatchEvent(new Event("channex-queue-error"));
}

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
  // Bao chip dong bo ngay co thay doi moi (truoc ca 1,5 giay cho
  // gom ngay): chip chuyen sang "dang cho gui" thay vi van hien
  // "da dong bo" cua lan dong bo truoc.
  if (added) window.dispatchEvent(new Event("channex-pending"));
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
          // Giu lai ngay loi de chip dong bo canh bao + cho thu
          // lai — truoc day chi ghi console roi mat luon.
          const msg = e instanceof Error ? e.message : "Lỗi tính giá trị Channex";
          queueErrors.set(hid, { hotelId: hid, dates: [...set], message: msg, at: new Date().toISOString() });
          window.dispatchEvent(new Event("channex-queue-error"));
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

// Ghi them vao channel_connections.settings (jsonb) ma khong xoa
// cac khoa khac — dung de luu dau thoi gian dong bo gan nhat
// (last_sync_at) va hoa hong tung kenh (commissions) cho trang
// Kênh bán đọc. Chi la thong tin phu: loi thi bo qua, khong
// bao nguoi dung.
export async function patchChannelSettings(hotelId: string, patch: Record<string, unknown>) {
  try {
    const { data } = await supabase
      .from("channel_connections")
      .select("settings")
      .eq("hotel_id", hotelId)
      .eq("provider", "channex")
      .maybeSingle();
    if (!data) return;
    await supabase
      .from("channel_connections")
      .update({ settings: { ...((data.settings ?? {}) as Record<string, unknown>), ...patch } })
      .eq("hotel_id", hotelId)
      .eq("provider", "channex");
  } catch {
    // bo qua
  }
}
