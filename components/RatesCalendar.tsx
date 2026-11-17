"use client";
// ============================================================
// FILE RATECAL3d — components/RatesCalendar.tsx (ezCloud-style
// "Ban phong" selling grid, Cloudbeds palette)
// Fix 2026-11-04 so voi RATECAL3c: sua panel Cap nhat hang
// loat (truoc day bam Ap dung ma gia khong doi):
//  1) o Loai phong mac dinh tro vao loai phong mau cu
//     ("deluxe") khong co trong du lieu that (toa test chi
//     co Twin/Double) nen ghi bi loi khoa ngoai — gio tu
//     chon loai phong that dau tien khi tai xong;
//  2) khoang ngay mac dinh la thang 10 (ngay mau cu),
//     lech khoi 14 ngay dang xem — gio mo panel la ngay
//     tu theo dung cua so luoi dang hien;
//  3) che do mac dinh "thay doi %" khong co tac dung len
//     o chua co gia (tang % cua 0 van la 0), va cach lam
//     tron cu (tron 1000) lam gia USD thanh 0 — gio mac
//     dinh la "dat gia co dinh", tang/giam chi ap vao o
//     da co gia (bo qua o trong, khong ghi 0), lam tron
//     theo tien te (USD tron 1, VND tron 1000).
// Con lai giong het RATECAL3c.
// TWO TOP-LEVEL TABS:
//   - Tab 1 "Ton phong": luoi so phong trong theo tung loai
//     phong x tung ngay. Ton la QUY CHUNG moi kenh — khong
//     chia theo kenh. GIU NGUYEN tu RATECAL2.
//   - Tab 2 "Gia theo kenh" (truoc la "Chinh sach gia",
//     viet lai 2026-11-04 theo mo hinh don gian gia + ton):
//     moi kenh chi co 1 gia cho moi loai phong moi ngay.
//     Khong con goi ke thua, cong thuc, huy hieu M/C, dau
//     dac biet, che do xem phu, panel cong thuc, cai dat
//     goi. Luoi hien 1 hang gia cho moi kenh (loc bang o
//     chon Kênh: "Tat ca" = so sanh, 1 kenh = xem rieng).
//     Gia cua kenh lay tu "goi chuan" cua kenh do: goi
//     khong ke thua, uu tien goi chi phong (room_only).
//     Kenh + loai phong chua co goi chuan: o gia hien "—",
//     bam vao o se tu tao goi chuan roi moi nhap gia.
//     O gia trong hien "—" (khong hien 0). Hang Ngung ban
//     luon hien, bam tung ngay de dong/mo. O sua gia giu
//     lai cac muc han che (o toi thieu/toi da, CTA/CTD),
//     chi bo dau hien tren o gia cho do roi.
//   - Luoi mo dung ngay hom nay that (truoc day ket o
//     ngay mau 21/10 cua mock-data).
// ============================================================

import { useEffect, useMemo, useRef, useState } from "react";
import {
  CHANNELS,
  INVENTORY_BLOCKS,
  RATE_PLANS,
  RESERVATIONS,
  ROOM_BLOCKS,
  ROOM_TYPES,
  ROOMS,
  TODAY,
  getHotelData,
  inventoryBlockOn,
  roomBlockOn,
  type InventoryBlock,
  type RatePlan,
  type RoomType,
} from "@/lib/mock-data";
import { supabase } from "@/lib/supabase";
import { currentHotelId } from "@/lib/current-hotel";
import { useParams } from "next/navigation";
import { queueChannexDates, rangeDates } from "@/lib/channex-outbox";
import { DatePicker, DateRangePicker } from "@/components/DatePicker";
import { IconZap } from "@/components/icons";

// Round B (Buoc 4.3): rate plans + daily prices/restrictions are
// loaded from Supabase and every edit is saved back to the
// rate_plans / rate_prices tables. Availability inputs (rooms,
// reservations, blocks) still come from the sample data in this
// step — they move to the database in the next one.
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

const inputCls = "rounded-lg border border-[var(--cb-border)] px-2 py-2 text-[var(--cb-text)] outline-none focus:border-[var(--cb-blue)]";
const WEEKEND_DAYS: number[] = getHotelData("cityhouse-mark").config?.weekendDays ?? [0, 6];

export default function RatesCalendar() {
  // Khach san lay tu URL /h/[hotelId] khi co; neu khong (duong dan cu)
  // thi dung khach san da luu theo tab.
  const params = useParams();
  const HOTEL_ID = typeof params.hotelId === "string" ? params.hotelId : currentHotelId();
  // Tab chinh cua trang Ban phong: tab 1 Ton phong (luoi phong
  // trong), tab 2 Gia theo kenh (luoi gia + ngung ban theo kenh).
  const [tab, setTab] = useState<"inventory" | "prices">("inventory");
  const [invChannel, setInvChannel] = useState<string>("all"); // tab 1: kenh dang xem ("all" = ton chung)
  const [collapsedTypes, setCollapsedTypes] = useState<Set<string>>(new Set()); // tab 2: loai phong dang thu gon
  const [priceChannel, setPriceChannel] = useState<string>("all"); // tab 2: kenh dang xem ("all" = so sanh tat ca)
  const [priceTypeFilter, setPriceTypeFilter] = useState<string>("all"); // tab 2: loai phong dang loc
  const [startDate, setStartDate] = useState<string>(TODAY);
  const [todayStr, setTodayStr] = useState<string>(TODAY);

  // editable copies of the mock data
  const [plans, setPlans] = useState<RatePlan[]>(RATE_PLANS.map((p) => ({ ...p, prices: { ...p.prices } })));
  const [roomTypesDb, setRoomTypesDb] = useState<RoomType[]>(ROOM_TYPES);
  const [restrictions, setRestrictions] = useState<Record<CellKey, Restriction>>({});
  const [invBlocks, setInvBlocks] = useState<InventoryBlock[]>(INVENTORY_BLOCKS); // stop-sell cap kenh & loai phong
  // Availability inputs (rooms / reservations / room blocks):
  // start as the sample data, replaced by database rows when
  // the loader finishes — the grid and the staff calendar now
  // share ONE source of truth (Buoc 4.4b).
  const [roomsDb, setRoomsDb] = useState(ROOMS);
  const [reservationsDb, setReservationsDb] = useState(RESERVATIONS);
  const [roomBlocksDb, setRoomBlocksDb] = useState(ROOM_BLOCKS);
  const [dirtyChannels, setDirtyChannels] = useState<Set<string>>(new Set());
  const [dbError, setDbError] = useState("");
  const [currency, setCurrency] = useState("VND");

  const [selected, setSelected] = useState<{ planId: string; date: string } | null>(null);
  const [showBulk, setShowBulk] = useState(false);
  const [showInvPanel, setShowInvPanel] = useState(false);

  // add-inventory-block form state
  const [ibScope, setIbScope] = useState<"channel" | "room_type">("channel");
  const [ibChannel, setIbChannel] = useState<string>("airbnb");
  const [ibType, setIbType] = useState<string>("deluxe");
  const [ibFrom, setIbFrom] = useState(TODAY);
  const [ibTo, setIbTo] = useState(addDays(TODAY, 2));
  const [ibReason, setIbReason] = useState("");

  // bulk update state (theo kenh + loai phong, khong theo goi)
  const [bulkChannel, setBulkChannel] = useState<string>("booking_com");
  const [bulkType, setBulkType] = useState<string>(ROOM_TYPES[0]?.id ?? "");
  const [bulkFrom, setBulkFrom] = useState(TODAY);
  const [bulkTo, setBulkTo] = useState(addDays(TODAY, 13));
  const [bulkDays, setBulkDays] = useState<number[]>([0, 1, 2, 3, 4, 5, 6]);
  const [bulkMode, setBulkMode] = useState<"set" | "percent" | "amount">("set");
  const [bulkValue, setBulkValue] = useState<number>(10);

  // Chong tao trung goi chuan khi bam nhanh 2 o cung kenh + loai.
  const ensuringRef = useRef<Set<string>>(new Set());

  const days = useMemo(() => Array.from({ length: WINDOW }, (_, i) => addDays(startDate, i)), [startDate]);

  // Ngay hom nay that theo gio dia phuong (tinh o client, sau
  // khi mount, de khong lech ngay khi render phia may chu).
  // Luoi mo dung ngay hom nay thay vi ket o ngay mau TODAY.
  useEffect(() => {
    const d = new Date();
    const s = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    setTodayStr(s);
    setStartDate(s);
  }, []);

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
      const [typesRes, plansRes, pricesRes, roomsRes, resRes, rrRes, blocksRes, invRes, hotelRes] = await Promise.all([
        supabase.from("room_types").select("*").eq("hotel_id", HOTEL_ID),
        supabase.from("rate_plans").select("*").eq("hotel_id", HOTEL_ID),
        supabase.from("rate_prices").select("*"),
        supabase.from("rooms").select("*").eq("hotel_id", HOTEL_ID),
        supabase.from("reservations").select("*").eq("hotel_id", HOTEL_ID),
        supabase.from("reservation_rooms").select("reservation_id, room_number"),
        supabase.from("room_blocks").select("*").eq("hotel_id", HOTEL_ID),
        supabase.from("inventory_blocks").select("*").eq("hotel_id", HOTEL_ID),
        supabase.from("hotels").select("currency").eq("id", HOTEL_ID).single(),
      ]);
      const loadErr = plansRes.error ?? pricesRes.error ?? roomsRes.error ?? resRes.error ?? rrRes.error ?? blocksRes.error ?? invRes.error;
      if (loadErr) {
        setDbError(loadErr.message ?? "Không đọc được dữ liệu");
        return;
      }
      if (hotelRes.data?.currency) setCurrency(hotelRes.data.currency);
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
        // Loai phong mac dinh cua panel Dong ban + Cap nhat
        // hang loat dang tro vao id mau cu — doi sang loai
        // phong that dau tien neu id cu khong co trong DB.
        const dbTypeIds = (typesRes.data ?? []).map((t) => t.id);
        setBulkType((prev) => (dbTypeIds.includes(prev) ? prev : dbTypeIds[0]));
        setIbType((prev) => (dbTypeIds.includes(prev) ? prev : dbTypeIds[0]));
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
      }
      setPlans(dbPlans);
      setRestrictions(dbRestrictions);

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

  function setPrice(planId: string, date: string, price: number) {
    const plan = plans.find((p) => p.id === planId);
    if (!plan) return;
    setPlans((prev) => prev.map((p) => (p.id === planId ? { ...p, prices: { ...p.prices, [date]: price } } : p)));
    markDirty(plan.channelCode);
    persistCell(planId, date, price);
  }

  function clearPrice(planId: string, date: string) {
    const plan = plans.find((p) => p.id === planId);
    if (!plan) return;
    setPlans((prev) => prev.map((p) => {
      if (p.id !== planId) return p;
      const next = { ...p.prices };
      delete next[date];
      return { ...p, prices: next };
    }));
    markDirty(plan.channelCode);
    supabase
      .from("rate_prices")
      .delete()
      .eq("rate_plan_id", planId)
      .eq("date", date)
      .then(({ error }) => {
        if (error) setDbError("Xoá giá không thành công: " + error.message);
        else queueChannexDates([date]);
      });
  }

  function setRestriction(planId: string, date: string, patch: Restriction) {
    const merged = { ...restrictions[keyOf(planId, date)], ...patch };
    setRestrictions((prev) => ({ ...prev, [keyOf(planId, date)]: merged }));
    const plan = plans.find((p) => p.id === planId);
    if (plan) {
      markDirty(plan.channelCode);
      persistCell(planId, date, plan.prices[date] ?? 0, merged);
    }
  }

  function pushToChannex(code: string) {
    // Day thay doi cua kenh nay vao hang doi Channex ngay (bo gui
    // nen se day di trong vai giay) — truoc day chi xoa co hieu
    // ma khong day gi ca.
    queueChannexDates(days, HOTEL_ID);
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

  // ---------- goi chuan cua kenh (mo hinh don gian gia + ton) ----------
  // Gia cua 1 kenh cho 1 loai phong lay tu 1 goi duy nhat: goi
  // khong ke thua, uu tien goi chi phong (room_only) — goi an
  // (B&B...) la goi them cua kenh, kenh tu lo.
  function standardPlanFor(channelCode: string, roomTypeId: string): RatePlan | undefined {
    const cands = plans.filter((p) => p.channelCode === channelCode && p.roomTypeId === roomTypeId && !p.derivedFromId);
    return cands.find((p) => (p.mealPlan ?? "room_only") === "room_only") ?? cands[0];
  }

  // Kenh + loai phong chua co goi chuan: tao goi chuan (ten =
  // ten kenh, huy linh hoat, chi phong) roi moi ghi gia.
  async function ensureStandardPlan(channelCode: string, roomTypeId: string): Promise<RatePlan | undefined> {
    const existing = standardPlanFor(channelCode, roomTypeId);
    if (existing) return existing;
    const key = `${channelCode}|${roomTypeId}`;
    if (ensuringRef.current.has(key)) return undefined;
    ensuringRef.current.add(key);
    try {
      const chName = CHANNELS.find((c) => c.code === channelCode)?.name ?? channelCode;
      const id = `plan-${Date.now()}`;
      const { error } = await supabase.from("rate_plans").insert({
        id, hotel_id: HOTEL_ID, account_id: ACCOUNT_ID,
        room_type_id: roomTypeId, channel_code: channelCode,
        name: chName, cancellation_policy: "flexible", meal_plan: "room_only", policy_id: null,
      });
      if (error) {
        setDbError("Tạo gói chuẩn không thành công: " + error.message);
        return undefined;
      }
      const np: RatePlan = {
        id, channelCode, roomTypeId, name: chName,
        cancellationPolicy: "flexible", mealPlan: "room_only", prices: {},
      };
      setPlans((prev) => [...prev, np]);
      return np;
    } finally {
      ensuringRef.current.delete(key);
    }
  }

  // Bam vao o gia: dam bao co goi chuan roi moi mo o sua.
  async function pickCell(channelCode: string, roomTypeId: string, date: string) {
    const plan = await ensureStandardPlan(channelCode, roomTypeId);
    if (plan) setSelected({ planId: plan.id, date });
  }

  // Bam nut Ngung ban / Mo ban o hang Ngung ban.
  async function toggleStopSell(channelCode: string, roomTypeId: string, date: string) {
    const plan = await ensureStandardPlan(channelCode, roomTypeId);
    if (!plan) return;
    const stopped = !!restrictions[keyOf(plan.id, date)]?.stopSell;
    setRestriction(plan.id, date, { stopSell: !stopped });
  }

  // ---------- bulk update (interval tool) ----------
  const bulkDates = useMemo(() => {
    const out: string[] = [];
    if (!bulkFrom || !bulkTo || bulkTo < bulkFrom) return out;
    for (let d = bulkFrom; d <= bulkTo && out.length <= 62; d = addDays(d, 1)) {
      if (bulkDays.includes(dayParts(d).dow)) out.push(d);
    }
    return out;
  }, [bulkFrom, bulkTo, bulkDays]);

  async function applyBulk() {
    if (!bulkType) return;
    const plan = await ensureStandardPlan(bulkChannel, bulkType);
    if (!plan) return;
    const step = currency === "USD" ? 1 : 1000;
    for (const date of bulkDates) {
      const current = plan.prices[date];
      // Tang/giam % hoac tien can gia goc — o chua co gia thi
      // bo qua (khong ghi 0); chi che do "dat gia co dinh"
      // moi ghi vao o trong.
      if (current === undefined && bulkMode !== "set") continue;
      const base = current ?? 0;
      const next =
        bulkMode === "set" ? bulkValue : bulkMode === "percent" ? Math.round((base * (1 + bulkValue / 100)) / step) * step : base + bulkValue;
      setPrice(plan.id, date, next);
    }
  }

  const selectedPlan = plans.find((p) => p.id === selected?.planId);
  const selectedRestriction = selected ? restrictions[keyOf(selected.planId, selected.date)] : undefined;
  const focusChannelObj = CHANNELS.find((c) => c.code === priceChannel);

  // ---------- shared grid pieces ----------
  const gridCols = { gridTemplateColumns: `230px repeat(${days.length}, minmax(88px, 1fr))` } as const;

  function DateHeader() {
    return (
      <div className="contents">
        <div className="sticky left-0 z-10 border-b border-[var(--cb-bg)] bg-[var(--cb-blue-soft)] px-3 py-2 text-xs font-semibold text-[var(--cb-muted)]">Ngày →</div>
        {days.map((d) => {
          const p = dayParts(d);
          const weekend = WEEKEND_DAYS.includes(p.dow);
          return (
            <div key={d} className={`border-b border-l border-[var(--cb-bg)] px-2 py-2 text-center text-xs font-semibold ${weekend ? "bg-[#fdf0f0] text-[#e5484d]" : "bg-[var(--cb-blue-soft)] text-[var(--cb-muted)]"}`}>
              {p.wd} · {p.label}
              {d === todayStr && <div className="text-[10px] font-bold text-[var(--cb-blue)]">HÔM NAY</div>}
            </div>
          );
        })}
      </div>
    );
  }

  // Hang gia + hang Ngung ban cua 1 kenh cho 1 loai phong.
  // Gia lay tu goi chuan cua kenh; kenh chua co goi chuan thi
  // cac o hien "—", bam vao se tao goi chuan roi moi nhap gia.
  function ChannelPriceRows({ channelCode, typeId }: { channelCode: string; typeId: string }) {
    const plan = standardPlanFor(channelCode, typeId);
    const ch = CHANNELS.find((c) => c.code === channelCode);
    const webPlan = channelCode === "website" ? undefined : standardPlanFor("website", typeId);
    return (
      <div className="contents">
        {/* price row */}
        <div className="sticky left-0 z-10 border-b border-[var(--cb-bg)] bg-white px-3 py-2">
          <div className="flex items-center gap-1.5 text-sm font-medium text-[var(--cb-text)]">
            {ch?.name ?? channelCode}
            {dirtyChannels.has(channelCode) && <span className="text-[#f59e0b]" title="Có thay đổi chưa đẩy lên Channex">●</span>}
          </div>
          {!plan && (
            <div className="mt-0.5 text-[11px] text-[var(--cb-muted)]">Chưa có giá — bấm vào ô để nhập giá đầu tiên</div>
          )}
        </div>
        {days.map((date) => {
          const r = plan ? restrictions[keyOf(plan.id, date)] : undefined;
          const isSelected = !!plan && selected?.planId === plan.id && selected?.date === date;
          const price = plan?.prices[date];
          const ib = inventoryBlockOn(invBlocks, channelCode, typeId, date);
          const webPrice = webPlan?.prices[date];
          const cheaperThanWebsite =
            priceChannel === "all" &&
            ch?.type === "ota" &&
            price !== undefined &&
            webPrice !== undefined &&
            price < webPrice;
          return (
            <div
              key={date}
              onClick={() => void pickCell(channelCode, typeId, date)}
              className={`cursor-pointer border-b border-l border-[var(--cb-bg)] px-2 py-2 text-center ${r?.stopSell || ib ? "bg-red-50" : ""} ${isSelected ? "outline outline-2 -outline-offset-2 outline-[var(--cb-blue)]" : ""}`}
            >
              {ib ? (
                <div className="text-xs font-semibold text-[var(--cb-muted)]">
                  ĐÓNG BÁN
                  <div className="text-[10px] font-medium">{ib.scope === "channel" ? "(đóng theo kênh)" : "(đóng cả loại phòng)"}</div>
                </div>
              ) : r?.stopSell ? (
                <div className="text-xs font-semibold text-[#e5484d]">ĐÓNG BÁN</div>
              ) : (
                <div
                  className={`text-sm font-semibold ${cheaperThanWebsite ? "text-[#e5484d]" : "text-[var(--cb-text)]"}`}
                  title={cheaperThanWebsite ? "Giá kênh này đang thấp hơn giá Website cùng ngày — ngược chiến lược kéo khách đặt trực tiếp, cần kiểm tra lại." : undefined}
                >
                  {price !== undefined ? fmt(price) : "—"}
                </div>
              )}
            </div>
          );
        })}

        {/* stop-sell toggle row — luon hien */}
        <>
          <div className="sticky left-0 z-10 border-b border-[var(--cb-bg)] bg-white px-3 py-1.5 pl-9 text-xs text-[var(--cb-muted)]">Ngừng bán</div>
          {days.map((date) => {
            const stopped = !!plan && !!restrictions[keyOf(plan.id, date)]?.stopSell;
            const ib = inventoryBlockOn(invBlocks, channelCode, typeId, date);
            if (ib) {
              return (
                <div key={date} className="border-b border-l border-[var(--cb-bg)] bg-[var(--cb-blue-soft)] px-2 py-1.5 text-center text-xs font-medium text-[var(--cb-muted)]" title="Đang bị đóng bán ở cấp kênh/loại phòng — cấp trên thắng, sửa ở panel Đóng bán">
                  bị khoá ↑
                </div>
              );
            }
            return (
              <button
                key={date}
                onClick={() => void toggleStopSell(channelCode, typeId, date)}
                className={`border-b border-l border-[var(--cb-bg)] px-2 py-1.5 text-center text-xs font-semibold ${stopped ? "bg-red-50 text-[#e5484d]" : "text-[#1db584]"}`}
                title={stopped ? "Đang ngừng bán — bấm để mở bán" : "Đang bán — bấm để ngừng bán ngày này"}
              >
                {stopped ? "✕ ngừng" : "✓ bán"}
              </button>
            );
          })}
        </>
      </div>
    );
  }

  // ---------- render ----------
  const visibleTypes = roomTypesDb.filter((t) => priceTypeFilter === "all" || t.id === priceTypeFilter);
  const visibleChannels = priceChannel === "all" ? CHANNELS : CHANNELS.filter((c) => c.code === priceChannel);

  return (
    <div>
      {dbError && <p className="mb-3 rounded-lg bg-[#fdecec] px-3 py-2 text-sm text-[#e5484d]">Lỗi cơ sở dữ liệu: {dbError}</p>}
      {/* ===== thanh tab chinh: Ton phong / Gia theo kenh ===== */}
      <div className="flex flex-wrap items-center gap-2">
        {(
          [
            ["inventory", "Tồn phòng"],
            ["prices", "Giá theo kênh"],
          ] as const
        ).map(([mode, label]) => (
          <button
            key={mode}
            onClick={() => setTab(mode)}
            className={`rounded-full px-4 py-2 text-sm font-medium ${tab === mode ? "bg-[var(--cb-blue)] text-white" : "border border-[var(--cb-border)] bg-white text-[var(--cb-text)] hover:bg-[var(--cb-blue-soft)]"}`}
          >
            {label}
          </button>
        ))}
        <span className="ml-2 text-xs text-[var(--cb-muted)]">
          {tab === "inventory"
            ? "Số phòng trống chung cho mọi kênh — tồn không chia theo kênh."
            : "Giá bán theo từng kênh. Bấm vào ô giá để sửa giá ngày đó. PMS chỉ đưa giá và tồn cho kênh, còn lại kênh tự lo."}
        </span>
      </div>

      {/* ===== TAB 1: TON PHONG — luoi phong trong ===== */}
      {tab === "inventory" && (
        <>
          <div className="mt-3 flex flex-wrap items-end gap-3 text-sm text-[var(--cb-text)]">
            <label>
              Kênh bán
              <select value={invChannel} onChange={(e) => setInvChannel(e.target.value)} className={`${inputCls} ml-2`}>
                <option value="all">Tất cả kênh (xem tồn chung)</option>
                {CHANNELS.map((c) => (
                  <option key={c.code} value={c.code}>{c.name}</option>
                ))}
              </select>
            </label>
            <span className="ml-auto flex items-center gap-2">
              <button onClick={() => setStartDate(addDays(startDate, -WINDOW))} className="cb-btn-ghost px-3 py-2" title="Lùi 14 ngày">‹</button>
              <DatePicker value={startDate} onChange={(v) => v && setStartDate(v)} />
              <button onClick={() => setStartDate(addDays(startDate, WINDOW))} className="cb-btn-ghost px-3 py-2" title="Tiến 14 ngày">›</button>
            </span>
          </div>
          <div className="mt-4 overflow-x-auto rounded-xl border border-[var(--cb-border)] bg-white shadow-[0_1px_3px_rgba(16,28,66,0.06)]">
            <div className="grid min-w-[1500px]" style={gridCols}>
              <DateHeader />
              {roomTypesDb.map((t) => {
                const left = roomsLeftByType[t.id] ?? [];
                return (
                  <div key={t.id} className="contents">
                    <div className="sticky left-0 z-10 border-b border-[var(--cb-bg)] bg-white px-3 py-2">
                      <div className="text-sm font-bold text-[var(--cb-text)]">
                        {t.name} {t.code ? <span className="text-xs font-medium text-[var(--cb-muted)]">(Mã: {t.code})</span> : null}
                      </div>
                      <div className="text-xs text-[var(--cb-muted)]">Phòng trống</div>
                    </div>
                    {days.map((date, i) => {
                      const n = left[i] ?? 0;
                      if (invChannel !== "all") {
                        const typePlans = plans.filter((p) => p.channelCode === invChannel && p.roomTypeId === t.id);
                        if (typePlans.length === 0) {
                          return (
                            <div key={date} className="border-b border-l border-[var(--cb-bg)] bg-[var(--cb-blue-soft)] px-2 py-2 text-center text-xs text-[var(--cb-muted)]" title="Kênh này chưa có gói cho loại phòng này">
                              —
                            </div>
                          );
                        }
                        if (inventoryBlockOn(invBlocks, invChannel, t.id, date)) {
                          return (
                            <div key={date} className="border-b border-l border-[var(--cb-bg)] bg-[var(--cb-blue-soft)] px-2 py-2 text-center text-xs font-semibold text-[var(--cb-muted)]" title="Đang bị đóng bán cấp kênh hoặc cấp loại phòng">
                              Đóng
                            </div>
                          );
                        }
                        if (typePlans.every((p) => restrictions[keyOf(p.id, date)]?.stopSell)) {
                          return (
                            <div key={date} className="border-b border-l border-[var(--cb-bg)] bg-[var(--cb-blue-soft)] px-2 py-2 text-center text-xs font-semibold text-[var(--cb-muted)]" title="Mọi gói của kênh này đều đang ngừng bán ngày này">
                              Đóng
                            </div>
                          );
                        }
                      }
                      return (
                        <div key={date} className={`border-b border-l border-[var(--cb-bg)] px-2 py-2 text-center text-sm font-bold ${n <= 0 ? "bg-[#fde9c8] text-[#e5484d]" : n === 1 ? "text-[#e5484d]" : "text-[var(--cb-text)]"}`}>
                          {n}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
          <p className="mt-2 text-xs text-[var(--cb-muted)]">
            Chú thích: ô vàng = hết phòng (0 phòng trống). Quỹ phòng là chung cho mọi kênh nên chọn 1 kênh không làm số tồn thay đổi — nó chỉ cho thấy kênh đó có bán được ngày đó không: ô “Đóng” = bị đóng cấp kênh/loại hoặc mọi gói của kênh đều ngừng bán; ô “—” = kênh chưa có gói cho loại phòng này. Muốn chặn phòng hỏng hay đóng bán thì sang trang “Chặn phòng &amp; Đóng bán”:
          </p>
          <div className="mt-3">
            <a href={`/${HOTEL_ID}/inventory`} className="cb-btn-ghost px-3 py-2 text-sm">
              Quản lý chặn phòng &amp; đóng bán →
            </a>
          </div>
        </>
      )}

      {/* ===== TAB 2: GIA THEO KENH ===== */}
      {tab === "prices" && (
      <>
      {/* thanh cong cu: loc kenh + loc loai phong + ngay + dong ban + cap nhat hang loat */}
      <div className="mt-3 flex flex-wrap items-end gap-3 text-sm text-[var(--cb-text)]">
        <label>
          Kênh bán
          <select value={priceChannel} onChange={(e) => setPriceChannel(e.target.value)} className={`${inputCls} ml-2`}>
            <option value="all">Tất cả các kênh</option>
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
          <select value={priceTypeFilter} onChange={(e) => setPriceTypeFilter(e.target.value)} className={`${inputCls} ml-2`}>
            <option value="all">Tất cả loại phòng</option>
            {roomTypesDb.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </label>
        <span className="ml-auto flex items-center gap-2">
          <button onClick={() => setStartDate(addDays(startDate, -WINDOW))} className="cb-btn-ghost px-3 py-2" title="Lùi 14 ngày">‹</button>
          <DatePicker value={startDate} onChange={(v) => v && setStartDate(v)} />
          <button onClick={() => setStartDate(addDays(startDate, WINDOW))} className="cb-btn-ghost px-3 py-2" title="Tiến 14 ngày">›</button>
        </span>
        <button
          onClick={() => {
            // Mo panel bang dung cua so luoi dang xem + loai phong
            // dang loc (giong nut Cap nhat hang loat) — truoc day
            // panel mo o ngay mau 21/10/2026, loai phong mau.
            if (priceTypeFilter !== "all") setIbType(priceTypeFilter);
            setIbFrom(startDate);
            setIbTo(addDays(startDate, 13));
            setShowInvPanel((v) => !v);
          }}
          className="cb-btn-ghost px-3 py-2 text-sm"
        >
          Đóng bán
        </button>
        <button
          onClick={() => {
            if (priceChannel !== "all") setBulkChannel(priceChannel);
            if (priceTypeFilter !== "all") setBulkType(priceTypeFilter);
            setBulkFrom(startDate);
            setBulkTo(addDays(startDate, 13));
            setShowBulk((v) => !v);
          }}
          className="cb-btn-primary inline-flex items-center gap-1.5 px-3 py-2 text-sm"
        >
          <IconZap className="h-4 w-4" /> Cập nhật hàng loạt
        </button>
      </div>

      {/* sync status bar */}
      {priceChannel !== "all" && focusChannelObj && (
        <div className="cb-card mt-4 flex items-center gap-3 px-4 py-3 text-sm text-[var(--cb-text)]">
          {focusChannelObj.type === "ota" ? (
            dirtyChannels.has(priceChannel) ? (
              <>
                <span className="text-[#f59e0b]">●</span> Kênh {focusChannelObj.name} có thay đổi chưa đẩy lên Channex
                <button onClick={() => pushToChannex(priceChannel)} className="cb-btn-primary ml-auto px-3 py-1.5 text-sm">
                  Đẩy lên Channex ngay
                </button>
              </>
            ) : (
              <><span className="text-[#1db584]">●</span> Channex: đã đồng bộ</>
            )
          ) : (
            <><span className="text-[var(--cb-muted)]">●</span> Kênh này bán trực tiếp trong PMS, không qua Channex</>
          )}
        </div>
      )}

      {/* grid */}
      <div className="mt-4 overflow-x-auto rounded-xl border border-[var(--cb-border)] bg-white shadow-[0_1px_3px_rgba(16,28,66,0.06)]">
        <div className="grid min-w-[1500px]" style={gridCols}>
          <DateHeader />
          {visibleTypes.map((t) => (
            <div key={t.id} className="contents">
              <div className="sticky left-0 z-10 border-b border-[var(--cb-bg)] bg-[var(--cb-blue-soft)] px-3 py-2 text-sm font-bold text-[var(--cb-text)]">
                <button
                  onClick={() =>
                    setCollapsedTypes((prev) => {
                      const next = new Set(prev);
                      if (next.has(t.id)) next.delete(t.id);
                      else next.add(t.id);
                      return next;
                    })
                  }
                  className="mr-1.5 inline-flex h-5 w-5 items-center justify-center rounded border border-[var(--cb-border)] bg-white text-xs font-bold text-[var(--cb-muted)]"
                  title={collapsedTypes.has(t.id) ? "Mở ra xem giá" : "Thu gọn loại phòng này"}
                >
                  {collapsedTypes.has(t.id) ? "+" : "-"}
                </button>
                {t.name} {t.code ? <span className="text-xs font-medium text-[var(--cb-muted)]">(Mã: {t.code})</span> : null}
              </div>
              {days.map((d) => (
                <div key={d} className="border-b border-l border-[var(--cb-bg)] bg-[var(--cb-blue-soft)]" />
              ))}
              {!collapsedTypes.has(t.id) &&
                visibleChannels.map((c) => (
                  <ChannelPriceRows key={`${c.code}|${t.id}`} channelCode={c.code} typeId={t.id} />
                ))}
            </div>
          ))}
        </div>
      </div>

      <p className="mt-2 text-xs text-[var(--cb-muted)]">
        Bấm ô giá để sửa. Giá trống hiện dấu —. Tồn phòng xem ở tab Tồn phòng. Đóng bán theo kênh hoặc cả loại phòng dùng nút Đóng bán.
      </p>

      {/* inventory blocks panel (stop-sell cap kenh & cap loai phong) */}
      {showInvPanel && (
        <div className="cb-card mt-4 p-4">
          <div className="text-sm font-semibold text-[var(--cb-text)]">Đóng bán cấp kênh & cấp loại phòng</div>
          <p className="mt-1 text-xs text-[var(--cb-muted)]">
            Đóng bán theo kênh chỉ ảnh hưởng kênh đó; đóng cả loại phòng ảnh hưởng mọi kênh. Khi bị đóng ở đây, lưới giá hiện “ĐÓNG BÁN” và dòng Ngừng bán hiện “bị khoá”.
          </p>
          {invBlocks.length > 0 && (
            <table className="mt-3 w-full text-sm text-[var(--cb-text)]">
              <thead>
                <tr className="text-left text-xs text-[var(--cb-muted)]">
                  <th className="py-1 pr-3">Cấp đóng</th>
                  <th className="py-1 pr-3">Loại phòng</th>
                  <th className="py-1 pr-3">Khoảng ngày</th>
                  <th className="py-1 pr-3">Lý do</th>
                  <th className="py-1"></th>
                </tr>
              </thead>
              <tbody>
                {invBlocks.map((b) => (
                  <tr key={b.id} className="border-t border-[var(--cb-bg)]">
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
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[var(--cb-bg)] pt-3 text-sm text-[var(--cb-text)]">
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
            <DateRangePicker from={ibFrom} to={ibTo} onChange={(f, t) => { setIbFrom(f); setIbTo(t); }} />
            <input value={ibReason} onChange={(e) => setIbReason(e.target.value)} className={`${inputCls} w-52`} placeholder="Lý do (không bắt buộc)" />
            <button onClick={addInvBlock} className="cb-btn-primary px-4 py-2 text-sm">Thêm đóng bán</button>
          </div>
        </div>
      )}

      {/* bulk update panel */}
      {showBulk && (
        <div className="cb-card mt-4 p-4">
          <div className="flex items-center gap-1.5 text-sm font-semibold text-[var(--cb-text)]"><IconZap className="h-4 w-4" /> Cập nhật hàng loạt — đặt giá theo khoảng ngày + thứ trong tuần</div>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-[var(--cb-text)]">
            <select value={bulkChannel} onChange={(e) => setBulkChannel(e.target.value)} className={inputCls}>
              {CHANNELS.map((c) => (
                <option key={c.code} value={c.code}>{c.name}</option>
              ))}
            </select>
            <select value={bulkType} onChange={(e) => setBulkType(e.target.value)} className={inputCls}>
              {roomTypesDb.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
            <DateRangePicker from={bulkFrom} to={bulkTo} onChange={(f, t) => { setBulkFrom(f); setBulkTo(t); }} />
            <select value={bulkMode} onChange={(e) => setBulkMode(e.target.value as typeof bulkMode)} className={inputCls}>
              <option value="percent">thay đổi %</option>
              <option value="amount">cộng/trừ tiền</option>
              <option value="set">đặt giá cố định</option>
            </select>
            <input type="number" value={bulkValue} onChange={(e) => setBulkValue(Number(e.target.value))} className={`${inputCls} w-28`} />
            <button onClick={() => void applyBulk()} className="cb-btn-primary px-4 py-2 text-sm">Áp dụng cho {bulkDates.length} ngày</button>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-[var(--cb-text)]">
            <span className="text-[var(--cb-muted)]">Chỉ áp dụng vào:</span>
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
            <span className="text-xs text-[var(--cb-muted)]">(VD: chỉ tích T7 + CN để tăng giá cuối tuần cả mùa)</span>
          </div>
        </div>
      )}

      {/* selected cell editor */}
      {selected && selectedPlan && (
        <div className="cb-card mt-4 p-4">
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <div className="text-xs text-[var(--cb-muted)]">Đang sửa ô giá</div>
              <div className="text-sm font-semibold text-[var(--cb-text)]">
                {CHANNELS.find((c) => c.code === selectedPlan.channelCode)?.name ?? selectedPlan.channelCode} · {roomTypesDb.find((t) => t.id === selectedPlan.roomTypeId)?.name ?? selectedPlan.roomTypeId} · {dayParts(selected.date).wd} {selected.date}
              </div>
            </div>
            <label className="text-sm text-[var(--cb-text)]">
              Giá ({currency === "USD" ? "USD" : "VNĐ"})
              <input
                type="number"
                step={1000}
                placeholder="—"
                value={selectedPlan.prices[selected.date] ?? ""}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v !== "") setPrice(selected.planId, selected.date, Number(v));
                }}
                className={`${inputCls} ml-2 w-36`}
              />
            </label>
            {selectedPlan.prices[selected.date] !== undefined && (
              <button
                onClick={() => clearPrice(selected.planId, selected.date)}
                className="rounded-lg border border-[var(--cb-border)] bg-white px-4 py-2 text-sm font-semibold text-[#e5484d] hover:bg-[var(--cb-blue-soft)]"
              >
                Xoá giá ngày này
              </button>
            )}
            <button
              onClick={() => setRestriction(selected.planId, selected.date, { stopSell: !selectedRestriction?.stopSell })}
              className={`rounded-lg px-4 py-2 text-sm font-semibold text-white ${selectedRestriction?.stopSell ? "bg-[#1db584]" : "bg-[#e5484d]"}`}
            >
              {selectedRestriction?.stopSell ? "Mở bán ngày này" : "Đóng bán ngày này"}
            </button>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-4 text-sm text-[var(--cb-text)]">
            <span className="font-medium text-[var(--cb-muted)]">Hạn chế ngày này:</span>
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
      </>)}
    </div>
  );
}
