// ============================================================
// CHANNEX COMPUTE — lib/channex-compute.ts
// Tinh cac gia tri Channex (ton phong + gia/restrictions) tu
// Supabase cho 1 danh sach ngay bat ky. Dung chung boi:
//  - The dong bo thu cong (ChannexSync) — cua so 30 ngay.
//  - Hang doi tu dong (channex-outbox) — chi cac ngay vua doi.
// Ton: theo loai phong (quy phong chung - don active - phong
// hong out_of_order). Gia: theo goi OTA; goi ke thua chi gui
// restrictions, Channex tu suy gia tu goi goc.
// ============================================================

import { supabase } from "@/lib/supabase";
import { currentHotelId } from "@/lib/current-hotel";
import { resolvePlanPrice, type RatePlan } from "@/lib/mock-data";

const OTA_CHANNELS = ["booking_com", "expedia", "airbnb", "agoda"];

export const isoDay = (d: Date) => d.toISOString().slice(0, 10);
export const addDaysStr = (s: string, n: number) => {
  const d = new Date(s + "T12:00:00");
  d.setDate(d.getDate() + n);
  return isoDay(d);
};

export type AvailabilityValue = {
  room_type_id: string; // CHANNEX id
  date: string;
  availability: number;
};
export type RestrictionValue = {
  rate_plan_id: string; // CHANNEX id
  date: string;
  rate?: string;
  min_stay_arrival?: number;
  min_stay_through?: number;
  max_stay?: number;
  closed_to_arrival?: boolean;
  closed_to_departure?: boolean;
  stop_sell?: boolean;
};

type RestrictionRow = {
  minStay: number | null;
  maxStay: number | null;
  stopSell: boolean;
  cta: boolean;
  ctd: boolean;
};

export async function computeChannexValues(
  dates: string[],
  hotelId: string = currentHotelId()
): Promise<{
  availability: AvailabilityValue[];
  restrictions: RestrictionValue[];
}> {
  const uniqueDates = [...new Set(dates)].sort();
  if (uniqueDates.length === 0) return { availability: [], restrictions: [] };

  const [typesRes, roomsRes, resRes, rrRes, blocksRes, invRes, plansRes] =
    await Promise.all([
      supabase.from("room_types").select("id, channex_id").eq("hotel_id", hotelId),
      supabase.from("rooms").select("number, room_type_id").eq("hotel_id", hotelId),
      supabase
        .from("reservations")
        .select("id, room_type_id, check_in, check_out, status")
        .eq("hotel_id", hotelId),
      supabase.from("reservation_rooms").select("reservation_id, room_number"),
      supabase
        .from("room_blocks")
        .select("room_number, from_date, to_date, kind")
        .eq("hotel_id", hotelId),
      supabase
        .from("inventory_blocks")
        .select("scope, channel_code, room_type_id, from_date, to_date")
        .eq("hotel_id", hotelId),
      supabase.from("rate_plans").select("*").eq("hotel_id", hotelId),
    ]);
  const loadErr = typesRes.error ?? roomsRes.error ?? resRes.error ?? plansRes.error;
  if (loadErr) throw new Error(loadErr.message);

  const types = (typesRes.data ?? []).filter((t) => t.channex_id);
  const rooms = roomsRes.data ?? [];
  const typeByRoom = new Map(rooms.map((r) => [r.number, r.room_type_id]));
  const roomsByRes = new Map<string, string[]>();
  for (const rr of rrRes.data ?? []) {
    const list = roomsByRes.get(rr.reservation_id) ?? [];
    list.push(rr.room_number);
    roomsByRes.set(rr.reservation_id, list);
  }
  const resIds = new Set((resRes.data ?? []).map((r) => r.id));
  for (const k of [...roomsByRes.keys()]) if (!resIds.has(k)) roomsByRes.delete(k);
  const activeRes = (resRes.data ?? []).filter(
    (r) => r.status === "confirmed" || r.status === "in_house"
  );
  const oooBlocks = (blocksRes.data ?? []).filter((b) => b.kind === "out_of_order");
  const invBlocks = invRes.data ?? [];

  const planRows = plansRes.data ?? [];
  const planObjs: RatePlan[] = planRows.map((p) => ({
    id: p.id,
    channelCode: p.channel_code,
    roomTypeId: p.room_type_id,
    name: p.name,
    cancellationPolicy: (p.cancellation_policy ??
      "flexible") as RatePlan["cancellationPolicy"],
    derivedFromId: p.derived_from_id ?? undefined,
    formulaId: p.formula_id ?? undefined,
    prices: {},
  }));
  const overrides: Record<string, number> = {};
  const rowMap = new Map<string, RestrictionRow>();
  if (planRows.length > 0) {
    // Supabase tra toi da 1000 dong/lan — phai lay theo trang
    type PriceRow = {
      rate_plan_id: string; date: string; price: number;
      min_stay: number | null; max_stay: number | null;
      stop_sell: boolean | null; cta: boolean | null; ctd: boolean | null;
    };
    const priceRows: PriceRow[] = [];
    for (let from = 0; ; from += 1000) {
      const { data: page } = await supabase
        .from("rate_prices")
        .select("*")
        .in("rate_plan_id", planRows.map((p) => p.id))
        .range(from, from + 999);
      priceRows.push(...((page ?? []) as PriceRow[]));
      if (!page || page.length < 1000) break;
    }
    for (const pr of priceRows) {
      const plan = planObjs.find((x) => x.id === pr.rate_plan_id);
      if (!plan) continue;
      if (plan.derivedFromId) overrides[`${pr.rate_plan_id}|${pr.date}`] = pr.price;
      else plan.prices[pr.date] = pr.price;
      rowMap.set(`${pr.rate_plan_id}|${pr.date}`, {
        minStay: pr.min_stay,
        maxStay: pr.max_stay,
        stopSell: !!pr.stop_sell,
        cta: !!pr.cta,
        ctd: !!pr.ctd,
      });
    }
  }
  const channexTypeId = new Map(types.map((t) => [t.id, t.channex_id as string]));
  const channexPlanId = new Map(
    planRows.filter((p) => p.channex_id).map((p) => [p.id, p.channex_id as string])
  );

  // ----- availability per room type -----
  const availability: AvailabilityValue[] = [];
  for (const t of types) {
    for (const date of uniqueDates) {
      const sellable = rooms.filter(
        (r) =>
          r.room_type_id === t.id &&
          !oooBlocks.some(
            (b) => b.room_number === r.number && b.from_date <= date && date <= b.to_date
          )
      ).length;
      let used = 0;
      for (const r of activeRes) {
        if (!(r.check_in <= date && date < r.check_out)) continue;
        const assigned = roomsByRes.get(r.id) ?? [];
        if (assigned.length > 0) {
          used += assigned.filter((n) => typeByRoom.get(n) === t.id).length;
        } else if (r.room_type_id === t.id) used += 1;
      }
      availability.push({
        room_type_id: channexTypeId.get(t.id)!,
        date,
        availability: Math.max(0, sellable - used),
      });
    }
  }

  // ----- rates & restrictions per OTA plan -----
  const restrictions: RestrictionValue[] = [];
  for (const p of planRows) {
    if (!OTA_CHANNELS.includes(p.channel_code)) continue;
    const channexId = channexPlanId.get(p.id);
    if (!channexId) continue;
    const planObj = planObjs.find((x) => x.id === p.id)!;
    for (const date of uniqueDates) {
      const v: RestrictionValue = { rate_plan_id: channexId, date };
      let hasValue = false;
      if (!p.derived_from_id) {
        const price = resolvePlanPrice(planObj, date, planObjs, overrides);
        if (price != null && price > 0) {
          v.rate = price.toFixed(2);
          hasValue = true;
        }
      }
      const row = rowMap.get(`${p.id}|${date}`);
      if (row?.minStay != null) {
        v.min_stay_arrival = row.minStay;
        v.min_stay_through = row.minStay;
        hasValue = true;
      }
      if (row?.maxStay != null) {
        v.max_stay = row.maxStay;
        hasValue = true;
      }
      if (row?.cta) {
        v.closed_to_arrival = true;
        hasValue = true;
      }
      if (row?.ctd) {
        v.closed_to_departure = true;
        hasValue = true;
      }
      const blocked = invBlocks.some(
        (b) =>
          b.from_date <= date &&
          date <= b.to_date &&
          b.room_type_id === p.room_type_id &&
          (b.scope === "room_type" ||
            (b.scope === "channel" && b.channel_code === p.channel_code))
      );
      if (row?.stopSell || blocked) {
        v.stop_sell = true;
        hasValue = true;
      }
      if (hasValue) restrictions.push(v);
    }
  }

  return { availability, restrictions };
}
