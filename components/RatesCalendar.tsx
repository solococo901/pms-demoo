"use client";
// RATES9 — components/RatesCalendar.tsx (Lich gia)
// Gia goc = gia Website; gia kenh suy ra theo % hoa hong, sua tay duoc tung o (override).
// Popup Cap nhat nhanh: nut Cap nhat chi bat khi co thay doi that (gia / ngung ban / so dem toi thieu khac gia tri hien tai cua it nhat 1 ngay trong khoang).

import { useEffect, useMemo, useRef, useState } from "react";
import {
  CHANNELS,
  CHANNEL_FORMULA,
  INVENTORY_BLOCKS,
  RATE_PLANS,
  RESERVATIONS,
  ROOM_BLOCKS,
  ROOM_TYPES,
  ROOMS,
  TODAY,
  getFormula,
  getHotelData,
  inventoryBlockOn,
  resolvePlanPrice,
  roomBlockOn,
  type InventoryBlock,
  type RatePlan,
  type RoomType,
} from "@/lib/mock-data";
import { supabase } from "@/lib/supabase";
import { writeAuditLog } from "@/lib/audit-log";
import { currentHotelId } from "@/lib/current-hotel";
import { useParams, useRouter } from "next/navigation";
import { queueChannexDates, rangeDates } from "@/lib/channex-outbox";
import { DatePicker, DateRangePicker } from "@/components/DatePicker";
import { IconZap } from "@/components/icons";

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
type ViewMode = "prices" | "availability" | "restrictions";

const inputCls = "rounded-lg border border-line px-2 py-2 text-ink outline-none focus:border-primary";
const WEEKEND_DAYS: number[] = getHotelData("cityhouse-mark").config?.weekendDays ?? [0, 6];

export default function RatesCalendar() {
  // Khach san lay tu URL; neu khong thi dung khach san da luu theo tab.
  const params = useParams();
  const HOTEL_ID = typeof params.hotelId === "string" ? params.hotelId : currentHotelId();
  const router = useRouter();

  const [view, setView] = useState<ViewMode>("prices");
  const [visibleTypeIds, setVisibleTypeIds] = useState<Set<string> | null>(null); // null = tat ca loai phong
  const [visibleChannels, setVisibleChannels] = useState<Set<string> | null>(null); // null = tat ca kenh
  const [collapsedTypes, setCollapsedTypes] = useState<Set<string>>(new Set());
  const [invChannel, setInvChannel] = useState<string>("all"); // che do Ton phong: kenh dang kiem tra
  const [startDate, setStartDate] = useState<string>(TODAY);
  const [todayStr, setTodayStr] = useState<string>(TODAY);

  const [plans, setPlans] = useState<RatePlan[]>(RATE_PLANS.map((p) => ({ ...p, prices: { ...p.prices } })));
  const [roomTypesDb, setRoomTypesDb] = useState<RoomType[]>(ROOM_TYPES);
  const [restrictions, setRestrictions] = useState<Record<CellKey, Restriction>>({});
  const [overrides, setOverrides] = useState<Record<CellKey, number>>({}); // gia sua tay cua goi suy ra
  const [invBlocks, setInvBlocks] = useState<InventoryBlock[]>(INVENTORY_BLOCKS); // stop-sell cap kenh & loai phong
  // Phong/don/chan phong: bat dau la du lieu mau, loader duoi thay bang du lieu DB.
  const [roomsDb, setRoomsDb] = useState(ROOMS);
  const [reservationsDb, setReservationsDb] = useState(RESERVATIONS);
  const [roomBlocksDb, setRoomBlocksDb] = useState(ROOM_BLOCKS);
  const [dirtyChannels, setDirtyChannels] = useState<Set<string>>(new Set());
  const [dbError, setDbError] = useState("");

  // Sua gia truc tiep trong o.
  const [editing, setEditing] = useState<{ planId: string; date: string } | null>(null);
  const [editValue, setEditValue] = useState("");
  const [editError, setEditError] = useState("");
  // Bang sua nhanh han che cua 1 o (hien dang popover gan o do).
  const [popCell, setPopCell] = useState<{ planId: string; date: string; x: number; y: number } | null>(null);

  // Popup Cap nhat nhanh (mo khi bam 1 o gia).
  const [quick, setQuick] = useState<{ planId: string; date: string } | null>(null);
  const [quKind, setQuKind] = useState<"price" | "stop_sell" | "min_stay">("price");
  const [quFrom, setQuFrom] = useState("");
  const [quTo, setQuTo] = useState("");
  const [quPrice, setQuPrice] = useState("");
  const [quStopSell, setQuStopSell] = useState(false);
  const [quMinStay, setQuMinStay] = useState("1");
  const [quError, setQuError] = useState("");
  const [quSaving, setQuSaving] = useState(false);


  // Phan hoi sau khi luu: thong bao + hoan tac + o vua sua sang xanh + nhat ky thay doi.
  const [toast, setToast] = useState<{ text: string; onUndo?: () => void } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [justSaved, setJustSaved] = useState<Set<string>>(new Set());
  const [changeLog, setChangeLog] = useState<{ time: string; text: string }[]>([]);
  const [showLog, setShowLog] = useState(false);
  const [showLegend, setShowLegend] = useState(false);

  // Cua so Dong ban cap kenh & cap loai phong.
  const [invOpen, setInvOpen] = useState(false);
  const [ibScope, setIbScope] = useState<"channel" | "room_type">("channel");
  const [ibChannel, setIbChannel] = useState<string>("airbnb");
  const [ibType, setIbType] = useState<string>("deluxe");
  const [ibFrom, setIbFrom] = useState(TODAY);
  const [ibTo, setIbTo] = useState(addDays(TODAY, 2));
  const [ibReason, setIbReason] = useState("");

  // Chong tao trung goi chuan khi bam nhanh 2 o cung kenh + loai.
  const ensuringRef = useRef<Set<string>>(new Set());

  const days = useMemo(() => Array.from({ length: WINDOW }, (_, i) => addDays(startDate, i)), [startDate]);

  // Ngay hom nay that, tinh sau khi mount de khong lech ngay.
  useEffect(() => {
    const d = new Date();
    const s = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    setTodayStr(s);
    setStartDate(s);
  }, []);

  // Ton = phong ban duoc tru don dang giu (phong hong tru, phong tam dong khong tru).
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

  function showToast(text: string, onUndo?: () => void) {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ text, onUndo });
    toastTimer.current = setTimeout(() => setToast(null), 10000);
  }

  function logChange(text: string) {
    const now = new Date();
    const time = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    setChangeLog((prev) => [{ time, text }, ...prev].slice(0, 20));
  }

  function flashSaved(keys: string[]) {
    setJustSaved(new Set(keys));
    setTimeout(() => setJustSaved(new Set()), 4000);
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
        const loaded: RoomType[] = (typesRes.data ?? []).map((t) => ({
          id: t.id, code: t.code ?? undefined, name: t.name,
          maxOccupancy: t.max_occupancy, maxAdults: t.max_adults,
          maxChildren: t.max_children, maxInfants: t.max_infants,
          bedConfig: t.bed_config ?? "", sizeM2: t.size_sqm ?? undefined,
          priceFloor: t.min_price ?? undefined, priceCeiling: t.max_price ?? undefined,
          active: t.active,
        }));
        setRoomTypesDb(loaded);
        // Loai phong mac dinh "deluxe" la id mau, khong co trong DB that:
        // o chon hien loai dau tien nhung gia tri gui di van la "deluxe"
        // (loi khoa ngoai) — dong bo lai theo loai dau tien vua tai.
        setIbType((cur) => (loaded.some((t) => t.id === cur) ? cur : loaded[0].id));
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
      const dbOverrides: Record<CellKey, number> = {};
      for (const row of rows) {
        const plan = dbPlans.find((p) => p.id === row.rate_plan_id);
        if (!plan) continue;
        // Gia cua goi suy ra khong nam trong plan.prices — dong gia cua no CHINH LA gia sua tay (override).
        if (plan.derivedFromId) dbOverrides[keyOf(row.rate_plan_id, row.date)] = Number(row.price);
        else plan.prices[row.date] = Number(row.price);
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
      setOverrides(dbOverrides);
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

  // Gia hien thi cua 1 o: goi goc lay gia da luu; goi suy ra tinh tu gia goc (+ cong thuc), gia sua tay thang.
  function priceForCell(plan: RatePlan, date: string): number | undefined {
    if (!plan.derivedFromId) return plan.prices[date];
    return resolvePlanPrice(plan, date, plans, overrides);
  }

  // Ten hien thi cho log gia: ten loai phong + ten kenh + ngay dd/MM/yyyy.
  function priceLogLabel(plan: RatePlan, date: string) {
    return {
      chName: CHANNELS.find((c) => c.code === plan.channelCode)?.name ?? plan.channelCode,
      typeName: roomTypesDb.find((t) => t.id === plan.roomTypeId)?.name ?? plan.roomTypeId,
      dateShort: date.split("-").reverse().join("/"),
    };
  }

  // ---------- Supabase: save one cell (price + restrictions) ----------
  async function persistCell(planId: string, date: string, price: number, restr?: Restriction): Promise<boolean> {
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
    if (error) {
      setDbError("Lưu giá không thành công: " + error.message);
      return false;
    }
    queueChannexDates([date]);
    return true;
  }

  async function setPrice(planId: string, date: string, price: number) {
    const plan = plans.find((p) => p.id === planId);
    if (!plan) return;
    const oldPrice = priceForCell(plan, date);
    // Goi suy ra: gia nhap tay la override — ghi vao bang overrides, khong ghi vao plan.prices.
    if (plan.derivedFromId) setOverrides((prev) => ({ ...prev, [keyOf(planId, date)]: price }));
    else setPlans((prev) => prev.map((p) => (p.id === planId ? { ...p, prices: { ...p.prices, [date]: price } } : p)));
    markDirty(plan.channelCode);
    const saved = await persistCell(planId, date, price);
    if (saved && oldPrice !== price) {
      const { chName, typeName, dateShort } = priceLogLabel(plan, date);
      writeAuditLog({
        hotelId: HOTEL_ID,
        accountId: ACCOUNT_ID,
        action: "price_updated",
        entityType: "rate_price",
        entityId: planId,
        summary: `Đổi giá ${typeName} · ${chName} · ${dateShort}: ${oldPrice !== undefined ? fmt(oldPrice) : "—"} → ${fmt(price)}`,
        details: { planId, date, oldPrice: oldPrice ?? null, newPrice: price, channelCode: plan.channelCode, roomTypeId: plan.roomTypeId },
      });
    }
  }

  function clearPrice(planId: string, date: string) {
    const plan = plans.find((p) => p.id === planId);
    if (!plan) return;
    const oldPrice = priceForCell(plan, date);
    // Goi suy ra: xoa gia sua tay de o ve lai gia suy ra; goi goc: xoa gia luon.
    if (plan.derivedFromId) {
      setOverrides((prev) => {
        const next = { ...prev };
        delete next[keyOf(planId, date)];
        return next;
      });
    } else {
      setPlans((prev) => prev.map((p) => {
        if (p.id !== planId) return p;
        const next = { ...p.prices };
        delete next[date];
        return { ...p, prices: next };
      }));
    }
    markDirty(plan.channelCode);
    supabase
      .from("rate_prices")
      .delete()
      .eq("rate_plan_id", planId)
      .eq("date", date)
      .then(({ error }) => {
        if (error) setDbError("Xoá giá không thành công: " + error.message);
        else {
          queueChannexDates([date]);
          if (oldPrice !== undefined) {
            const { chName, typeName, dateShort } = priceLogLabel(plan, date);
            writeAuditLog({
              hotelId: HOTEL_ID,
              accountId: ACCOUNT_ID,
              action: "price_updated",
              entityType: "rate_price",
              entityId: planId,
              summary: `Xoá giá ${typeName} · ${chName} · ${dateShort} (giá cũ ${fmt(oldPrice)})`,
              details: { planId, date, oldPrice, newPrice: null, channelCode: plan.channelCode, roomTypeId: plan.roomTypeId },
            });
          }
        }
      });
  }

  function setRestriction(planId: string, date: string, patch: Restriction) {
    const merged = { ...restrictions[keyOf(planId, date)], ...patch };
    setRestrictions((prev) => ({ ...prev, [keyOf(planId, date)]: merged }));
    const plan = plans.find((p) => p.id === planId);
    if (plan) {
      markDirty(plan.channelCode);
      persistCell(planId, date, priceForCell(plan, date) ?? 0, merged);
    }
  }

  function pushToChannex(code: string) {
    // Day thay doi vao hang doi Channex ngay de gui di trong vai giay.
    queueChannexDates(days, HOTEL_ID);
    setDirtyChannels((prev) => {
      const next = new Set(prev);
      next.delete(code);
      return next;
    });
  }

  function pushAllToChannex() {
    queueChannexDates(days, HOTEL_ID);
    setDirtyChannels(new Set());
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

  // ---------- goi chuan cua kenh ----------
  // Gia kenh = goi chuan duy nhat: goi goc (khong ke thua, uu tien chi phong), neu khong co thi goi suy ra theo cong thuc cua kenh.
  function standardPlanFor(channelCode: string, roomTypeId: string): RatePlan | undefined {
    const cands = plans.filter((p) => p.channelCode === channelCode && p.roomTypeId === roomTypeId);
    return (
      cands.find((p) => !p.derivedFromId && (p.mealPlan ?? "room_only") === "room_only") ??
      cands.find((p) => p.derivedFromId && p.formulaId === CHANNEL_FORMULA[channelCode]) ??
      cands.find((p) => p.derivedFromId) ??
      cands[0]
    );
  }

  // Chua co goi chuan thi tao goi chuan (ten kenh, huy linh hoat, chi phong) roi moi ghi gia.
  // Goi cua kenh OTA / Le tan tao san la goi suy ra tu gia Website (Le tan khong cong them: gia = gia goc).
  async function ensureStandardPlan(channelCode: string, roomTypeId: string): Promise<RatePlan | undefined> {
    const existing = standardPlanFor(channelCode, roomTypeId);
    if (existing) return existing;
    const key = `${channelCode}|${roomTypeId}`;
    if (ensuringRef.current.has(key)) return undefined;
    ensuringRef.current.add(key);
    try {
      const chName = CHANNELS.find((c) => c.code === channelCode)?.name ?? channelCode;
      const id = `plan-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      let derivedFromId: string | undefined;
      let formulaId: string | undefined;
      if (channelCode !== "website") {
        const webPlan = await ensureStandardPlan("website", roomTypeId);
        if (!webPlan) return undefined;
        derivedFromId = webPlan.id;
        formulaId = CHANNEL_FORMULA[channelCode];
      }
      const { error } = await supabase.from("rate_plans").insert({
        id, hotel_id: HOTEL_ID, account_id: ACCOUNT_ID,
        room_type_id: roomTypeId, channel_code: channelCode,
        name: chName, cancellation_policy: "flexible", meal_plan: "room_only", policy_id: null,
        derived_from_id: derivedFromId ?? null, formula_id: formulaId ?? null,
      });
      if (error) {
        setDbError("Tạo gói chuẩn không thành công: " + error.message);
        return undefined;
      }
      const np: RatePlan = {
        id, channelCode, roomTypeId, name: chName,
        cancellationPolicy: "flexible", mealPlan: "room_only", prices: {},
        derivedFromId, formulaId,
      };
      setPlans((prev) => [...prev, np]);
      return np;
    } finally {
      ensuringRef.current.delete(key);
    }
  }

  // ---------- sua gia truc tiep trong o ----------
  async function startEdit(channelCode: string, roomTypeId: string, date: string) {
    const plan = await ensureStandardPlan(channelCode, roomTypeId);
    if (!plan) return;
    const cur = priceForCell(plan, date);
    setEditing({ planId: plan.id, date });
    setEditValue(cur !== undefined ? String(cur) : "");
    setEditError("");
  }

  // Luu o dang sua: bao ro gia cu -> gia moi + nut Hoan tac (tranh bam nham luu sai gia).
  function commitEdit(moveNext: boolean) {
    if (!editing) return;
    const plan = plans.find((p) => p.id === editing.planId);
    const v = editValue.trim();
    const oldPrice = plan ? priceForCell(plan, editing.date) : undefined;
    const oldHad = plan
      ? plan.derivedFromId
        ? overrides[keyOf(plan.id, editing.date)] !== undefined
        : plan.prices[editing.date] !== undefined
      : false;
    const chName = plan ? CHANNELS.find((c) => c.code === plan.channelCode)?.name ?? plan.channelCode : "";
    const typeName = plan ? roomTypesDb.find((t) => t.id === plan.roomTypeId)?.name ?? plan.roomTypeId : "";
    const restoreOld = () => {
      if (!plan) return;
      if (oldHad && oldPrice !== undefined) setPrice(plan.id, editing.date, oldPrice);
      else clearPrice(plan.id, editing.date);
      flashSaved([keyOf(plan.id, editing.date)]);
    };
    if (v === "") {
      if (plan) clearPrice(plan.id, editing.date);
      flashSaved([keyOf(editing.planId, editing.date)]);
      if (!moveNext && plan) {
        showToast(
          `Đã xoá giá ${chName} · ${typeName} · ${editing.date}${oldPrice !== undefined ? ` (giá cũ ${fmt(oldPrice)})` : ""}.`,
          () => { restoreOld(); showToast("Đã hoàn tác."); }
        );
      }
    } else if (!/^\d+$/.test(v) || Number(v) < 0) {
      setEditError("Chỉ nhập số tiền (không âm)");
      return;
    } else {
      if (plan) {
        setPrice(plan.id, editing.date, Number(v));
        flashSaved([keyOf(editing.planId, editing.date)]);
        if (!moveNext) {
          showToast(
            `Đã sửa giá ${chName} · ${typeName} · ${editing.date}: ${oldPrice !== undefined ? fmt(oldPrice) : "—"} → ${fmt(Number(v))}.`,
            () => { restoreOld(); showToast("Đã hoàn tác."); }
          );
        }
      }
    }
    if (moveNext && plan) {
      const idx = days.indexOf(editing.date);
      if (idx >= 0 && idx < days.length - 1) {
        const nextDate = days[idx + 1];
        const cur = priceForCell(plan, nextDate);
        setEditing({ planId: plan.id, date: nextDate });
        setEditValue(cur !== undefined ? String(cur) : "");
        setEditError("");
        return;
      }
    }
    setEditing(null);
    setEditError("");
  }

  function cancelEdit() {
    setEditing(null);
    setEditError("");
  }

  // ---------- popup Cap nhat nhanh ----------
  async function openQuickUpdate(channelCode: string, roomTypeId: string, date: string) {
    const plan = await ensureStandardPlan(channelCode, roomTypeId);
    if (!plan) return;
    const cur = priceForCell(plan, date);
    const r = restrictions[keyOf(plan.id, date)] ?? {};
    setQuick({ planId: plan.id, date });
    setQuKind("price");
    setQuFrom(date);
    setQuTo(date);
    setQuPrice(cur !== undefined ? String(cur) : "");
    setQuStopSell(!!r.stopSell);
    setQuMinStay(String(r.minStay ?? 1));
    setQuError("");
  }

  function closeQuickUpdate() {
    setQuick(null);
    setQuError("");
  }

  async function applyQuickUpdate() {
    if (!quick || quSaving) return;
    const plan = plans.find((p) => p.id === quick.planId);
    if (!plan) return;
    const from = quFrom || quick.date;
    const to = quTo || quFrom || quick.date;
    if (to < from) { setQuError("Ngày kết thúc phải sau ngày bắt đầu."); return; }
    const dates = rangeDates(from, to);
    if (dates.length === 0) { setQuError("Khoảng ngày không hợp lệ."); return; }
    const { chName, typeName } = priceLogLabel(plan, from);
    const dShort = (d: string) => d.split("-").reverse().join("/");
    const rangeLabel = from === to ? dShort(from) : `${dShort(from)} → ${dShort(to)}`;
    setQuSaving(true);
    setQuError("");

    if (quKind === "price") {
      const v = quPrice.replace(/[^\d]/g, "");
      // Anh cu cho hoan tac + mo ta gia cu (1 muc gia duy nhat thi hien so, khac nhau thi ghi "nhieu muc gia").
      const snap = new Map<string, { price: number | undefined; had: boolean }>();
      dates.forEach((d) => {
        const had = plan.derivedFromId ? overrides[keyOf(plan.id, d)] !== undefined : plan.prices[d] !== undefined;
        snap.set(d, { price: priceForCell(plan, d), had });
      });
      const oldPrices = [...new Set([...snap.values()].map((c) => c.price))];
      const oldDesc = oldPrices.length === 1 ? (oldPrices[0] !== undefined ? fmt(oldPrices[0]) : "—") : "nhiều mức giá";
      const restoreSnap = () => {
        snap.forEach((cell, d) => {
          if (cell.had && cell.price !== undefined) setPrice(plan.id, d, cell.price);
          else clearPrice(plan.id, d);
        });
        showToast("Đã hoàn tác.");
      };
      if (v === "") {
        // Xoá giá trong khoảng (goi suy ra thi ve lai gia tu tinh).
        if (plan.derivedFromId) {
          setOverrides((prev) => {
            const next = { ...prev };
            dates.forEach((d) => { delete next[keyOf(plan.id, d)]; });
            return next;
          });
        } else {
          setPlans((prev) => prev.map((p) => {
            if (p.id !== plan.id) return p;
            const next = { ...p.prices };
            dates.forEach((d) => { delete next[d]; });
            return { ...p, prices: next };
          }));
        }
        const { error } = await supabase.from("rate_prices").delete().eq("rate_plan_id", plan.id).gte("date", from).lte("date", to);
        setQuSaving(false);
        if (error) { setDbError("Xoá giá không thành công: " + error.message); return; }
        markDirty(plan.channelCode);
        queueChannexDates(dates);
        flashSaved(dates.map((d) => keyOf(plan.id, d)));
        writeAuditLog({
          hotelId: HOTEL_ID, accountId: ACCOUNT_ID, action: "price_updated", entityType: "rate_price", entityId: plan.id,
          summary: `Xoá giá ${typeName} · ${chName} · ${rangeLabel} (${dates.length} ngày)`,
          details: { planId: plan.id, from, to, days: dates.length, newPrice: null, channelCode: plan.channelCode, roomTypeId: plan.roomTypeId },
        });
        logChange(`Xoá giá ${typeName} · ${chName} · ${rangeLabel}`);
        showToast(`Đã xoá giá ${typeName} · ${chName} · ${rangeLabel}.`, restoreSnap);
        closeQuickUpdate();
        return;
      }
      const price = Number(v);
      if (!Number.isFinite(price) || price < 0) { setQuError("Chỉ nhập số tiền (không âm)."); setQuSaving(false); return; }
      if (plan.derivedFromId) {
        setOverrides((prev) => {
          const next = { ...prev };
          dates.forEach((d) => { next[keyOf(plan.id, d)] = price; });
          return next;
        });
      } else {
        setPlans((prev) => prev.map((p) => {
          if (p.id !== plan.id) return p;
          const next = { ...p.prices };
          dates.forEach((d) => { next[d] = price; });
          return { ...p, prices: next };
        }));
      }
      const rows = dates.map((d) => {
        const r = restrictions[keyOf(plan.id, d)] ?? {};
        return { rate_plan_id: plan.id, date: d, price, min_stay: r.minStay ?? null, max_stay: r.maxStay ?? null, stop_sell: !!r.stopSell, cta: !!r.cta, ctd: !!r.ctd };
      });
      const { error } = await supabase.from("rate_prices").upsert(rows);
      setQuSaving(false);
      if (error) { setDbError("Lưu giá không thành công: " + error.message); return; }
      markDirty(plan.channelCode);
      queueChannexDates(dates);
      flashSaved(dates.map((d) => keyOf(plan.id, d)));
      writeAuditLog({
        hotelId: HOTEL_ID, accountId: ACCOUNT_ID, action: "price_updated", entityType: "rate_price", entityId: plan.id,
        summary: `Đổi giá ${typeName} · ${chName} · ${rangeLabel} (${dates.length} ngày): ${oldDesc} → ${fmt(price)}`,
        details: { planId: plan.id, from, to, days: dates.length, oldPrices: [...snap.values()].map((c) => c.price), newPrice: price, channelCode: plan.channelCode, roomTypeId: plan.roomTypeId },
      });
      logChange(`Đổi giá ${typeName} · ${chName} · ${rangeLabel}: ${oldDesc} → ${fmt(price)}`);
      showToast(`Đã đổi giá ${typeName} · ${chName} · ${rangeLabel}: ${oldDesc} → ${fmt(price)}.`, restoreSnap);
      closeQuickUpdate();
      return;
    }

    // Ngung ban / So dem toi thieu: doi han che tung ngay trong khoang (1 log chung).
    if (quKind === "stop_sell" || quKind === "min_stay") {
      if (quKind === "min_stay" && (!/^\d+$/.test(quMinStay.trim()) || Number(quMinStay) < 1)) { setQuError("Số đêm tối thiểu phải là số nguyên từ 1 trở lên."); setQuSaving(false); return; }
      const patch: Restriction = quKind === "stop_sell" ? { stopSell: quStopSell } : { minStay: Math.max(1, Number(quMinStay) || 1) };
      for (const d of dates) setRestriction(plan.id, d, patch);
      flashSaved(dates.map((d) => keyOf(plan.id, d)));
      const label = quKind === "stop_sell"
        ? (quStopSell ? `Ngừng bán ${typeName} · ${chName} · ${rangeLabel}` : `Mở bán lại ${typeName} · ${chName} · ${rangeLabel}`)
        : `Đổi số đêm tối thiểu ${typeName} · ${chName} · ${rangeLabel}: ${patch.minStay} đêm`;
      writeAuditLog({
        hotelId: HOTEL_ID, accountId: ACCOUNT_ID, action: "price_updated", entityType: "rate_price", entityId: plan.id,
        summary: label,
        details: { planId: plan.id, from, to, days: dates.length, kind: quKind, ...(quKind === "stop_sell" ? { stopSell: quStopSell } : { minStay: patch.minStay }), channelCode: plan.channelCode, roomTypeId: plan.roomTypeId },
      });
      logChange(label);
      showToast(`Đã cập nhật: ${label}.`);
      setQuSaving(false);
      closeQuickUpdate();
      return;
    }
  }

  async function toggleStopSell(channelCode: string, roomTypeId: string, date: string) {
    const plan = await ensureStandardPlan(channelCode, roomTypeId);
    if (!plan) return;
    const stopped = !!restrictions[keyOf(plan.id, date)]?.stopSell;
    setRestriction(plan.id, date, { stopSell: !stopped });
    flashSaved([keyOf(plan.id, date)]);
  }


  // ---------- shared grid pieces ----------
  const gridCols = { gridTemplateColumns: `230px repeat(${days.length}, minmax(88px, 1fr))` } as const;
  const visibleTypes = roomTypesDb.filter((t) => !visibleTypeIds || visibleTypeIds.has(t.id));
  const visibleChannelList = CHANNELS.filter((c) => !visibleChannels || visibleChannels.has(c.code));
  const [openFilter, setOpenFilter] = useState<"types" | "channels" | null>(null);

  function toggleInSet(set: Set<string> | null, id: string, all: string[]): Set<string> {
    const next = new Set(set ?? all);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  }

  function weekRange(): { from: string; to: string } {
    const dow = dayParts(todayStr).dow;
    const monday = addDays(todayStr, -((dow + 6) % 7));
    return { from: monday, to: addDays(monday, 6) };
  }
  function monthRange(): { from: string; to: string } {
    const y = todayStr.slice(0, 4);
    const m = todayStr.slice(5, 7);
    const last = new Date(Number(y), Number(m), 0).getDate();
    return { from: `${y}-${m}-01`, to: `${y}-${m}-${String(last).padStart(2, "0")}` };
  }

  function DateHeader() {
    return (
      <div className="contents">
        <div className="sticky left-0 top-0 z-20 border-b border-[var(--nui-bg)] bg-primary-soft px-3 py-2 text-xs font-semibold text-muted">Ngày →</div>
        {days.map((d) => {
          const p = dayParts(d);
          const weekend = WEEKEND_DAYS.includes(p.dow);
          return (
            <div key={d} className={`sticky top-0 z-10 border-b border-l border-[var(--nui-bg)] px-2 py-2 text-center text-xs font-semibold ${d === todayStr ? "bg-primary text-white" : weekend ? "bg-danger-soft text-danger" : "bg-primary-soft text-muted"}`}>
              {p.wd} · {p.label}
              {d === todayStr && <div className="text-[10px] font-bold text-white/80">HÔM NAY</div>}
            </div>
          );
        })}
      </div>
    );
  }

  function TypeHeader({ t }: { t: RoomType }) {
    const collapsed = collapsedTypes.has(t.id);
    return (
      <div className="sticky left-0 z-10 border-b shadow-[2px_0_4px_rgba(23,41,62,0.05)] border-[var(--nui-bg)] bg-primary-soft px-3 py-2.5 text-[15px] font-bold text-ink">
        <button
          onClick={() =>
            setCollapsedTypes((prev) => {
              const next = new Set(prev);
              if (next.has(t.id)) next.delete(t.id);
              else next.add(t.id);
              return next;
            })
          }
          className="mr-1.5 inline-flex h-5 w-5 items-center justify-center rounded border border-line bg-surface text-xs font-bold text-muted"
          title={collapsed ? "Mở ra xem giá" : "Thu gọn loại phòng này"}
        >
          {collapsed ? "▸" : "▾"}
        </button>
        {t.name} {t.code ? <span className="ml-1.5 rounded-md bg-surface px-1.5 py-0.5 align-middle text-[11px] font-semibold text-muted">{t.code}</span> : null}
        <button
          onClick={() => router.push(`/${HOTEL_ID}/rates/bulk?type=${t.id}&from=${startDate}&to=${addDays(startDate, 13)}`)}
          className="ml-2 inline-flex items-center rounded border border-line bg-surface px-1.5 py-0.5 text-xs font-semibold text-muted hover:bg-primary-soft hover:text-primary"
          title="Sửa nhanh giá gốc loại phòng này cho 14 ngày đang xem"
        >
          ⚡ Sửa nhanh
        </button>
      </div>
    );
  }

  // ---------- toolbar + modals + toast ----------
  function Toolbar() {
    const dirtyCount = dirtyChannels.size;
    return (
      <div className="sticky top-0 z-30 -mx-1 rounded-xl border border-line bg-surface px-3 py-2 shadow-card">
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-1">
            <button onClick={() => setStartDate(addDays(startDate, -WINDOW))} className="cb-btn-ghost px-2.5 py-2" title="Lùi 14 ngày">‹</button>
            <button onClick={() => setStartDate(todayStr)} className="cb-btn-ghost px-2.5 py-2 text-sm font-semibold" title="Về hôm nay">Hôm nay</button>
            <button onClick={() => setStartDate(addDays(startDate, WINDOW))} className="cb-btn-ghost px-2.5 py-2" title="Tiến 14 ngày">›</button>
          </span>
          <span className="text-sm font-semibold text-ink">
            {dayParts(days[0]).label} → {dayParts(days[days.length - 1]).label}
          </span>
          <DatePicker value={startDate} onChange={(v) => v && setStartDate(v)} />
          <div className="relative">
            <button onClick={() => setOpenFilter(openFilter === "types" ? null : "types")} className="cb-btn-ghost px-3 py-2 text-sm">
              Loại phòng {visibleTypeIds ? `(${visibleTypeIds.size})` : "(tất cả)"} ▾
            </button>
            {openFilter === "types" && (
              <div className="absolute left-0 top-full z-40 mt-1 w-56 rounded-xl border border-line bg-surface p-2 shadow-card">
                <button
                  onClick={() => { setVisibleTypeIds(null); setOpenFilter(null); }}
                  className="mb-1 w-full rounded-lg px-2 py-1.5 text-left text-sm font-semibold text-primary hover:bg-primary-soft"
                >
                  Tất cả loại phòng
                </button>
                {roomTypesDb.map((t) => {
                  const checked = !visibleTypeIds || visibleTypeIds.has(t.id);
                  return (
                    <label key={t.id} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-ink hover:bg-primary-soft">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => setVisibleTypeIds((prev) => toggleInSet(prev, t.id, roomTypesDb.map((x) => x.id)))}
                      />
                      {t.name}
                    </label>
                  );
                })}
              </div>
            )}
          </div>
          <div className="relative">
            <button onClick={() => setOpenFilter(openFilter === "channels" ? null : "channels")} className="cb-btn-ghost px-3 py-2 text-sm">
              Kênh {visibleChannels ? `(${visibleChannels.size})` : "(tất cả)"} ▾
            </button>
            {openFilter === "channels" && (
              <div className="absolute left-0 top-full z-40 mt-1 w-56 rounded-xl border border-line bg-surface p-2 shadow-card">
                <button
                  onClick={() => { setVisibleChannels(null); setOpenFilter(null); }}
                  className="mb-1 w-full rounded-lg px-2 py-1.5 text-left text-sm font-semibold text-primary hover:bg-primary-soft"
                >
                  Tất cả các kênh
                </button>
                {CHANNELS.map((c) => {
                  const checked = !visibleChannels || visibleChannels.has(c.code);
                  return (
                    <label key={c.code} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-ink hover:bg-primary-soft">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => setVisibleChannels((prev) => toggleInSet(prev, c.code, CHANNELS.map((x) => x.code)))}
                      />
                      {c.name}
                    </label>
                  );
                })}
              </div>
            )}
          </div>
          <div className="flex overflow-hidden rounded-full border border-line">
            {(
              [
                ["prices", "Giá"],
                ["availability", "Tồn phòng"],
                ["restrictions", "Điều kiện bán"],
              ] as const
            ).map(([mode, label]) => (
              <button
                key={mode}
                onClick={() => setView(mode)}
                className={`px-3 py-2 text-sm font-medium ${view === mode ? "bg-primary text-white" : "bg-surface text-ink hover:bg-primary-soft"}`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="relative">
            <button onClick={() => setShowLegend((v) => !v)} className="cb-btn-ghost px-2.5 py-2 text-sm font-bold" title="Chú thích màu và ký hiệu">
              ?
            </button>
            {showLegend && (
              <div className="absolute right-0 top-full z-40 mt-1 w-72 rounded-xl border border-line bg-surface p-3 text-xs text-ink shadow-card">
                <div className="mb-2 text-sm font-semibold">Chú thích</div>
                <p className="py-0.5"><span className="font-semibold">★ Giá gốc</span> — hàng Website, sửa được, các kênh khác tự tính theo.</p>
                <p className="py-0.5"><span className="text-warning">● vàng</span> — giá sửa tay (chỉ kênh đó); xoá để về lại giá tự tính.</p>
                <p className="py-0.5"><span className="text-muted">Hàng xám + chip %</span> — giá tự tính từ giá gốc, bấm ô để sửa tay.</p>
                <p className="py-0.5"><span className="rounded bg-danger-soft px-1 font-semibold text-danger">Ô cam</span> — đang ngừng bán ngày đó.</p>
                <p className="py-0.5"><span className="font-semibold">*2</span> — ở tối thiểu 2 đêm; chip SS / CTA / CTD là các hạn chế khác.</p>
                <p className="py-0.5"><span className="font-semibold text-danger">Chữ đỏ</span> — giá kênh đang thấp hơn giá Website cùng ngày.</p>
                <p className="py-0.5"><span className="rounded bg-warning-soft px-1 font-semibold text-danger">Ô vàng nhạt</span> — hết phòng (0 phòng trống).</p>
                <p className="py-0.5"><span className="rounded bg-success-soft px-1 font-semibold text-success">Ô xanh lá</span> — vừa lưu xong.</p>
              </div>
            )}
          </div>
          <div className="relative">
            <button onClick={() => setShowLog((v) => !v)} className="cb-btn-ghost px-3 py-2 text-sm" title="Lịch sử thay đổi giá và hạn chế">
              Lịch sử {changeLog.length > 0 ? `(${changeLog.length})` : ""}
            </button>
            {showLog && (
              <div className="absolute right-0 top-full z-40 mt-1 w-96 max-w-[90vw] rounded-xl border border-line bg-surface p-3 text-xs text-ink shadow-card">
                <div className="mb-2 text-sm font-semibold">Lịch sử thay đổi</div>
                {changeLog.length === 0 ? (
                  <p className="text-muted">Chưa có thay đổi nào trong phiên này.</p>
                ) : (
                  changeLog.map((e, i) => (
                    <p key={i} className="border-t border-[var(--nui-bg)] py-1.5 first:border-t-0">
                      <span className="font-semibold text-muted">{e.time}</span> — {e.text}
                    </p>
                  ))
                )}
              </div>
            )}
          </div>
          <span className="ml-auto flex items-center gap-2">
            {dirtyCount > 0 ? (
              <>
                <span className="text-sm text-warning">● {dirtyCount} kênh có thay đổi chưa đẩy lên Channex</span>
                <button onClick={pushAllToChannex} className="cb-btn-primary px-3 py-2 text-sm">Đẩy lên Channex ngay</button>
              </>
            ) : (
              <span className="text-sm text-success">● Đã đồng bộ Channex</span>
            )}
            <button onClick={() => setInvOpen(true)} className="cb-btn-ghost px-3 py-2 text-sm">
              Đóng bán
            </button>
            <button onClick={() => router.push(`/${HOTEL_ID}/rates/bulk`)} className="cb-btn-primary inline-flex items-center gap-1.5 px-3 py-2 text-sm">
              <IconZap className="h-4 w-4" /> Cập nhật hàng loạt
            </button>
          </span>
        </div>
      </div>
    );
  }

  function InvModal() {
    if (!invOpen) return null;
    return (
      <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4" onClick={() => setInvOpen(false)}>
        <div className="my-8 w-full max-w-2xl rounded-2xl bg-surface p-5 shadow-card" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-start justify-between">
            <div>
              <div className="text-base font-bold text-ink">Đóng bán cấp kênh &amp; cấp loại phòng</div>
              <p className="mt-1 text-xs text-muted">Đóng bán theo kênh chỉ ảnh hưởng kênh đó; đóng cả loại phòng ảnh hưởng mọi kênh. Khi bị đóng ở đây, lưới giá hiện “ĐÓNG BÁN”.</p>
            </div>
            <button onClick={() => setInvOpen(false)} className="rounded-lg px-2 py-1 text-lg font-bold text-muted hover:bg-primary-soft">✕</button>
          </div>
          {invBlocks.length > 0 && (
            <table className="mt-4 w-full text-sm text-ink">
              <thead>
                <tr className="text-left text-xs text-muted">
                  <th className="py-1 pr-3">Cấp đóng</th>
                  <th className="py-1 pr-3">Loại phòng</th>
                  <th className="py-1 pr-3">Khoảng ngày</th>
                  <th className="py-1 pr-3">Lý do</th>
                  <th className="py-1"></th>
                </tr>
              </thead>
              <tbody>
                {invBlocks.map((b) => (
                  <tr key={b.id} className="border-t border-[var(--nui-bg)]">
                    <td className="py-2 pr-3 font-medium">{b.scope === "channel" ? `Kênh ${CHANNELS.find((c) => c.code === b.channelCode)?.name ?? b.channelCode}` : "Cả loại phòng (mọi kênh)"}</td>
                    <td className="py-2 pr-3">{roomTypesDb.find((t) => t.id === b.roomTypeId)?.name ?? b.roomTypeId}</td>
                    <td className="py-2 pr-3">{b.from} → {b.to}</td>
                    <td className="py-2 pr-3">{b.reason ?? "—"}</td>
                    <td className="py-2 text-right">
                      <button onClick={() => removeInvBlock(b.id)} className="font-semibold text-danger">Xoá</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-[var(--nui-bg)] pt-4 text-sm text-ink">
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
      </div>
    );
  }

  function RestrictionPopover() {
    if (!popCell) return null;
    const plan = plans.find((p) => p.id === popCell.planId);
    if (!plan) return null;
    const r = restrictions[keyOf(plan.id, popCell.date)] ?? {};
    const typeName = roomTypesDb.find((t) => t.id === plan.roomTypeId)?.name ?? plan.roomTypeId;
    const chName = CHANNELS.find((c) => c.code === plan.channelCode)?.name ?? plan.channelCode;
    const x = Math.min(popCell.x, typeof window !== "undefined" ? window.innerWidth - 320 : popCell.x);
    const y = Math.min(popCell.y, typeof window !== "undefined" ? window.innerHeight - 340 : popCell.y);
    return (
      <>
        <div className="fixed inset-0 z-40" onClick={() => setPopCell(null)} />
        <div className="fixed z-50 w-80 rounded-xl border border-line bg-surface p-4 shadow-card" style={{ left: Math.max(8, x), top: Math.max(8, y) }}>
          <div className="flex items-start justify-between">
            <div>
              <div className="text-sm font-bold text-ink">Hạn chế ngày {popCell.date}</div>
              <div className="text-xs text-muted">{chName} · {typeName}</div>
            </div>
            <button onClick={() => setPopCell(null)} className="rounded-lg px-2 py-1 text-base font-bold text-muted hover:bg-primary-soft">✕</button>
          </div>
          <div className="mt-3 space-y-3 text-sm text-ink">
            <button
              onClick={() => setRestriction(plan.id, popCell.date, { stopSell: !r.stopSell })}
              className={`w-full rounded-lg px-3 py-2 text-left font-semibold ${r.stopSell ? "bg-success text-white" : "bg-danger text-white"}`}
            >
              {r.stopSell ? "✓ Đang ngừng bán — bấm để mở bán lại" : "Đang bán — bấm để ngừng bán ngày này"}
            </button>
            <label className="flex items-center gap-2">
              Ở tối thiểu
              <input
                type="number" min={1} placeholder="—" defaultValue={r.minStay ?? ""}
                onBlur={(e) => setRestriction(plan.id, popCell.date, { minStay: e.target.value ? Number(e.target.value) : undefined })}
                onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                className={`${inputCls} w-20`}
              />
              đêm
            </label>
            <label className="flex items-center gap-2">
              Ở tối đa
              <input
                type="number" min={1} placeholder="—" defaultValue={r.maxStay ?? ""}
                onBlur={(e) => setRestriction(plan.id, popCell.date, { maxStay: e.target.value ? Number(e.target.value) : undefined })}
                onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                className={`${inputCls} w-20`}
              />
              đêm
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={!!r.cta} onChange={(e) => setRestriction(plan.id, popCell.date, { cta: e.target.checked })} />
              Không nhận khách đến ngày này (CTA)
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={!!r.ctd} onChange={(e) => setRestriction(plan.id, popCell.date, { ctd: e.target.checked })} />
              Không cho trả phòng ngày này (CTD)
            </label>
          </div>
        </div>
      </>
    );
  }

  function Toast() {
    if (!toast) return null;
    return (
      <div className="fixed bottom-5 right-5 z-50 flex max-w-md items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3 text-sm text-ink shadow-card">
        <span className="text-success">✓</span>
        <span className="flex-1">{toast.text}</span>
        {toast.onUndo && (
          <button
            onClick={() => { const u = toast.onUndo; setToast(null); if (u) u(); }}
            className="rounded-lg bg-primary px-3 py-1.5 font-semibold text-white"
          >
            Hoàn tác
          </button>
        )}
        <button onClick={() => setToast(null)} className="font-bold text-muted hover:text-ink">✕</button>
      </div>
    );
  }

  // ---------- popup Cap nhat nhanh ----------
  function QuickUpdateModal() {
    if (!quick) return null;
    const plan = plans.find((p) => p.id === quick.planId);
    if (!plan) return null;
    const { chName, typeName } = priceLogLabel(plan, quick.date);
    const policyName = plan.publicName ?? plan.name;
    // Nut Cap nhat chi bat khi co thay doi that: gia tri moi khac gia
    // tri hien tai cua it nhat 1 ngay trong khoang (doi gia, mo rong
    // khoang sang ngay co gia khac, bat/tat ngung ban, doi so dem...).
    // Mo popup ra chua sua gi thi nut mo, khong bam duoc.
    const quFromEff = quFrom || quick.date;
    const quToEff = quTo || quFrom || quick.date;
    const quDates = quToEff >= quFromEff ? rangeDates(quFromEff, quToEff) : [];
    let hasChange = false;
    if (quDates.length > 0) {
      if (quKind === "price") {
        if (quPrice === "") hasChange = quDates.some((d) => priceForCell(plan, d) !== undefined);
        else hasChange = quDates.some((d) => priceForCell(plan, d) !== Number(quPrice));
      } else if (quKind === "stop_sell") {
        hasChange = quDates.some((d) => !!(restrictions[keyOf(plan.id, d)]?.stopSell) !== quStopSell);
      } else {
        const ms = Math.max(1, Number(quMinStay) || 1);
        hasChange = quDates.some((d) => (restrictions[keyOf(plan.id, d)]?.minStay ?? 1) !== ms);
      }
    }
    const quDisabled = quSaving || quToEff < quFromEff || !hasChange;
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={closeQuickUpdate}>
        <div className="w-full max-w-md rounded-xl bg-surface p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between">
            <h3 className="text-base font-bold text-ink">Cập nhật nhanh</h3>
            <button onClick={closeQuickUpdate} className="rounded-md px-2 py-1 text-lg font-bold text-muted hover:bg-[var(--nui-bg)]">✕</button>
          </div>
          <div className="mt-4 space-y-3 text-sm">
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted">Kênh bán</span>
              <span className="font-semibold text-ink">{chName}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted">Loại phòng</span>
              <span className="font-semibold text-ink">{typeName}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted">Chính sách giá</span>
              <span className="font-semibold text-ink">{policyName}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted">Loại cập nhật</span>
              <select value={quKind} onChange={(e) => setQuKind(e.target.value as "price" | "stop_sell" | "min_stay")} className="cb-input-pill w-48 px-2 py-1.5">
                <option value="price">Giá bán</option>
                <option value="stop_sell">Ngừng bán</option>
                <option value="min_stay">Số đêm tối thiểu</option>
              </select>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted">Khoảng ngày</span>
              <DateRangePicker from={quFrom} to={quTo} onChange={(f, t) => { setQuFrom(f); setQuTo(t); }} />
            </div>
            {quKind === "price" && (
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted">Giá</span>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    inputMode="numeric"
                    autoFocus
                    value={quPrice === "" ? "" : fmt(Number(quPrice))}
                    onChange={(e) => setQuPrice(e.target.value.replace(/[^\d]/g, ""))}
                    placeholder="Nhập giá mới"
                    className="cb-input-pill w-48 px-2 py-1.5 text-right font-semibold"
                  />
                  <span className="text-muted">VND</span>
                </div>
              </div>
            )}
            {quKind === "stop_sell" && (
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted">Ngừng bán</span>
                <label className="flex cursor-pointer items-center gap-2 font-semibold text-ink">
                  <input type="checkbox" checked={quStopSell} onChange={(e) => setQuStopSell(e.target.checked)} className="h-4 w-4 accent-primary" />
                  {quStopSell ? "Đang ngừng bán" : "Đang mở bán"}
                </label>
              </div>
            )}
            {quKind === "min_stay" && (
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted">Số đêm tối thiểu</span>
                <input
                  type="text"
                  inputMode="numeric"
                  value={quMinStay}
                  onChange={(e) => setQuMinStay(e.target.value.replace(/[^\d]/g, ""))}
                  className="cb-input-pill w-24 px-2 py-1.5 text-right font-semibold"
                />
              </div>
            )}
            {quKind === "price" && quFrom && quTo && quFrom !== quTo && (
              <p className="text-right text-xs text-muted">Áp dụng cho {rangeDates(quFrom, quTo).length} ngày</p>
            )}
            {quError && <p className="text-sm font-medium text-danger">{quError}</p>}
          </div>
          <div className="mt-5 flex gap-3">
            <button onClick={closeQuickUpdate} className="cb-btn-ghost flex-1 px-4 py-2 text-sm">Huỷ bỏ</button>
            <button onClick={() => void applyQuickUpdate()} disabled={quDisabled} className="cb-btn-primary flex-1 px-4 py-2 text-sm disabled:opacity-50">{quSaving ? "Đang lưu..." : "Cập nhật"}</button>
          </div>
        </div>
      </div>
    );
  }

  // ---------- luoi gia ----------
  function renderPriceCell(plan: RatePlan | undefined, date: string, channelCode: string, typeId: string) {
    const r = plan ? restrictions[keyOf(plan.id, date)] : undefined;
    const isEditing = !!plan && editing?.planId === plan.id && editing?.date === date;
    const price = plan ? priceForCell(plan, date) : undefined;
    const isOverride = !!plan?.derivedFromId && overrides[keyOf(plan.id, date)] !== undefined;
    const ib = inventoryBlockOn(invBlocks, channelCode, typeId, date);
    const webPlan = channelCode === "website" ? undefined : standardPlanFor("website", typeId);
    const webPrice = webPlan?.prices[date];
    const chType = CHANNELS.find((c) => c.code === channelCode)?.type;
    const cheaperThanWebsite = chType === "ota" && price !== undefined && webPrice !== undefined && price < webPrice;
    const saved = plan ? justSaved.has(keyOf(plan.id, date)) : false;
    const badges: string[] = [];
    if (r?.minStay !== undefined && r.minStay > 1) badges.push(`*${r.minStay}`);
    if (r?.cta) badges.push("CTA");
    if (r?.ctd) badges.push("CTD");
    const hasRestr = !!r && Object.keys(r).length > 0;
    const priceTextCls = cheaperThanWebsite ? "text-danger" : plan?.derivedFromId ? "text-muted" : "text-ink";
    const priceWeightCls = channelCode === "website" ? "font-bold" : "font-semibold";

    if (isEditing && plan) {
      const hasValue = plan.derivedFromId ? isOverride : plan.prices[date] !== undefined;
      return (
        <div key={date} className="border-b border-l border-[var(--nui-bg)] bg-surface px-1 py-1 text-center outline outline-2 -outline-offset-2 outline-primary">
          <input
            autoFocus
            type="text"
            inputMode="numeric"
            value={editValue}
            onChange={(e) => { setEditValue(e.target.value); setEditError(""); }}
            onFocus={(e) => e.target.select()}
            onBlur={() => commitEdit(false)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); commitEdit(false); }
              else if (e.key === "Escape") cancelEdit();
              else if (e.key === "Tab") { e.preventDefault(); commitEdit(true); }
            }}
            className={`w-full rounded-md border px-1 py-1 text-center text-sm font-semibold tabular-nums text-ink outline-none ${editError ? "border-danger" : "border-primary"}`}
          />
          {price !== undefined && <div className="mt-0.5 text-[10px] text-muted">Giá cũ: {fmt(price)}</div>}
          {editError && <div className="mt-0.5 text-[10px] font-medium text-danger">{editError}</div>}
          {hasValue && (
            <button
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { clearPrice(plan.id, date); cancelEdit(); }}
              className="mt-0.5 text-[10px] font-semibold text-primary hover:underline"
              title={plan.derivedFromId ? "Xoá giá sửa tay, về lại giá tự tính" : "Xoá giá ngày này"}
            >
              {plan.derivedFromId ? "↩ về tự tính" : "Xoá giá"}
            </button>
          )}
        </div>
      );
    }

    return (
      <div
        key={date}
        onClick={() => void openQuickUpdate(channelCode, typeId, date)}
        className={`cursor-pointer border-b border-l border-[var(--nui-bg)] px-2 py-2 text-center hover:bg-primary-soft/70 ${r?.stopSell || ib ? "bg-danger-soft" : saved ? "bg-success-soft" : date === todayStr ? "bg-primary-soft/50" : ""}`}
        title={isOverride ? "Giá sửa tay — bấm vào ô rồi xoá trắng để về lại giá tự tính." : undefined}
      >
        {ib ? (
          <div className="text-xs font-semibold text-muted">
            ĐÓNG BÁN
            <div className="text-[10px] font-medium">{ib.scope === "channel" ? "(đóng theo kênh)" : "(đóng cả loại phòng)"}</div>
          </div>
        ) : r?.stopSell ? (
          <div className="text-xs font-semibold text-danger">ĐÓNG BÁN</div>
        ) : (
          <>
            <div className={`text-sm tabular-nums ${priceWeightCls} ${priceTextCls}`}>
              {price !== undefined ? fmt(price) : <span className="font-normal text-subtle">—</span>}
              {isOverride && <span className="text-warning"> ●</span>}
            </div>
            {hasRestr && badges.length > 0 && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                  if (plan) setPopCell({ planId: plan.id, date, x: rect.left, y: rect.bottom + 6 });
                }}
                className="mt-0.5 rounded bg-warning-soft px-1 text-[10px] font-bold text-warning"
                title="Có hạn chế ngày này — bấm để xem và sửa"
              >
                {badges.join(" · ")}
              </button>
            )}
          </>
        )}
      </div>
    );
  }

  function renderPriceRows(channelCode: string, typeId: string) {
    const plan = standardPlanFor(channelCode, typeId);
    const ch = CHANNELS.find((c) => c.code === channelCode);
    const formulaPct = plan?.derivedFromId
      ? getFormula(plan.formulaId)?.value
      : getFormula(CHANNEL_FORMULA[channelCode])?.value;
    const isBase = channelCode === "website";
    return (
      <div className="contents" key={`${channelCode}|${typeId}`}>
        <div className={`sticky left-0 z-10 border-b shadow-[2px_0_4px_rgba(23,41,62,0.05)] border-[var(--nui-bg)] px-3 py-2 ${isBase ? "bg-primary-soft" : "bg-surface-muted"}`}>
          <div className={`flex items-center gap-1.5 text-sm ${isBase ? "font-bold text-ink" : "font-medium text-muted"}`}>
            {isBase ? "★ " : <span className="pl-4" />}
            {ch?.name ?? channelCode}
            {!isBase && formulaPct !== undefined && <span className="rounded bg-primary-soft px-1.5 py-0.5 text-[11px] font-bold text-primary">+{formulaPct}%</span>}
            {!isBase && formulaPct === undefined && <span className="rounded bg-primary-soft px-1.5 py-0.5 text-[11px] font-bold text-primary">±0%</span>}
            {dirtyChannels.has(channelCode) && <span className="text-warning" title="Có thay đổi chưa đẩy lên Channex">●</span>}
          </div>
        </div>
        {days.map((date) => renderPriceCell(plan, date, channelCode, typeId))}
      </div>
    );
  }

  function renderAvailabilitySlimRow(typeId: string) {
    const left = roomsLeftByType[typeId] ?? [];
    return (
      <div className="contents" key={`avl-${typeId}`}>
        <div className="sticky left-0 z-10 border-b shadow-[2px_0_4px_rgba(23,41,62,0.05)] border-[var(--nui-bg)] bg-surface px-3 py-1.5 pl-9 text-xs text-muted">Còn trống</div>
        {days.map((date, i) => {
          const n = left[i] ?? 0;
          return (
            <div key={date} className={`border-b border-l border-[var(--nui-bg)] px-2 py-1.5 text-center text-xs font-semibold tabular-nums ${n <= 0 ? "bg-warning-soft text-danger" : "text-muted"}`}>
              {n}
            </div>
          );
        })}
      </div>
    );
  }

  function renderRestrictionRows(channelCode: string, typeId: string) {
    const plan = standardPlanFor(channelCode, typeId);
    const ch = CHANNELS.find((c) => c.code === channelCode);
    const rowLabel = (label: string) => (
      <div className="sticky left-0 z-10 border-b shadow-[2px_0_4px_rgba(23,41,62,0.05)] border-[var(--nui-bg)] bg-surface px-3 py-1.5 pl-9 text-xs text-muted">{label}</div>
    );
    return (
      <div className="contents" key={`r-${channelCode}|${typeId}`}>
        <div className="sticky left-0 z-10 border-b shadow-[2px_0_4px_rgba(23,41,62,0.05)] border-[var(--nui-bg)] bg-surface-muted px-3 py-1.5 text-xs font-bold text-ink">
          <span className="pl-4" />{ch?.name ?? channelCode}
        </div>
        {days.map((d) => (
          <div key={d} className="border-b border-l border-[var(--nui-bg)] bg-surface-muted" />
        ))}
        {rowLabel("Ngừng bán")}
        {days.map((date) => {
          const stopped = !!plan && !!restrictions[keyOf(plan.id, date)]?.stopSell;
          const ib = inventoryBlockOn(invBlocks, channelCode, typeId, date);
          if (ib) {
            return (
              <div key={date} className="border-b border-l border-[var(--nui-bg)] bg-primary-soft px-2 py-1.5 text-center text-xs font-medium text-muted" title="Đang bị đóng bán ở cấp kênh/loại phòng — sửa ở nút Đóng bán trên thanh công cụ">
                bị khoá ↑
              </div>
            );
          }
          return (
            <button
              key={date}
              onClick={() => void toggleStopSell(channelCode, typeId, date)}
              className={`border-b border-l border-[var(--nui-bg)] px-2 py-1.5 text-center text-xs font-semibold ${stopped ? "bg-danger-soft text-danger" : "text-success"}`}
              title={stopped ? "Đang ngừng bán — bấm để mở bán" : "Đang bán — bấm để ngừng bán ngày này"}
            >
              {stopped ? "✕ ngừng" : "✓ bán"}
            </button>
          );
        })}
        {rowLabel("Ở tối thiểu (đêm)")}
        {days.map((date) => {
          const v = plan ? restrictions[keyOf(plan.id, date)]?.minStay : undefined;
          return (
            <div key={date} className="border-b border-l border-[var(--nui-bg)] px-1 py-1 text-center">
              <input
                key={String(v ?? "")}
                type="number" min={1} placeholder="—" defaultValue={v ?? ""}
                onBlur={(e) => { if (plan) setRestriction(plan.id, date, { minStay: e.target.value ? Number(e.target.value) : undefined }); }}
                onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                className="w-14 rounded-md border border-line px-1 py-1 text-center text-xs text-ink outline-none focus:border-primary"
              />
            </div>
          );
        })}
        {rowLabel("Không nhận đến (CTA)")}
        {days.map((date) => {
          const on = !!plan && !!restrictions[keyOf(plan.id, date)]?.cta;
          return (
            <button
              key={date}
              onClick={() => { if (plan) setRestriction(plan.id, date, { cta: !on }); }}
              className={`border-b border-l border-[var(--nui-bg)] px-2 py-1.5 text-center text-xs font-semibold ${on ? "bg-danger-soft text-danger" : "text-success"}`}
              title={on ? "Đang chặn khách đến ngày này — bấm để cho phép" : "Đang nhận khách đến — bấm để chặn ngày này"}
            >
              {on ? "✕ chặn" : "✓ nhận"}
            </button>
          );
        })}
        {rowLabel("Không cho trả (CTD)")}
        {days.map((date) => {
          const on = !!plan && !!restrictions[keyOf(plan.id, date)]?.ctd;
          return (
            <button
              key={date}
              onClick={() => { if (plan) setRestriction(plan.id, date, { ctd: !on }); }}
              className={`border-b border-l border-[var(--nui-bg)] px-2 py-1.5 text-center text-xs font-semibold ${on ? "bg-danger-soft text-danger" : "text-success"}`}
              title={on ? "Đang chặn trả phòng ngày này — bấm để cho phép" : "Đang cho trả phòng — bấm để chặn ngày này"}
            >
              {on ? "✕ chặn" : "✓ cho trả"}
            </button>
          );
        })}
      </div>
    );
  }

  // ---------- render ----------
  return (
    <div>
      {dbError && <p className="mb-3 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">Lỗi cơ sở dữ liệu: {dbError}</p>}
      {(openFilter || showLegend || showLog) && (
        <div
          className="fixed inset-0 z-20"
          onClick={() => { setOpenFilter(null); setShowLegend(false); setShowLog(false); }}
        />
      )}
      {Toolbar()}
      {view === "prices" && (
        <>
          <div className="mt-4 overflow-x-auto rounded-xl border border-line bg-surface shadow-card">
            <div className="grid min-w-[1500px]" style={gridCols}>
              {DateHeader()}
              {visibleTypes.map((t) => {
                return (
                  <div key={t.id} className="contents">
                    {TypeHeader({ t })}
                    {days.map((d) => (
                      <div key={d} className="border-b border-l border-[var(--nui-bg)] bg-primary-soft" />
                    ))}
                    {!collapsedTypes.has(t.id) && (
                      <>
                        {renderAvailabilitySlimRow(t.id)}
                        {visibleChannelList.map((c) => renderPriceRows(c.code, t.id))}
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
          <p className="mt-2 text-xs text-muted">
            Bấm ô giá để sửa (Enter lưu, Tab sang ngày sau, Esc huỷ). Chấm vàng = giá sửa tay — xoá trắng để về lại giá tự tính.
          </p>
        </>
      )}

      {view === "availability" && (
        <>
          <div className="mt-4 flex flex-wrap items-end gap-3 text-sm text-ink">
            <label>
              Kênh kiểm tra
              <select value={invChannel} onChange={(e) => setInvChannel(e.target.value)} className={`${inputCls} ml-2`}>
                <option value="all">Tất cả kênh (xem tồn chung)</option>
                {CHANNELS.map((c) => (
                  <option key={c.code} value={c.code}>{c.name}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="mt-4 overflow-x-auto rounded-xl border border-line bg-surface shadow-card">
            <div className="grid min-w-[1500px]" style={gridCols}>
              {DateHeader()}
              {visibleTypes.map((t) => {
                const left = roomsLeftByType[t.id] ?? [];
                return (
                  <div key={t.id} className="contents">
                    {TypeHeader({ t })}
                    {days.map((d) => (
                      <div key={d} className="border-b border-l border-[var(--nui-bg)] bg-primary-soft" />
                    ))}
                    {!collapsedTypes.has(t.id) && (
                      <>
                        <div className="sticky left-0 z-10 border-b shadow-[2px_0_4px_rgba(23,41,62,0.05)] border-[var(--nui-bg)] bg-surface px-3 py-2">
                          <div className="text-sm font-bold text-ink">
                            {t.name} {t.code ? <span className="ml-1.5 rounded-md bg-surface px-1.5 py-0.5 align-middle text-[11px] font-semibold text-muted">{t.code}</span> : null}
                          </div>
                          <div className="text-xs text-muted">Phòng trống</div>
                        </div>
                        {days.map((date, i) => {
                          const n = left[i] ?? 0;
                          if (invChannel !== "all") {
                            const typePlans = plans.filter((p) => p.channelCode === invChannel && p.roomTypeId === t.id);
                            if (typePlans.length === 0) {
                              return (
                                <div key={date} className="border-b border-l border-[var(--nui-bg)] bg-primary-soft px-2 py-2 text-center text-xs text-muted" title="Kênh này chưa có gói cho loại phòng này">
                                  —
                                </div>
                              );
                            }
                            if (inventoryBlockOn(invBlocks, invChannel, t.id, date)) {
                              return (
                                <div key={date} className="border-b border-l border-[var(--nui-bg)] bg-primary-soft px-2 py-2 text-center text-xs font-semibold text-muted" title="Đang bị đóng bán cấp kênh hoặc cấp loại phòng">
                                  Đóng
                                </div>
                              );
                            }
                            if (typePlans.every((p) => restrictions[keyOf(p.id, date)]?.stopSell)) {
                              return (
                                <div key={date} className="border-b border-l border-[var(--nui-bg)] bg-primary-soft px-2 py-2 text-center text-xs font-semibold text-muted" title="Mọi gói của kênh này đều đang ngừng bán ngày này">
                                  Đóng
                                </div>
                              );
                            }
                          }
                          return (
                            <div key={date} className={`border-b border-l border-[var(--nui-bg)] px-2 py-2 text-center text-sm font-bold tabular-nums ${n <= 0 ? "bg-warning-soft text-danger" : n === 1 ? "text-danger" : "text-ink"}`}>
                              {n}
                            </div>
                          );
                        })}
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
          <p className="mt-2 text-xs text-muted">
            Ô vàng = hết phòng. Chọn 1 kênh để xem kênh đó có bán được ngày đó không (ô “Đóng” = bị đóng bán, ô “—” = kênh chưa có gói). Chặn phòng hay đóng bán thì sang trang “Chặn phòng &amp; Đóng bán”:
          </p>
          <div className="mt-3">
            <a href={`/${HOTEL_ID}/inventory`} className="cb-btn-ghost px-3 py-2 text-sm">
              Quản lý chặn phòng &amp; đóng bán →
            </a>
          </div>
        </>
      )}

      {view === "restrictions" && (
        <>
          <div className="mt-4 overflow-x-auto rounded-xl border border-line bg-surface shadow-card">
            <div className="grid min-w-[1500px]" style={gridCols}>
              {DateHeader()}
              {visibleTypes.map((t) => (
                <div key={t.id} className="contents">
                  {TypeHeader({ t })}
                  {days.map((d) => (
                    <div key={d} className="border-b border-l border-[var(--nui-bg)] bg-primary-soft" />
                  ))}
                  {!collapsedTypes.has(t.id) &&
                    visibleChannelList.map((c) => renderRestrictionRows(c.code, t.id))}
                </div>
              ))}
            </div>
          </div>
          <p className="mt-2 text-xs text-muted">
            Bấm vào ô để bật/tắt hạn chế từng ngày; ô Ở tối thiểu gõ số rồi bấm Enter.
          </p>
        </>
      )}

      {InvModal()}
      {RestrictionPopover()}
      {QuickUpdateModal()}
      {Toast()}
    </div>
  );
}
