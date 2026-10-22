"use client";
// ============================================================
// FILE BP2 — components/RatesCalendar.tsx (ezCloud-style
// "Ban phong" selling grid, Cloudbeds palette)
// Replaces the old per-channel rates grid. What it does:
//   - TWO views like ezCloud: by room type / by channel, plus
//     the all-channel price comparison (parity) view
//   - Stacked rows per plan: "Phong trong" (rooms left, SHARED
//     by all channels and now EXCLUDING out-of-order rooms),
//     "Gia ban" (price), "Ngung ban" (stop-sell) toggle row
//   - Long date strip (14 days, navigate with arrows or pick a
//     start date); weekend columns tinted red using the hotel
//     config's own weekend days
//   - INHERITED prices (ke thua): a derived plan shows badge
//     (C) and its price is computed live from its base plan (M)
//     with a formula; editing a derived cell creates a SPECIAL
//     price for that date only (overrides the formula)
//   - Restrictions per plan + date: stop-sell, min stay, max
//     stay, closed-to-arrival, closed-to-departure. Restrictions
//     are NOT inherited — every plan carries its own.
//   - Bulk update over a date range + weekday mask (the
//     interval tool), formula list panel, plan settings card
//     (public name, meal plan, extra-guest fees, inheritance)
//   - Channex sync badge stays: edits mark the channel dirty
// ============================================================

import { useEffect, useMemo, useState } from "react";
import {
  CHANNELS,
  INVENTORY_BLOCKS,
  PRICE_FORMULAS,
  RATE_PLANS,
  RESERVATIONS,
  ROOM_BLOCKS,
  ROOMS,
  ROOM_TYPES,
  TODAY,
  getFormula,
  getHotelData,
  inventoryBlockOn,
  mealPlanLabel,
  resolvePlanPrice,
  roomBlockOn,
  type InventoryBlock,
  type RatePlan,
  type RoomType,
} from "@/lib/mock-data";
import { supabase } from "@/lib/supabase";
import { currentHotelId } from "@/lib/current-hotel";
import { queueChannexDates, rangeDates } from "@/lib/channex-outbox";

// Round B (Buoc 4.3): rate plans + daily prices/restrictions are
// loaded from Supabase and every edit is saved back to the
// rate_plans / rate_prices tables. Availability inputs (rooms,
// reservations, blocks) still come from the sample data in this
// step — they move to the database in the next one.
const HOTEL_ID = currentHotelId();
const ACCOUNT_ID = "11111111-1111-1111-1111-111111111111";

// ---------- date helpers ----------
const DAY_MS = 86_400_000;
const toTime = (d: string) => new Date(d + "T00:00:00Z").getTime();
const toISO = (t: number) => new Date(t).toISOString().slice(0, 10);
const addDays = (d: string, n: number) => toISO(toTime(d) + n * DAY_MS);
const WEEKDAYS = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];
const dayParts = (d: string) => {
  const date = new Date(d + "T00:00:00");
  return { wd: WEEKDAYS[date.getDay()], label: `${date.getDate()}/${date.getMonth() + 1}`, dow: date.getDay() };
};
const fmt = (n: number) => n.toLocaleString("vi-VN");
const WINDOW = 14;

type Restriction = { stopSell?: boolean; minStay?: number; maxStay?: number; cta?: boolean; ctd?: boolean };
type CellKey = string; // `${planId}|${date}`
const keyOf = (planId: string, date: string): CellKey => `${planId}|${date}`;

const inputCls = "rounded-lg border border-[#dde3ea] px-2 py-2 text-[#17293e] outline-none focus:border-[#2563eb]";
const WEEKEND_DAYS: number[] = getHotelData("cityhouse-mark").config?.weekendDays ?? [0, 6];

type ViewMode = "byType" | "byChannel" | "compare";

export default function RatesCalendar() {
  const [viewMode, setViewMode] = useState<ViewMode>("byType");
  const [channel, setChannel] = useState<string>("booking_com"); // used in byType view
  const [roomTypeId, setRoomTypeId] = useState<string>("deluxe"); // used in byChannel view
  const [typeFilter, setTypeFilter] = useState<string>("all"); // used in byType view
  const [startDate, setStartDate] = useState<string>(TODAY);
  const [showStopRow, setShowStopRow] = useState(true);
  const [showMarkers, setShowMarkers] = useState(true);

  // editable copies of the mock data
  const [plans, setPlans] = useState<RatePlan[]>(RATE_PLANS.map((p) => ({ ...p, prices: { ...p.prices } })));
  const [roomTypesDb, setRoomTypesDb] = useState<RoomType[]>(ROOM_TYPES);
  const [restrictions, setRestrictions] = useState<Record<CellKey, Restriction>>({});
  const [overrides, setOverrides] = useState<Record<CellKey, number>>({}); // special prices of derived plans
  const [invBlocks, setInvBlocks] = useState<InventoryBlock[]>(INVENTORY_BLOCKS); // stop-sell level 2 & 3
  // Availability inputs (rooms / reservations / room blocks):
  // start as the sample data, replaced by database rows when
  // the loader finishes — the grid and the staff calendar now
  // share ONE source of truth (Buoc 4.4b).
  const [roomsDb, setRoomsDb] = useState(ROOMS);
  const [reservationsDb, setReservationsDb] = useState(RESERVATIONS);
  const [roomBlocksDb, setRoomBlocksDb] = useState(ROOM_BLOCKS);
  const [dirtyChannels, setDirtyChannels] = useState<Set<string>>(new Set());
  const [dbError, setDbError] = useState("");

  const [selected, setSelected] = useState<{ planId: string; date: string } | null>(null);
  const [settingsPlanId, setSettingsPlanId] = useState<string | null>(null);
  const [showBulk, setShowBulk] = useState(false);
  const [showFormulas, setShowFormulas] = useState(false);
  const [showInvPanel, setShowInvPanel] = useState(false);

  // add-inventory-block form state
  const [ibScope, setIbScope] = useState<"channel" | "room_type">("channel");
  const [ibChannel, setIbChannel] = useState<string>("airbnb");
  const [ibType, setIbType] = useState<string>("deluxe");
  const [ibFrom, setIbFrom] = useState(TODAY);
  const [ibTo, setIbTo] = useState(addDays(TODAY, 2));
  const [ibReason, setIbReason] = useState("");

  // bulk update state
  const [bulkPlanId, setBulkPlanId] = useState<string>("");
  const [bulkFrom, setBulkFrom] = useState(TODAY);
  const [bulkTo, setBulkTo] = useState(addDays(TODAY, 13));
  const [bulkDays, setBulkDays] = useState<number[]>([0, 1, 2, 3, 4, 5, 6]);
  const [bulkMode, setBulkMode] = useState<"set" | "percent" | "amount">("percent");
  const [bulkValue, setBulkValue] = useState<number>(10);

  const days = useMemo(() => Array.from({ length: WINDOW }, (_, i) => addDays(startDate, i)), [startDate]);

  // Rooms left per room type per day — ONE shared pool for all
  // channels. A room is sellable on a night unless an
  // out-of-order BLOCK covers that night (dated blocks, audit
  // A3). Out-of-service blocks do NOT subtract (still inventory).
  const roomsLeftByType = useMemo(() => {
    const roomTypeOf = (num: string) => roomsDb.find((r) => r.number === num)?.roomTypeId;
    const map: Record<string, number[]> = {};
    for (const t of roomTypesDb) {
      const typeRooms = roomsDb.filter((r) => r.roomTypeId === t.id);
      map[t.id] = days.map((day) => {
        const sellable = typeRooms.filter((r) => !roomBlockOn(roomBlocksDb, r.number, day, "out_of_order")).length;
        let used = 0;
        for (const r of reservationsDb) {
          if (["cancelled", "no_show", "checked_out"].includes(r.status)) continue;
          if (!(r.checkIn <= day && day < r.checkOut)) continue;
          const inType = r.roomNumbers.filter((n) => roomTypeOf(n) === t.id).length;
          used += inType > 0 ? inType : r.roomNumbers.length === 0 && r.roomTypeId === t.id ? 1 : 0;
        }
        return sellable - used;
      });
    }
    return map;
  }, [days, roomsDb, reservationsDb, roomBlocksDb, roomTypesDb]);

  function markDirty(code: string) {
    setDirtyChannels((prev) => new Set(prev).add(code));
  }

  // ---------- Supabase: load plans + daily prices on mount ----------
  useEffect(() => {
    (async () => {
      const [typesRes, plansRes, pricesRes, roomsRes, resRes, rrRes, blocksRes, invRes] = await Promise.all([
        supabase.from("room_types").select("*").eq("hotel_id", HOTEL_ID),
        supabase.from("rate_plans").select("*").eq("hotel_id", HOTEL_ID),
        supabase.from("rate_prices").select("*"),
        supabase.from("rooms").select("*").eq("hotel_id", HOTEL_ID),
        supabase.from("reservations").select("*").eq("hotel_id", HOTEL_ID),
        supabase.from("reservation_rooms").select("reservation_id, room_number"),
        supabase.from("room_blocks").select("*").eq("hotel_id", HOTEL_ID),
        supabase.from("inventory_blocks").select("*").eq("hotel_id", HOTEL_ID),
      ]);
      const loadErr = plansRes.error ?? pricesRes.error ?? roomsRes.error ?? resRes.error ?? rrRes.error ?? blocksRes.error ?? invRes.error;
      if (loadErr) {
        setDbError(loadErr.message ?? "Không đọc được dữ liệu");
        return;
      }
      if ((typesRes.data ?? []).length > 0) {
        setRoomTypesDb(
          (typesRes.data ?? []).map((t) => ({
            id: t.id, code: t.code ?? undefined, name: t.name,
            maxOccupancy: t.max_occupancy, maxAdults: t.max_adults,
            maxChildren: t.max_children, maxInfants: t.max_infants,
            bedConfig: t.bed_config ?? "", sizeM2: t.size_sqm ?? undefined,
            priceFloor: t.min_price ?? undefined, priceCeiling: t.max_price ?? undefined,
            active: t.active,
          }))
        );
      }
      const dbPlans: RatePlan[] = (plansRes.data ?? []).map((row) => ({
        id: row.id,
        channelCode: row.channel_code,
        roomTypeId: row.room_type_id,
        name: row.name,
        cancellationPolicy: row.cancellation_policy as RatePlan["cancellationPolicy"],
        prices: {},
        publicName: row.public_name ?? undefined,
        mealPlan: row.meal_plan as RatePlan["mealPlan"],
        baseOccupancy: row.base_occupancy,
        extraAdultFee: Number(row.extra_adult_fee),
        extraChildFee: Number(row.extra_child_fee),
        derivedFromId: row.derived_from_id ?? undefined,
        formulaId: row.formula_id ?? undefined,
      }));
      const planIds = new Set(dbPlans.map((p) => p.id));
      // Supabase tra toi da 1000 dong/lan — lay them cac trang sau
      let allPriceRows = pricesRes.data ?? [];
      if (allPriceRows.length >= 1000) {
        for (let from = 1000; ; from += 1000) {
          const { data: page } = await supabase
            .from("rate_prices").select("*").range(from, from + 999);
          allPriceRows = [...allPriceRows, ...(page ?? [])];
          if (!page || page.length < 1000) break;
        }
      }
      const rows = allPriceRows.filter((r) => planIds.has(r.rate_plan_id));
      for (const row of rows) {
        const plan = dbPlans.find((p) => p.id === row.rate_plan_id);
        if (plan && !plan.derivedFromId) plan.prices[row.date] = Number(row.price);
      }
      const dbRestrictions: Record<CellKey, Restriction> = {};
      const dbOverrides: Record<CellKey, number> = {};
      for (const row of rows) {
        const plan = dbPlans.find((p) => p.id === row.rate_plan_id);
        if (!plan) continue;
        const restr: Restriction = {};
        if (row.min_stay != null) restr.minStay = row.min_stay;
        if (row.max_stay != null) restr.maxStay = row.max_stay;
        if (row.stop_sell) restr.stopSell = true;
        if (row.cta) restr.cta = true;
        if (row.ctd) restr.ctd = true;
        if (Object.keys(restr).length > 0) dbRestrictions[keyOf(row.rate_plan_id, row.date)] = restr;
        // A derived plan's row is a SPECIAL price only when it
        // differs from the formula price; an equal-price row just
        // carries that date's restrictions.
        if (plan.derivedFromId && resolvePlanPrice(plan, row.date, dbPlans, {}) !== Number(row.price)) {
          dbOverrides[keyOf(row.rate_plan_id, row.date)] = Number(row.price);
        }
      }
      setPlans(dbPlans);
      setRestrictions(dbRestrictions);
      setOverrides(dbOverrides);

      // ---------- availability inputs from the database ----------
      setRoomsDb(
        (roomsRes.data ?? []).map((r) => ({
          number: r.number,
          roomTypeId: r.room_type_id,
          housekeepingStatus: r.housekeeping_status,
        }))
      );
      const roomsMap = new Map<string, string[]>();
      for (const row of rrRes.data ?? []) {
        const list = roomsMap.get(row.reservation_id) ?? [];
        list.push(row.room_number);
        roomsMap.set(row.reservation_id, list);
      }
      setReservationsDb(
        (resRes.data ?? []).map((r) => ({
          id: r.id,
          guestName: r.guest_name,
          guestPhone: r.guest_phone ?? "",
          channelCode: r.channel_code,
          paymentCollector: r.payment_collector,
          roomNumbers: roomsMap.get(r.id) ?? [],
          roomTypeId: r.room_type_id,
          ratePlanId: r.rate_plan_id ?? "",
          checkIn: r.check_in,
          checkOut: r.check_out,
          guests: (r.adults ?? 0) + (r.children ?? 0),
          adults: r.adults,
          children: r.children,
          totalAmount: r.total_amount,
          paidAmount: r.paid_amount,
          status: r.status,
          createdAt: String(r.booked_at).slice(0, 10),
          note: r.note ?? undefined,
        }))
      );
      setRoomBlocksDb(
        (blocksRes.data ?? []).map((b) => ({
          id: b.id,
          roomNumber: b.room_number,
          from: b.from_date,
          to: b.to_date,
          kind: b.kind,
          reason: b.reason ?? "",
        }))
      );
      setInvBlocks(
        (invRes.data ?? []).map((b) => ({
          id: b.id,
          scope: b.scope,
          channelCode: b.channel_code ?? undefined,
          roomTypeId: b.room_type_id,
          from: b.from_date,
          to: b.to_date,
          reason: b.reason ?? undefined,
        }))
      );
    })();
  }, []);

  // ---------- Supabase: save one cell (price + restrictions) ----------
  async function persistCell(planId: string, date: string, price: number, restr?: Restriction) {
    const r = restr ?? restrictions[keyOf(planId, date)] ?? {};
    const { error } = await supabase.from("rate_prices").upsert({
      rate_plan_id: planId,
      date,
      price,
      min_stay: r.minStay ?? null,
      max_stay: r.maxStay ?? null,
      stop_sell: !!r.stopSell,
      cta: !!r.cta,
      ctd: !!r.ctd,
    });
    if (error) setDbError("Lưu giá không thành công: " + error.message);
    else queueChannexDates([date]);
  }

  function patchPlan(planId: string, patch: Partial<RatePlan>) {
    setPlans((prev) => prev.map((p) => (p.id === planId ? { ...p, ...patch } : p)));
    const plan = plans.find((p) => p.id === planId);
    if (plan) markDirty(plan.channelCode);
    // persist the settings fields that live on the rate_plans table
    const dbPatch: Record<string, unknown> = {};
    if (patch.publicName !== undefined) dbPatch.public_name = patch.publicName;
    if (patch.mealPlan !== undefined) dbPatch.meal_plan = patch.mealPlan;
    if (patch.baseOccupancy !== undefined) dbPatch.base_occupancy = patch.baseOccupancy;
    if (patch.extraAdultFee !== undefined) dbPatch.extra_adult_fee = patch.extraAdultFee;
    if (patch.extraChildFee !== undefined) dbPatch.extra_child_fee = patch.extraChildFee;
    if (patch.name !== undefined) dbPatch.name = patch.name;
    if (patch.cancellationPolicy !== undefined) dbPatch.cancellation_policy = patch.cancellationPolicy;
    if ("derivedFromId" in patch) dbPatch.derived_from_id = patch.derivedFromId ?? null;
    if ("formulaId" in patch) dbPatch.formula_id = patch.formulaId ?? null;
    if (Object.keys(dbPatch).length > 0) {
      supabase
        .from("rate_plans")
        .update(dbPatch)
        .eq("id", planId)
        .then(({ error }) => {
          if (error) setDbError("Lưu cài đặt gói không thành công: " + error.message);
        });
    }
    // Doi cong thuc / goi goc -> gia ke thua thay doi tren moi ngay
    if ("derivedFromId" in patch || "formulaId" in patch) {
      const today = new Date().toISOString().slice(0, 10);
      queueChannexDates(rangeDates(today, addDays(today, 30)));
    }
  }

  function setPrice(planId: string, date: string, price: number) {
    const plan = plans.find((p) => p.id === planId);
    if (!plan) return;
    if (plan.derivedFromId) {
      // editing a derived plan's cell = SPECIAL price for that date
      setOverrides((prev) => ({ ...prev, [keyOf(planId, date)]: price }));
    } else {
      setPlans((prev) => prev.map((p) => (p.id === planId ? { ...p, prices: { ...p.prices, [date]: price } } : p)));
    }
    markDirty(plan.channelCode);
    persistCell(planId, date, price);
  }

  function clearSpecial(planId: string, date: string) {
    setOverrides((prev) => {
      const next = { ...prev };
      delete next[keyOf(planId, date)];
      return next;
    });
    const plan = plans.find((p) => p.id === planId);
    if (plan) {
      markDirty(plan.channelCode);
      // Back to the formula price in the database too: keep the
      // row (rewritten at the formula price) only when the date
      // carries restrictions, otherwise remove the row entirely.
      const r = restrictions[keyOf(planId, date)] ?? {};
      const hasRestr = r.minStay !== undefined || r.maxStay !== undefined || r.stopSell || r.cta || r.ctd;
      const without = { ...overrides };
      delete without[keyOf(planId, date)];
      if (hasRestr) {
        persistCell(planId, date, resolvePlanPrice(plan, date, plans, without) ?? 0, r);
      } else {
        supabase
          .from("rate_prices")
          .delete()
          .eq("rate_plan_id", planId)
          .eq("date", date)
          .then(({ error }) => {
            if (error) setDbError("Xoá giá đặc biệt không thành công: " + error.message);
            else queueChannexDates([date]);
          });
      }
    }
  }

  function setRestriction(planId: string, date: string, patch: Restriction) {
    const merged = { ...restrictions[keyOf(planId, date)], ...patch };
    setRestrictions((prev) => ({ ...prev, [keyOf(planId, date)]: merged }));
    const plan = plans.find((p) => p.id === planId);
    if (plan) {
      markDirty(plan.channelCode);
      persistCell(planId, date, resolvePlanPrice(plan, date, plans, overrides) ?? 0, merged);
    }
  }

  function pushToChannex(code: string) {
    // Simulated for now — Round B calls the real Channex API here.
    setDirtyChannels((prev) => {
      const next = new Set(prev);
      next.delete(code);
      return next;
    });
  }

  async function addInvBlock() {
    if (!ibFrom || !ibTo || ibTo < ibFrom) return;
    const nb: InventoryBlock = {
      id: `ib-${Date.now()}`,
      scope: ibScope,
      channelCode: ibScope === "channel" ? ibChannel : undefined,
      roomTypeId: ibType,
      from: ibFrom,
      to: ibTo,
      reason: ibReason || undefined,
    };
    const { error } = await supabase.from("inventory_blocks").insert({
      id: nb.id, hotel_id: HOTEL_ID, account_id: ACCOUNT_ID,
      scope: nb.scope, channel_code: nb.channelCode ?? null, room_type_id: nb.roomTypeId,
      from_date: nb.from, to_date: nb.to, reason: nb.reason ?? null,
    });
    if (error) return alert("Lưu đóng bán không thành công: " + error.message);
    setInvBlocks((prev) => [...prev, nb]);
    queueChannexDates(rangeDates(nb.from, nb.to));
    if (nb.scope === "channel" && nb.channelCode) markDirty(nb.channelCode);
    else CHANNELS.filter((c) => c.type === "ota").forEach((c) => markDirty(c.code));
    setIbReason("");
  }

  async function removeInvBlock(id: string) {
    const blk = invBlocks.find((b) => b.id === id);
    const { error } = await supabase.from("inventory_blocks").delete().eq("id", id);
    if (error) return alert("Xoá đóng bán không thành công: " + error.message);
    setInvBlocks((prev) => prev.filter((b) => b.id !== id));
    if (blk) queueChannexDates(rangeDates(blk.from, blk.to));
  }

  // ---------- bulk update (interval tool) ----------
  const bulkPlan = plans.find((p) => p.id === bulkPlanId) ?? plans.find((p) => p.channelCode === channel) ?? plans[0];
  const bulkDates = useMemo(() => {
    const out: string[] = [];
    if (!bulkFrom || !bulkTo || bulkTo < bulkFrom) return out;
    for (let d = bulkFrom; d <= bulkTo && out.length <= 62; d = addDays(d, 1)) {
      if (bulkDays.includes(dayParts(d).dow)) out.push(d);
    }
    return out;
  }, [bulkFrom, bulkTo, bulkDays]);

  function applyBulk() {
    if (!bulkPlan) return;
    for (const date of bulkDates) {
      const current = resolvePlanPrice(bulkPlan, date, plans, overrides) ?? 0;
      const next =
        bulkMode === "set" ? bulkValue : bulkMode === "percent" ? Math.round((current * (1 + bulkValue / 100)) / 1000) * 1000 : current + bulkValue;
      setPrice(bulkPlan.id, date, next);
    }
  }

  const selectedPlan = plans.find((p) => p.id === selected?.planId);
  const selectedRestriction = selected ? restrictions[keyOf(selected.planId, selected.date)] : undefined;
  const settingsPlan = plans.find((p) => p.id === settingsPlanId);
  const planName = (id?: string) => plans.find((p) => p.id === id)?.name ?? id ?? "";

  // ---------- shared grid pieces ----------
  const gridCols = { gridTemplateColumns: `230px repeat(${days.length}, minmax(88px, 1fr))` } as const;

  function DateHeader() {
    return (
      <div className="contents">
        <div className="sticky left-0 z-10 border-b border-[#eef1f5] bg-[#f7f9fb] px-3 py-2 text-xs font-semibold text-[#68707a]">Ngày →</div>
        {days.map((d) => {
          const p = dayParts(d);
          const weekend = WEEKEND_DAYS.includes(p.dow);
          return (
            <div key={d} className={`border-b border-l border-[#eef1f5] px-2 py-2 text-center text-xs font-semibold ${weekend ? "bg-[#fdf0f0] text-[#e5484d]" : "bg-[#f7f9fb] text-[#68707a]"}`}>
              {p.wd} · {p.label}
              {d === TODAY && <div className="text-[10px] font-bold text-[#2563eb]">HÔM NAY</div>}
            </div>
          );
        })}
      </div>
    );
  }

  function RoomsLeftRow({ typeId }: { typeId: string }) {
    const left = roomsLeftByType[typeId] ?? [];
    return (
      <div className="contents">
        <div className="sticky left-0 z-10 border-b border-[#eef1f5] bg-white px-3 py-2 text-sm text-[#68707a]">Phòng trống (chung mọi kênh)</div>
        {left.map((n, i) => (
          <div key={i} className={`border-b border-l border-[#eef1f5] px-2 py-2 text-center text-sm font-bold ${n <= 0 ? "bg-[#fde9c8] text-[#e5484d]" : n === 1 ? "text-[#e5484d]" : "text-[#17293e]"}`}>
            {n}
          </div>
        ))}
      </div>
    );
  }

  function PlanRows({ plan }: { plan: RatePlan }) {
    const derived = !!plan.derivedFromId;
    const formula = getFormula(plan.formulaId);
    return (
      <div className="contents">
        {/* price row */}
        <div className="sticky left-0 z-10 border-b border-[#eef1f5] bg-white px-3 py-2">
          <div className="flex items-center gap-1.5">
            <span
              className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white ${derived ? "bg-[#0ea5a4]" : "bg-[#2563eb]"}`}
              title={derived ? "Gói lưu trú kế thừa" : "Gói lưu trú cơ sở"}
            >
              {derived ? "C" : "M"}
            </span>
            <button onClick={() => setSettingsPlanId(plan.id)} className="text-left text-sm font-medium text-[#17293e] hover:text-[#2563eb]" title="Mở cài đặt gói giá">
              {plan.name} ✎
            </button>
          </div>
          <div className="mt-0.5 pl-6 text-[11px] text-[#68707a]">
            {derived ? (
              <>Kế thừa {planName(plan.derivedFromId)} · {formula?.name ?? "theo gói gốc"}</>
            ) : (
              <>{plan.cancellationPolicy === "flexible" ? "Huỷ linh hoạt" : "Không hoàn tiền"} · {mealPlanLabel(plan)}</>
            )}
          </div>
        </div>
        {days.map((date) => {
          const r = restrictions[keyOf(plan.id, date)];
          const isSelected = selected?.planId === plan.id && selected?.date === date;
          const special = derived && overrides[keyOf(plan.id, date)] !== undefined;
          const price = resolvePlanPrice(plan, date, plans, overrides);
          const ib = inventoryBlockOn(invBlocks, plan.channelCode, plan.roomTypeId, date);
          return (
            <div
              key={date}
              onClick={() => setSelected({ planId: plan.id, date })}
              className={`cursor-pointer border-b border-l border-[#eef1f5] px-2 py-2 text-center ${r?.stopSell || ib ? "bg-red-50" : ""} ${isSelected ? "outline outline-2 -outline-offset-2 outline-[#2563eb]" : ""}`}
            >
              {ib ? (
                <div className="text-xs font-semibold text-[#68707a]">
                  ĐÓNG BÁN
                  <div className="text-[10px] font-medium">{ib.scope === "channel" ? "(đóng theo kênh)" : "(đóng cả loại phòng)"}</div>
                </div>
              ) : r?.stopSell ? (
                <div className="text-xs font-semibold text-[#e5484d]">ĐÓNG BÁN</div>
              ) : (
                <div className={`text-sm ${special ? "font-bold text-[#b45309]" : "font-semibold text-[#17293e]"}`}>
                  {price !== undefined ? fmt(price) : "—"}
                  {special && <span title="Giá đặc biệt — ghi đè công thức ngày này"> ●</span>}
                </div>
              )}
              {showMarkers && !r?.stopSell && (
                <div className="text-[10px] leading-tight text-[#68707a]">
                  {r?.minStay ? <div>ở ≥ {r.minStay} đêm</div> : null}
                  {r?.maxStay ? <div>ở ≤ {r.maxStay} đêm</div> : null}
                  {r?.cta ? <div>không nhận đến</div> : null}
                  {r?.ctd ? <div>không trả phòng</div> : null}
                </div>
              )}
            </div>
          );
        })}

        {/* stop-sell toggle row */}
        {showStopRow && (
          <>
            <div className="sticky left-0 z-10 border-b border-[#eef1f5] bg-white px-3 py-1.5 pl-9 text-xs text-[#68707a]">Ngừng bán</div>
            {days.map((date) => {
              const stopped = !!restrictions[keyOf(plan.id, date)]?.stopSell;
              const ib = inventoryBlockOn(invBlocks, plan.channelCode, plan.roomTypeId, date);
              if (ib) {
                return (
                  <div key={date} className="border-b border-l border-[#eef1f5] bg-[#f0f3f7] px-2 py-1.5 text-center text-xs font-medium text-[#68707a]" title="Đang bị đóng bán ở cấp kênh/loại phòng — cấp trên thắng, sửa ở panel Đóng bán">
                    bị khoá ↑
                  </div>
                );
              }
              return (
                <button
                  key={date}
                  onClick={() => setRestriction(plan.id, date, { stopSell: !stopped })}
                  className={`border-b border-l border-[#eef1f5] px-2 py-1.5 text-center text-xs font-semibold ${stopped ? "bg-red-50 text-[#e5484d]" : "text-[#1db584]"}`}
                  title={stopped ? "Đang ngừng bán — bấm để mở bán" : "Đang bán — bấm để ngừng bán ngày này"}
                >
                  {stopped ? "✕ ngừng" : "✓ bán"}
                </button>
              );
            })}
          </>
        )}
      </div>
    );
  }

  // ---------- render ----------
  const typeBlocks = roomTypesDb.filter((t) => typeFilter === "all" || t.id === typeFilter);
  const channelBlocks = CHANNELS;
  const focusChannel = viewMode === "byType" ? channel : null;

  return (
    <div>
      {dbError && <p className="mb-3 rounded-lg bg-[#fdecec] px-3 py-2 text-sm text-[#e5484d]">Lỗi cơ sở dữ liệu: {dbError}</p>}
      {/* view tabs + tools */}
      <div className="flex flex-wrap items-center gap-2">
        {(
          [
            ["byType", "Bán phòng theo loại phòng"],
            ["byChannel", "Bán phòng theo kênh"],
            ["compare", "So sánh tất cả kênh"],
          ] as [ViewMode, string][]
        ).map(([mode, label]) => (
          <button
            key={mode}
            onClick={() => setViewMode(mode)}
            className={`rounded-full px-4 py-2 text-sm font-medium ${viewMode === mode ? "bg-[#2563eb] text-white" : "border border-[#dde3ea] bg-white text-[#17293e] hover:bg-[#f4f7fb]"}`}
          >
            {label}
          </button>
        ))}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button onClick={() => setShowFormulas((v) => !v)} className="cb-btn-ghost px-3 py-2 text-sm">
            Danh sách công thức
          </button>
          <button onClick={() => setShowInvPanel((v) => !v)} className="cb-btn-ghost px-3 py-2 text-sm">
            Đóng bán cấp kênh / loại phòng
          </button>
          <button onClick={() => setShowBulk((v) => !v)} className="cb-btn-primary px-3 py-2 text-sm">
            ⚡ Cập nhật hàng loạt
          </button>
        </div>
      </div>

      {/* filters + date navigation */}
      {viewMode !== "compare" && (
        <div className="mt-3 flex flex-wrap items-end gap-3 text-sm text-[#17293e]">
          {viewMode === "byType" ? (
            <>
              <label>
                Kênh bán
                <select value={channel} onChange={(e) => setChannel(e.target.value)} className={`${inputCls} ml-2`}>
                  {CHANNELS.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.name}
                      {dirtyChannels.has(c.code) ? " ●" : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Loại phòng
                <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className={`${inputCls} ml-2`}>
                  <option value="all">Tất cả loại phòng</option>
                  {roomTypesDb.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              </label>
            </>
          ) : (
            <label>
              Loại phòng
              <select value={roomTypeId} onChange={(e) => setRoomTypeId(e.target.value)} className={`${inputCls} ml-2`}>
                {roomTypesDb.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </label>
          )}
          <span className="ml-auto flex items-center gap-2">
            <button onClick={() => setStartDate(addDays(startDate, -WINDOW))} className="cb-btn-ghost px-3 py-2" title="Lùi 14 ngày">‹</button>
            <input type="date" value={startDate} onChange={(e) => e.target.value && setStartDate(e.target.value)} className={inputCls} />
            <button onClick={() => setStartDate(addDays(startDate, WINDOW))} className="cb-btn-ghost px-3 py-2" title="Tiến 14 ngày">›</button>
          </span>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={showStopRow} onChange={(e) => setShowStopRow(e.target.checked)} /> Hiện dòng Ngừng bán
          </label>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={showMarkers} onChange={(e) => setShowMarkers(e.target.checked)} /> Hiện hạn chế trên ô giá
          </label>
        </div>
      )}

      {/* formula list panel */}
      {showFormulas && (
        <div className="cb-card mt-4 p-4">
          <div className="text-sm font-semibold text-[#17293e]">Danh sách công thức kế thừa</div>
          <p className="mt-1 text-xs text-[#68707a]">
            Gói kế thừa (C) không có giá riêng: giá của nó = giá gói gốc (M) chạy qua công thức này. Sửa giá gói gốc thì gói con tự đổi theo. Sửa tay 1 ngày ở gói con thì ngày đó thành giá đặc biệt, thoát công thức.
          </p>
          <table className="mt-3 w-full text-sm text-[#17293e]">
            <thead>
              <tr className="text-left text-xs text-[#68707a]">
                <th className="py-1 pr-3">Công thức</th>
                <th className="py-1 pr-3">Cách tính</th>
                <th className="py-1">Gói đang dùng</th>
              </tr>
            </thead>
            <tbody>
              {PRICE_FORMULAS.map((f) => (
                <tr key={f.id} className="border-t border-[#eef1f5]">
                  <td className="py-2 pr-3 font-medium">{f.name}</td>
                  <td className="py-2 pr-3">{f.kind === "percent" ? `${f.value > 0 ? "+" : ""}${f.value}% giá gốc` : `giá gốc + ${fmt(f.value)}₫`}</td>
                  <td className="py-2">{plans.filter((p) => p.formulaId === f.id).map((p) => p.name).join(", ") || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-[#68707a]">Thêm/sửa công thức tự do: để Vòng B (giờ dùng 4 công thức mẫu này).</p>
        </div>
      )}

      {/* inventory blocks panel (stop-sell levels 2 & 3) */}
      {showInvPanel && (
        <div className="cb-card mt-4 p-4">
          <div className="text-sm font-semibold text-[#17293e]">Đóng bán cấp kênh & cấp loại phòng</div>
          <p className="mt-1 text-xs text-[#68707a]">
            Đóng bán có 3 cấp, cấp trên thắng cấp dưới: (1) theo từng gói giá — đặt ở dòng Ngừng bán ngay trên lưới; (2) theo KÊNH — kênh đó không bán được loại phòng này trong khoảng ngày; (3) theo LOẠI PHÒNG — mọi kênh đều đóng. Dùng khi đóng Airbnb dịp lễ để dồn phòng cho khách đặt trực tiếp, hoặc khoá cả loại phòng khi sửa chữa lớn.
          </p>
          {invBlocks.length > 0 && (
            <table className="mt-3 w-full text-sm text-[#17293e]">
              <thead>
                <tr className="text-left text-xs text-[#68707a]">
                  <th className="py-1 pr-3">Cấp đóng</th>
                  <th className="py-1 pr-3">Loại phòng</th>
                  <th className="py-1 pr-3">Khoảng ngày</th>
                  <th className="py-1 pr-3">Lý do</th>
                  <th className="py-1"></th>
                </tr>
              </thead>
              <tbody>
                {invBlocks.map((b) => (
                  <tr key={b.id} className="border-t border-[#eef1f5]">
                    <td className="py-2 pr-3 font-medium">{b.scope === "channel" ? `Kênh ${CHANNELS.find((c) => c.code === b.channelCode)?.name ?? b.channelCode}` : "Cả loại phòng (mọi kênh)"}</td>
                    <td className="py-2 pr-3">{roomTypesDb.find((t) => t.id === b.roomTypeId)?.name ?? b.roomTypeId}</td>
                    <td className="py-2 pr-3">{b.from} → {b.to}</td>
                    <td className="py-2 pr-3">{b.reason ?? "—"}</td>
                    <td className="py-2 text-right">
                      <button onClick={() => removeInvBlock(b.id)} className="font-semibold text-[#e5484d]">Xoá</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[#eef1f5] pt-3 text-sm text-[#17293e]">
            <select value={ibScope} onChange={(e) => setIbScope(e.target.value as typeof ibScope)} className={inputCls}>
              <option value="channel">Đóng theo kênh</option>
              <option value="room_type">Đóng cả loại phòng</option>
            </select>
            {ibScope === "channel" && (
              <select value={ibChannel} onChange={(e) => setIbChannel(e.target.value)} className={inputCls}>
                {CHANNELS.map((c) => (
                  <option key={c.code} value={c.code}>{c.name}</option>
                ))}
              </select>
            )}
            <select value={ibType} onChange={(e) => setIbType(e.target.value)} className={inputCls}>
              {roomTypesDb.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
            <span>từ</span>
            <input type="date" value={ibFrom} onChange={(e) => setIbFrom(e.target.value)} className={inputCls} />
            <span>đến</span>
            <input type="date" value={ibTo} onChange={(e) => setIbTo(e.target.value)} className={inputCls} />
            <input value={ibReason} onChange={(e) => setIbReason(e.target.value)} className={`${inputCls} w-52`} placeholder="Lý do (không bắt buộc)" />
            <button onClick={addInvBlock} className="cb-btn-primary px-4 py-2 text-sm">Thêm đóng bán</button>
          </div>
        </div>
      )}

      {/* bulk update panel */}
      {showBulk && (
        <div className="cb-card mt-4 p-4">
          <div className="text-sm font-semibold text-[#17293e]">⚡ Cập nhật hàng loạt — đặt giá theo khoảng ngày + thứ trong tuần</div>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-[#17293e]">
            <select value={bulkPlan?.id ?? ""} onChange={(e) => setBulkPlanId(e.target.value)} className={inputCls}>
              {plans.map((p) => (
                <option key={p.id} value={p.id}>{p.name} ({CHANNELS.find((c) => c.code === p.channelCode)?.name})</option>
              ))}
            </select>
            <span>từ</span>
            <input type="date" value={bulkFrom} onChange={(e) => setBulkFrom(e.target.value)} className={inputCls} />
            <span>đến</span>
            <input type="date" value={bulkTo} onChange={(e) => setBulkTo(e.target.value)} className={inputCls} />
            <select value={bulkMode} onChange={(e) => setBulkMode(e.target.value as typeof bulkMode)} className={inputCls}>
              <option value="percent">thay đổi %</option>
              <option value="amount">cộng/trừ tiền</option>
              <option value="set">đặt giá cố định</option>
            </select>
            <input type="number" value={bulkValue} onChange={(e) => setBulkValue(Number(e.target.value))} className={`${inputCls} w-28`} />
            <button onClick={applyBulk} className="cb-btn-primary px-4 py-2 text-sm">Áp dụng cho {bulkDates.length} ngày</button>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-[#17293e]">
            <span className="text-[#68707a]">Chỉ áp dụng vào:</span>
            {WEEKDAYS.map((label, dow) => (
              <label key={dow} className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={bulkDays.includes(dow)}
                  onChange={(e) => setBulkDays((prev) => (e.target.checked ? [...prev, dow] : prev.filter((d) => d !== dow)))}
                />
                {label}
              </label>
            ))}
            <span className="text-xs text-[#68707a]">(VD: chỉ tích T7 + CN để tăng giá cuối tuần cả mùa)</span>
          </div>
          {bulkPlan?.derivedFromId && (
            <p className="mt-2 text-xs font-medium text-[#b45309]">Gói này đang kế thừa — cập nhật hàng loạt sẽ tạo GIÁ ĐẶC BIỆT cho từng ngày được chọn (thoát công thức ở những ngày đó).</p>
          )}
        </div>
      )}

      {/* sync status bar */}
      {viewMode !== "compare" && focusChannel && (
        <div className="cb-card mt-4 flex items-center gap-3 px-4 py-3 text-sm text-[#17293e]">
          {CHANNELS.find((c) => c.code === focusChannel)?.type === "ota" ? (
            dirtyChannels.has(focusChannel) ? (
              <>
                <span className="text-[#f59e0b]">●</span> Kênh {CHANNELS.find((c) => c.code === focusChannel)?.name} có thay đổi chưa đẩy lên Channex
                <button onClick={() => pushToChannex(focusChannel)} className="cb-btn-primary ml-auto px-3 py-1.5 text-sm">
                  Đẩy lên Channex ngay
                </button>
              </>
            ) : (
              <><span className="text-[#1db584]">●</span> Channex: đã đồng bộ</>
            )
          ) : (
            <><span className="text-[#9aa7b4]">●</span> Kênh này bán trực tiếp trong PMS, không qua Channex</>
          )}
        </div>
      )}

      {/* grids */}
      {viewMode === "compare" ? (
        <ComparisonView plans={plans} overrides={overrides} roomTypeId={roomTypeId} days={days} onPickType={setRoomTypeId} selectedType={roomTypeId} roomTypes={roomTypesDb} />
      ) : (
        <div className="mt-4 overflow-x-auto rounded-xl border border-[#dde3ea] bg-white shadow-[0_1px_3px_rgba(23,41,62,0.06)]">
          <div className="grid min-w-[1500px]" style={gridCols}>
            <DateHeader />
            {viewMode === "byType"
              ? typeBlocks.map((t) => {
                  const typePlans = plans.filter((p) => p.channelCode === channel && p.roomTypeId === t.id);
                  return (
                    <div key={t.id} className="contents">
                      <div className="sticky left-0 z-10 border-b border-[#eef1f5] bg-[#f7f9fb] px-3 py-2 text-sm font-bold text-[#17293e]">
                        {t.name} {t.code ? <span className="text-xs font-medium text-[#68707a]">(Mã: {t.code})</span> : null}
                      </div>
                      {days.map((d) => (
                        <div key={d} className="border-b border-l border-[#eef1f5] bg-[#f7f9fb]" />
                      ))}
                      <RoomsLeftRow typeId={t.id} />
                      {typePlans.map((plan) => (
                        <PlanRows key={plan.id} plan={plan} />
                      ))}
                      {typePlans.length === 0 && (
                        <>
                          <div className="sticky left-0 z-10 border-b border-[#eef1f5] bg-white px-3 py-3 text-xs text-[#68707a]">Kênh này chưa có gói giá cho loại phòng này.</div>
                          {days.map((d) => (
                            <div key={d} className="border-b border-l border-[#eef1f5]" />
                          ))}
                        </>
                      )}
                    </div>
                  );
                })
              : channelBlocks.map((c) => {
                  const chPlans = plans.filter((p) => p.channelCode === c.code && p.roomTypeId === roomTypeId);
                  return (
                    <div key={c.code} className="contents">
                      <div className="sticky left-0 z-10 border-b border-[#eef1f5] bg-[#f7f9fb] px-3 py-2 text-sm font-bold text-[#17293e]">
                        {c.name}
                        {dirtyChannels.has(c.code) && <span className="ml-2 text-[#f59e0b]" title="Có thay đổi chưa đẩy lên Channex">●</span>}
                      </div>
                      {days.map((d) => (
                        <div key={d} className="border-b border-l border-[#eef1f5] bg-[#f7f9fb]" />
                      ))}
                      <RoomsLeftRow typeId={roomTypeId} />
                      {chPlans.map((plan) => (
                        <PlanRows key={plan.id} plan={plan} />
                      ))}
                      {chPlans.length === 0 && (
                        <>
                          <div className="sticky left-0 z-10 border-b border-[#eef1f5] bg-white px-3 py-3 text-xs text-[#68707a]">Chưa có gói giá cho loại phòng này.</div>
                          {days.map((d) => (
                            <div key={d} className="border-b border-l border-[#eef1f5]" />
                          ))}
                        </>
                      )}
                    </div>
                  );
                })}
          </div>
        </div>
      )}

      {viewMode !== "compare" && (
        <p className="mt-2 text-xs text-[#68707a]">
          Chú thích: <b className="text-[#2563eb]">M</b> gói lưu trú cơ sở · <b className="text-[#0ea5a4]">C</b> gói lưu trú kế thừa · <b className="text-[#b45309]">●</b> giá đặc biệt (ghi đè công thức) · Số phòng trống đã trừ phòng hỏng theo lịch chặn phòng theo ngày (phòng tạm đóng vẫn tính trong tồn). Bấm tên gói (✎) để cài đặt gói: tên hiển thị, bữa ăn, phụ thu khách thêm, kế thừa.
        </p>
      )}

      {/* selected cell editor */}
      {selected && selectedPlan && (
        <div className="cb-card mt-4 p-4">
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <div className="text-xs text-[#68707a]">Đang sửa ô giá</div>
              <div className="text-sm font-semibold text-[#17293e]">
                {selectedPlan.name} · {dayParts(selected.date).wd} {selected.date}
              </div>
              {selectedPlan.derivedFromId && (
                <div className="text-xs text-[#0ea5a4]">
                  Giá theo công thức: {planName(selectedPlan.derivedFromId)} → {getFormula(selectedPlan.formulaId)?.name}
                  {overrides[keyOf(selected.planId, selected.date)] !== undefined && (
                    <button onClick={() => clearSpecial(selected.planId, selected.date)} className="ml-2 font-semibold text-[#e5484d] underline">
                      Xoá giá đặc biệt, về lại công thức
                    </button>
                  )}
                </div>
              )}
            </div>
            <label className="text-sm text-[#17293e]">
              Giá (VNĐ){selectedPlan.derivedFromId ? " — đặt giá đặc biệt" : ""}
              <input
                type="number"
                step={1000}
                value={resolvePlanPrice(selectedPlan, selected.date, plans, overrides) ?? 0}
                onChange={(e) => setPrice(selected.planId, selected.date, Number(e.target.value))}
                className={`${inputCls} ml-2 w-36`}
              />
            </label>
            <button
              onClick={() => setRestriction(selected.planId, selected.date, { stopSell: !selectedRestriction?.stopSell })}
              className={`rounded-lg px-4 py-2 text-sm font-semibold text-white ${selectedRestriction?.stopSell ? "bg-[#1db584]" : "bg-[#e5484d]"}`}
            >
              {selectedRestriction?.stopSell ? "Mở bán ngày này" : "Đóng bán ngày này"}
            </button>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-4 text-sm text-[#17293e]">
            <span className="font-medium text-[#68707a]">Hạn chế (áp riêng cho gói này, không kế thừa):</span>
            <label>
              Ở tối thiểu
              <input type="number" min={1} placeholder="—" value={selectedRestriction?.minStay ?? ""} onChange={(e) => setRestriction(selected.planId, selected.date, { minStay: e.target.value ? Number(e.target.value) : undefined })} className={`${inputCls} ml-2 w-20`} /> đêm
            </label>
            <label>
              Ở tối đa
              <input type="number" min={1} placeholder="—" value={selectedRestriction?.maxStay ?? ""} onChange={(e) => setRestriction(selected.planId, selected.date, { maxStay: e.target.value ? Number(e.target.value) : undefined })} className={`${inputCls} ml-2 w-20`} /> đêm
            </label>
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={!!selectedRestriction?.cta} onChange={(e) => setRestriction(selected.planId, selected.date, { cta: e.target.checked })} />
              Không nhận khách đến ngày này (CTA)
            </label>
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={!!selectedRestriction?.ctd} onChange={(e) => setRestriction(selected.planId, selected.date, { ctd: e.target.checked })} />
              Không cho trả phòng ngày này (CTD)
            </label>
          </div>
        </div>
      )}

      {/* plan settings card */}
      {settingsPlan && (
        <div className="cb-card mt-4 p-4">
          <div className="flex items-center gap-3">
            <div className="text-sm font-semibold text-[#17293e]">Cài đặt gói giá — {settingsPlan.name}</div>
            <span className="text-xs text-[#68707a]">({CHANNELS.find((c) => c.code === settingsPlan.channelCode)?.name} · {roomTypesDb.find((t) => t.id === settingsPlan.roomTypeId)?.name})</span>
            <button onClick={() => setSettingsPlanId(null)} className="cb-btn-ghost ml-auto px-3 py-1.5 text-sm">Đóng</button>
          </div>
          <div className="mt-3 grid gap-4 md:grid-cols-2">
            <label className="text-sm text-[#17293e]">
              Tên hiển thị cho khách (trên trang đặt phòng)
              <input value={settingsPlan.publicName ?? ""} onChange={(e) => patchPlan(settingsPlan.id, { publicName: e.target.value })} className={`${inputCls} mt-1 w-full`} placeholder="VD: Giá linh hoạt — gồm ăn sáng" />
            </label>
            <label className="text-sm text-[#17293e]">
              Bữa ăn gồm trong giá
              <select value={settingsPlan.mealPlan ?? "room_only"} onChange={(e) => patchPlan(settingsPlan.id, { mealPlan: e.target.value as RatePlan["mealPlan"] })} className={`${inputCls} mt-1 w-full`}>
                <option value="room_only">Chỉ phòng</option>
                <option value="breakfast">Gồm ăn sáng</option>
              </select>
            </label>
            <label className="text-sm text-[#17293e]">
              Số khách gồm sẵn trong giá
              <input type="number" min={1} value={settingsPlan.baseOccupancy ?? 2} onChange={(e) => patchPlan(settingsPlan.id, { baseOccupancy: Number(e.target.value) })} className={`${inputCls} mt-1 w-full`} />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="text-sm text-[#17293e]">
                Phụ thu 1 người lớn thêm / đêm (VNĐ)
                <input type="number" step={10000} value={settingsPlan.extraAdultFee ?? 0} onChange={(e) => patchPlan(settingsPlan.id, { extraAdultFee: Number(e.target.value) })} className={`${inputCls} mt-1 w-full`} />
              </label>
              <label className="text-sm text-[#17293e]">
                Phụ thu 1 trẻ em thêm / đêm (VNĐ)
                <input type="number" step={10000} value={settingsPlan.extraChildFee ?? 0} onChange={(e) => patchPlan(settingsPlan.id, { extraChildFee: Number(e.target.value) })} className={`${inputCls} mt-1 w-full`} />
              </label>
            </div>
          </div>
          <div className="mt-4 border-t border-[#eef1f5] pt-3">
            <label className="flex items-center gap-2 text-sm font-medium text-[#17293e]">
              <input
                type="checkbox"
                checked={!!settingsPlan.derivedFromId}
                onChange={(e) => {
                  if (e.target.checked) {
                    const base = plans.find((p) => p.roomTypeId === settingsPlan.roomTypeId && !p.derivedFromId && p.id !== settingsPlan.id);
                    patchPlan(settingsPlan.id, { derivedFromId: base?.id, formulaId: settingsPlan.formulaId ?? "f-minus10" });
                  } else {
                    patchPlan(settingsPlan.id, { derivedFromId: undefined, formulaId: undefined });
                  }
                }}
              />
              Gói này KẾ THỪA giá từ gói gốc (không nhập giá riêng)
            </label>
            {settingsPlan.derivedFromId && (
              <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-[#17293e]">
                <span>Gói gốc:</span>
                <select value={settingsPlan.derivedFromId} onChange={(e) => patchPlan(settingsPlan.id, { derivedFromId: e.target.value })} className={inputCls}>
                  {plans
                    .filter((p) => p.roomTypeId === settingsPlan.roomTypeId && !p.derivedFromId && p.id !== settingsPlan.id)
                    .map((p) => (
                      <option key={p.id} value={p.id}>{p.name} ({CHANNELS.find((c) => c.code === p.channelCode)?.name})</option>
                    ))}
                </select>
                <span>Công thức:</span>
                <select value={settingsPlan.formulaId ?? "f-minus10"} onChange={(e) => patchPlan(settingsPlan.id, { formulaId: e.target.value })} className={inputCls}>
                  {PRICE_FORMULAS.map((f) => (
                    <option key={f.id} value={f.id}>{f.name}</option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- "All channels" comparison (parity) ----------
function ComparisonView({
  plans,
  overrides,
  roomTypeId,
  days,
  onPickType,
  selectedType,
  roomTypes,
}: {
  plans: RatePlan[];
  overrides: Record<CellKey, number>;
  roomTypeId: string;
  days: string[];
  onPickType: (id: string) => void;
  selectedType: string;
  roomTypes: RoomType[];
}) {
  const websitePlan = plans.find((p) => p.channelCode === "website" && p.roomTypeId === roomTypeId && p.cancellationPolicy === "flexible");
  return (
    <div className="mt-4">
      <label className="text-sm text-[#17293e]">
        Loại phòng
        <select value={selectedType} onChange={(e) => onPickType(e.target.value)} className={`${inputCls} ml-2`}>
          {roomTypes.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
      </label>
      <div className="cb-card mt-3 overflow-x-auto">
        <table className="w-full text-sm text-[#17293e]">
          <thead>
            <tr className="bg-[#f7f9fb] text-left text-xs text-[#68707a]">
              <th className="px-4 py-3">Kênh</th>
              <th className="px-4 py-3">Gói giá linh hoạt</th>
              {days.map((d) => (
                <th key={d} className="px-3 py-3 text-center">{dayParts(d).wd} {dayParts(d).label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {CHANNELS.map((c) => {
              const plan = plans.find((p) => p.channelCode === c.code && p.roomTypeId === roomTypeId && p.cancellationPolicy === "flexible");
              return (
                <tr key={c.code} className="border-t border-[#eef1f5]">
                  <td className="px-4 py-3 font-medium">{c.name}</td>
                  <td className="px-4 py-3 text-[#68707a]">{plan?.name ?? "— chưa có —"}{plan?.derivedFromId ? " (kế thừa)" : ""}</td>
                  {days.map((d) => {
                    const price = plan ? resolvePlanPrice(plan, d, plans, overrides) : undefined;
                    const webPrice = websitePlan ? resolvePlanPrice(websitePlan, d, plans, overrides) : undefined;
                    const cheaperThanWebsite = c.type === "ota" && price !== undefined && webPrice !== undefined && price < webPrice;
                    return (
                      <td key={d} className={`px-3 py-3 text-center ${cheaperThanWebsite ? "font-semibold text-[#e5484d]" : ""}`} title={cheaperThanWebsite ? "Giá OTA đang thấp hơn giá Website!" : undefined}>
                        {price !== undefined ? fmt(price) : "—"}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="border-t border-[#eef1f5] px-4 py-3 text-xs text-[#68707a]">
          Ô đỏ = giá của OTA đó đang <b>thấp hơn giá Website</b> cùng ngày — ngược chiến lược kéo khách đặt trực tiếp, cần kiểm tra lại. Giá gói kế thừa được tính theo công thức tại thời điểm xem.
        </p>
      </div>
    </div>
  );
}
