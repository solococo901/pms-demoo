"use client";
// RATES19 — components/RatesCalendar.tsx (Lich gia kieu ezCloud)
// Bo nut tab 'Lich phong' khoi thanh tab (chi con 2 tab xem gia); Lich phong van vao duoc tu menu + nut tren thanh tren.
// 2 tab: Ban phong theo kenh | Ban phong theo loai phong (mac dinh).
// Moi loai phong chi 2 dong (Phong trong + Gia ban); ten loai phong om 2 dong (rowspan).
// Gia goc = gia Website; gia kenh suy ra theo %, sua tay duoc tung o (override, ▲ den).

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useToast } from "@/components/Toast";
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
  applyFormula,
  getFormula,
  getHotelData,
  inventoryBlockOn,
  resolvePlanPrice,
  roomBlockOn,
  type BaseRatePeriod,
  type InventoryBlock,
  type RatePlan,
  type RoomType,
} from "@/lib/mock-data";
import { supabase } from "@/lib/supabase";
import { writeAuditLog } from "@/lib/audit-log";
import { currentHotelId } from "@/lib/current-hotel";
import { useParams } from "next/navigation";
import { queueChannexDates, rangeDates } from "@/lib/channex-outbox";
import { DatePicker, DateRangePicker } from "@/components/DatePicker";
import { IconEdit, IconZap } from "@/components/icons";

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
type MainTab = "byType" | "byChannel";

const inputCls = "rounded-lg border border-line px-2 py-2 text-ink outline-none focus:border-primary";
const WEEKEND_DAYS: number[] = getHotelData("cityhouse-mark").config?.weekendDays ?? [0, 6];

export default function RatesCalendar() {
  // Khach san lay tu URL; neu khong thi dung khach san da luu theo tab.
  const params = useParams();
  const HOTEL_ID = typeof params.hotelId === "string" ? params.hotelId : currentHotelId();

  const [mainTab, setMainTab] = useState<MainTab>("byType");
  const [typeFilter, setTypeFilter] = useState<string | null>(null); // null = tat ca loai phong
  const [policyFilter, setPolicyFilter] = useState<string>("all");
  const [selectedChannel, setSelectedChannel] = useState<string>("agoda");
  const [showAvailRow, setShowAvailRow] = useState(true);
  const [showHint, setShowHint] = useState(true);
  // Kênh đang xem của từng loại phòng ở tab "Bán phòng theo kênh" (mỗi dòng 1 dropdown riêng).
  const [channelByType, setChannelByType] = useState<Record<string, string>>({});
  const [collapsedTypes, setCollapsedTypes] = useState<Set<string>>(new Set());
  const [startDate, setStartDate] = useState<string>(TODAY);
  const [todayStr, setTodayStr] = useState<string>(TODAY);

  const [plans, setPlans] = useState<RatePlan[]>(RATE_PLANS.map((p) => ({ ...p, prices: { ...p.prices } })));
  const [roomTypesDb, setRoomTypesDb] = useState<RoomType[]>(ROOM_TYPES);
  const [restrictions, setRestrictions] = useState<Record<CellKey, Restriction>>({});
  const [overrides, setOverrides] = useState<Record<CellKey, number>>({}); // gia sua tay cua goi suy ra
  const [basePeriods, setBasePeriods] = useState<BaseRatePeriod[]>([]); // giai doan gia goc (Base Rate)
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
  // Popup doi % cong them cua kenh (RATES12): kenh nao dang doi, % hien tai, gia tri dang go, trang thai luu/loi.
  const [markup, setMarkup] = useState<{ channelCode: string; currentPct: number } | null>(null);
  const [markupDraft, setMarkupDraft] = useState("");
  const [markupSaving, setMarkupSaving] = useState(false);
  const [markupError, setMarkupError] = useState("");
  // Man hinh tao gia cho kenh (RATES14, theo layout moi): kenh + loai phong chua co goi gia thi mo panel 1 buoc
  // (kenh, loai phong, suy ra tu gia goc, % cong them, xem truoc bang tien that) thay vi tu dong tao khi bam o.
  const [creator, setCreator] = useState<{ channelCode: string; roomTypeId: string; date: string } | null>(null);
  const [creatorPct, setCreatorPct] = useState("");
  const [creatorSaving, setCreatorSaving] = useState(false);
  const [creatorError, setCreatorError] = useState("");


  // Phan hoi sau khi luu: thong bao dung chung (co nut Hoan tac) + o vua sua sang xanh + nhat ky thay doi.
  const { showToast } = useToast();
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
      const [typesRes, plansRes, pricesRes, roomsRes, resRes, rrRes, blocksRes, invRes, baseRes] = await Promise.all([
        supabase.from("room_types").select("*").eq("hotel_id", HOTEL_ID),
        supabase.from("rate_plans").select("*").eq("hotel_id", HOTEL_ID),
        supabase.from("rate_prices").select("*"),
        supabase.from("rooms").select("*").eq("hotel_id", HOTEL_ID),
        supabase.from("reservations").select("*").eq("hotel_id", HOTEL_ID),
        supabase.from("reservation_rooms").select("reservation_id, room_number"),
        supabase.from("room_blocks").select("*").eq("hotel_id", HOTEL_ID),
        supabase.from("inventory_blocks").select("*").eq("hotel_id", HOTEL_ID),
        supabase.from("base_rate_periods").select("*").eq("hotel_id", HOTEL_ID),
      ]);
      const loadErr = plansRes.error ?? pricesRes.error ?? roomsRes.error ?? resRes.error ?? rrRes.error ?? blocksRes.error ?? invRes.error ?? baseRes.error;
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
      // Gia goc theo giai doan (Base Rate): nap vao plan.prices cua goi Website
      // truoc, roi cac dong rate_prices (gia sua tay / override) ghi de len tren.
      // Nhu vay moi cho doc plan.prices[date] deu thay gia hieu luc (ghi de thang gia goc).
      const baseList: BaseRatePeriod[] = (baseRes.data ?? []).map((r) => ({
        id: r.id, roomTypeId: r.room_type_id, from: r.from_date, to: r.to_date, price: Number(r.price),
      }));
      setBasePeriods(baseList);
      for (const bp of baseList) {
        const plan = dbPlans.find((x) => !x.derivedFromId && x.roomTypeId === bp.roomTypeId);
        if (!plan) continue;
        for (const d of rangeDates(bp.from, bp.to)) plan.prices[d] = bp.price;
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

  // Gia goc theo giai doan cho 1 loai phong vao 1 ngay (khong co giai doan thi undefined).
  const baseRatePrice = (roomTypeId: string, date: string): number | undefined => {
    const bp = basePeriods.find((x) => x.roomTypeId === roomTypeId && x.from <= date && date <= x.to);
    return bp ? bp.price : undefined;
  };

  // Gia hien thi cua 1 o: goi goc lay gia da luu (ghi de thang gia goc, khong co thi gia goc theo giai doan);
  // goi suy ra tinh tu gia goc (+ cong thuc), gia sua tay thang.
  function priceForCell(plan: RatePlan, date: string): number | undefined {
    if (!plan.derivedFromId) return plan.prices[date];
    return resolvePlanPrice(plan, date, plans, overrides, basePeriods);
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
      // Xoa gia sua tay: o ve lai gia goc theo giai doan (neu co), khong de trong.
      const bp = baseRatePrice(plan.roomTypeId, date);
      setPlans((prev) => prev.map((p) => {
        if (p.id !== planId) return p;
        const next = { ...p.prices };
        if (bp !== undefined) next[date] = bp;
        else delete next[date];
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
    showToast("Đã đẩy thay đổi lên Channex — đang đồng bộ.");
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
    if (error) { setDbError("Lưu đóng bán không thành công: " + error.message); return; }
    setInvBlocks((prev) => [...prev, nb]);
    queueChannexDates(rangeDates(nb.from, nb.to));
    if (nb.scope === "channel" && nb.channelCode) markDirty(nb.channelCode);
    else CHANNELS.filter((c) => c.type === "ota").forEach((c) => markDirty(c.code));
    setIbReason("");
  }

  async function removeInvBlock(id: string) {
    const blk = invBlocks.find((b) => b.id === id);
    const { error } = await supabase.from("inventory_blocks").delete().eq("id", id);
    if (error) { setDbError("Xoá đóng bán không thành công: " + error.message); return; }
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
  async function ensureStandardPlan(channelCode: string, roomTypeId: string, formulaIdOverride?: string | null): Promise<RatePlan | undefined> {
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
        // Gói moi phai dung % kenh DANG DUNG (tu goi da co), khong phai % mac dinh — neu khong, goi moi se lech % so voi cac goi cu cua cung kenh.
        if (formulaIdOverride !== undefined) {
          formulaId = formulaIdOverride ?? undefined;
        } else {
          const existingCh = plans.find((x) => x.channelCode === channelCode && !!x.derivedFromId);
          formulaId = existingCh?.formulaId ?? CHANNEL_FORMULA[channelCode];
        }
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
          "success",
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
            "success",
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

  // Xoá giá riêng trong khoảng ngày đã chọn — về lại giá tự tính (RATES14, theo layout mới).
  // Giong thao tac "xoá trắng ô giá" nhung la nut rieng 1 bam, khong can nhap lai gia.
  async function resetOverrideToDerived() {
    if (!quick || quSaving) return;
    const plan = plans.find((p) => p.id === quick.planId);
    if (!plan) return;
    const from = quFrom || quick.date;
    const to = quTo || quFrom || quick.date;
    if (to < from) return;
    const dates = rangeDates(from, to);
    const { chName, typeName } = priceLogLabel(plan, from);
    const dShort = (d: string) => d.split("-").reverse().join("/");
    const rangeLabel = from === to ? dShort(from) : `${dShort(from)} → ${dShort(to)}`;
    const backLabel = plan.derivedFromId ? "về giá tự tính" : "về giá gốc";
    setQuSaving(true);
    if (plan.derivedFromId) {
      setOverrides((prev) => {
        const next = { ...prev };
        dates.forEach((d) => { delete next[keyOf(plan.id, d)]; });
        return next;
      });
    } else {
      // Goi goc: xoa gia sua tay, o ve lai gia goc theo giai doan (neu co).
      setPlans((prev) => prev.map((p) => {
        if (p.id !== plan.id) return p;
        const next = { ...p.prices };
        dates.forEach((d) => {
          const bp = baseRatePrice(p.roomTypeId, d);
          if (bp !== undefined) next[d] = bp;
          else delete next[d];
        });
        return { ...p, prices: next };
      }));
    }
    const { error } = await supabase.from("rate_prices").delete().eq("rate_plan_id", plan.id).gte("date", from).lte("date", to);
    setQuSaving(false);
    if (error) { setDbError("Xoá giá riêng không thành công: " + error.message); return; }
    markDirty(plan.channelCode);
    queueChannexDates(dates);
    flashSaved(dates.map((d) => keyOf(plan.id, d)));
    writeAuditLog({
      hotelId: HOTEL_ID, accountId: ACCOUNT_ID, action: "price_updated", entityType: "rate_price", entityId: plan.id,
      summary: `Xoá giá riêng ${typeName} · ${chName} · ${rangeLabel} (${dates.length} ngày) — ${backLabel}`,
      details: { planId: plan.id, from, to, days: dates.length, newPrice: null, channelCode: plan.channelCode, roomTypeId: plan.roomTypeId },
    });
    logChange(`Xoá giá riêng ${typeName} · ${chName} · ${rangeLabel} — ${backLabel}`);
    showToast(`Đã xoá giá riêng ${typeName} · ${chName} · ${rangeLabel} — ${backLabel}.`);
    closeQuickUpdate();
  }

  function openMarkup(channelCode: string, currentPct: number) {
    setMarkup({ channelCode, currentPct });
    setMarkupDraft(String(currentPct));
    setMarkupError("");
  }

  function closeMarkup() {
    setMarkup(null);
    setMarkupError("");
  }

  // % hien tai cua 1 kenh (tu goi da co, khong thi % mac dinh) — de goi moi tao ra dung % kenh dang dung.
  function channelCurrentPct(channelCode: string): number {
    const p = plans.find((x) => x.channelCode === channelCode && !!x.derivedFromId);
    const v = p ? getFormula(p.formulaId)?.value : getFormula(CHANNEL_FORMULA[channelCode])?.value;
    return v ?? 0;
  }

  function openCreator(channelCode: string, roomTypeId: string, date: string) {
    setCreator({ channelCode, roomTypeId, date });
    setCreatorPct(String(channelCurrentPct(channelCode)));
    setCreatorError("");
  }

  function closeCreator() {
    setCreator(null);
    setCreatorError("");
  }

  // Tao gia cho kenh: neu % doi so voi % kenh hien tai thi doi % ca kenh truoc, roi tao goi voi % do.
  async function applyCreateRate() {
    if (!creator || creatorSaving) return;
    const pct = Number(creatorPct);
    if (Number.isNaN(pct)) { setCreatorError("Nhập % cộng thêm là số."); return; }
    const chName = CHANNELS.find((c) => c.code === creator.channelCode)?.name ?? creator.channelCode;
    const typeName = roomTypesDb.find((t) => t.id === creator.roomTypeId)?.name ?? creator.roomTypeId;
    setCreatorSaving(true);
    setCreatorError("");
    if (pct !== channelCurrentPct(creator.channelCode)) {
      const ok = await setChannelMarkup(creator.channelCode, pct);
      if (!ok && plans.some((x) => x.channelCode === creator.channelCode && !!x.derivedFromId)) {
        setCreatorSaving(false);
        setCreatorError("Không đổi được % — thử lại sau.");
        return;
      }
    }
    const formulaId = pct > 0 ? `f-plus${pct}` : pct < 0 ? `f-minus${-pct}` : null;
    const plan = await ensureStandardPlan(creator.channelCode, creator.roomTypeId, formulaId);
    setCreatorSaving(false);
    if (!plan) { setCreatorError("Không tạo được giá cho kênh — thử lại sau."); return; }
    const base = standardPlanFor("website", creator.roomTypeId)?.prices[creator.date];
    const preview = base !== undefined ? fmt(applyFormula(base, { id: "pv", name: "", kind: "percent", value: pct })) : "—";
    showToast(`Đã tạo giá ${chName} cho ${typeName} — giá tự tính ${preview}.`);
    closeCreator();
  }

  async function applyMarkup() {
    if (!markup || markupSaving) return;
    const v = Number(markupDraft);
    if (Number.isNaN(v) || v === markup.currentPct) return;
    setMarkupSaving(true);
    const ok = await setChannelMarkup(markup.channelCode, v);
    setMarkupSaving(false);
    if (ok) closeMarkup();
    else setMarkupError("Không đổi được % — thử lại sau.");
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
          // Xoa gia sua tay trong khoang: cac o ve lai gia goc theo giai doan (neu co).
          setPlans((prev) => prev.map((p) => {
            if (p.id !== plan.id) return p;
            const next = { ...p.prices };
            dates.forEach((d) => {
              const bp = baseRatePrice(p.roomTypeId, d);
              if (bp !== undefined) next[d] = bp;
              else delete next[d];
            });
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
        showToast(`Đã xoá giá ${typeName} · ${chName} · ${rangeLabel}.`, "success", restoreSnap);
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
      showToast(`Đã đổi giá ${typeName} · ${chName} · ${rangeLabel}: ${oldDesc} → ${fmt(price)}.`, "success", restoreSnap);
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


  // ---------- shared grid pieces (RATES15: luoi gon — o gia ~46px, cot ngay 76px, chu gia 13px) ----------
  const gridColsType = { gridTemplateColumns: `140px 120px repeat(${days.length}, minmax(72px, 1fr))` } as const;
  const gridColsChannel = { gridTemplateColumns: `200px repeat(${days.length}, minmax(76px, 1fr))` } as const;
  // Luoi ton phong o tab "Ban phong theo kenh": ten loai phong + dropdown chon kenh + cac cot ngay.
  const gridColsInv = { gridTemplateColumns: `180px 150px repeat(${days.length}, minmax(72px, 1fr))` } as const;
  // Kênh của 1 dòng ở tab "Bán phòng theo kênh": đã chọn riêng thì dùng nó, chưa thì theo dropdown Kênh bán.
  const rowChannel = (typeId: string) => channelByType[typeId] ?? (selectedChannel === "all" ? "website" : selectedChannel);
  // Bấm 1 ô tồn phòng: mở cửa sổ Đóng bán, điền sẵn kênh + loại phòng + ngày đó.
  function openInvForCell(channelCode: string, typeId: string, date: string) {
    setIbScope("channel");
    setIbChannel(channelCode);
    setIbType(typeId);
    setIbFrom(date);
    setIbTo(date);
    setIbReason("");
    setInvOpen(true);
  }
  const [openFilter, setOpenFilter] = useState<"type" | "policy" | "channel" | "display" | null>(null);
  const policyOptions = [...new Set(plans.map((p) => p.cancellationPolicy))];
  const policyLabel = (p: string) => (p === "non_refundable" ? "Không hoàn tiền" : "Linh hoạt");
  // Loai phong hien theo bo loc: loai + chinh sach gia (goi chuan cua kenh dang chon).
  // Khi chon "Tat ca" kenh: an loai phong neu da co goi ma khong goi nao khop chinh sach;
  // loai phong chua co goi van hien de bam "— Dat gia —" duoc.
  const visibleTypes = roomTypesDb.filter((t) => {
    if (typeFilter && t.id !== typeFilter) return false;
    if (policyFilter !== "all") {
      if (selectedChannel === "all") {
        const ps = CHANNELS.map((c) => standardPlanFor(c.code, t.id)).filter((p): p is RatePlan => !!p);
        if (ps.length > 0 && !ps.some((p) => p.cancellationPolicy === policyFilter)) return false;
      } else {
        const p = standardPlanFor(selectedChannel, t.id);
        if (p && p.cancellationPolicy !== policyFilter) return false;
      }
    }
    return true;
  });

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

  // Dau cot ngay: Thu / so ngay / Thang; cuoi tuan (T7, CN) to do/hong.
  // labelSpan = so cot nhan gop lai o dau dong (2 o tab theo loai phong, 1 o cac bang khac).
  function DateHeader({ label, labelSpan }: { label?: string; labelSpan?: number }) {
    const span = labelSpan ?? 1;
    return (
      <div className="contents">
        <div
          className="sticky left-0 top-0 z-20 border-b border-[var(--nui-bg)] bg-primary-soft px-3 py-2 text-xs font-semibold text-muted"
          style={{ gridColumn: `span ${span}` }}
        >
          {label ?? "Ngày →"}
        </div>
        {days.map((d) => {
          const p = dayParts(d);
          const weekend = WEEKEND_DAYS.includes(p.dow);
          const dd = new Date(d + "T00:00:00");
          return (
            <div key={d} className={`sticky top-0 z-10 border-b border-l border-[var(--nui-bg)] px-1 py-2 text-center text-[10px] font-semibold leading-tight ${d === todayStr ? "bg-primary text-white" : weekend ? "bg-danger-soft text-danger" : "bg-primary-soft text-muted"}`}>
              <div>{p.wd}</div>
              <div className="text-[12px] font-bold">{dd.getDate()}</div>
              <div className="text-[9px] font-medium">Tháng {dd.getMonth() + 1}</div>
              {d === todayStr && <div className="text-[9px] font-bold text-white/80">HÔM NAY</div>}
            </div>
          );
        })}
      </div>
    );
  }

  function TypeHeader({ t }: { t: RoomType }) {
    const collapsed = collapsedTypes.has(t.id);
    return (
      <div className="sticky left-0 z-10 border-b shadow-[2px_0_4px_rgba(23,41,62,0.05)] border-[var(--nui-bg)] bg-primary-soft px-3 py-2 text-[13px] font-bold text-ink">
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
      </div>
    );
  }

  // ---------- toolbar + modals ----------
  function Toolbar() {
    const dirtyCount = dirtyChannels.size;
    const selCh = CHANNELS.find((c) => c.code === selectedChannel);
    const selPct = selectedChannel === "website" || selectedChannel === "all" ? undefined : channelCurrentPct(selectedChannel);
    return (
      <div className="sticky top-0 z-30 -mx-1 rounded-xl border border-line bg-surface px-3 py-2 shadow-card">
        {/* 2 tab chinh: theo kenh | theo loai phong (mac dinh) */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex overflow-hidden rounded-full border border-line">
            {(
              [
                ["byChannel", "Bán phòng theo kênh"],
                ["byType", "Bán phòng theo loại phòng"],
              ] as const
            ).map(([tab, label]) => (
              <button
                key={tab}
                onClick={() => setMainTab(tab)}
                className={`px-3 py-2 text-sm font-medium ${mainTab === tab ? "bg-primary text-white" : "bg-surface text-ink hover:bg-primary-soft"}`}
              >
                {label}
              </button>
            ))}
          </div>
          <span className="flex items-center gap-1">
            <button onClick={() => setStartDate(addDays(startDate, -WINDOW))} className="cb-btn-ghost px-2.5 py-2" title="Lùi 14 ngày">‹</button>
            <button onClick={() => setStartDate(todayStr)} className="cb-btn-ghost px-2.5 py-2 text-sm font-semibold" title="Về hôm nay">Hôm nay</button>
            <button onClick={() => setStartDate(addDays(startDate, WINDOW))} className="cb-btn-ghost px-2.5 py-2" title="Tiến 14 ngày">›</button>
          </span>
          <span className="text-sm font-semibold text-ink">
            {dayParts(days[0]).label} → {dayParts(days[days.length - 1]).label}
          </span>
          <DatePicker value={startDate} onChange={(v) => v && setStartDate(v)} />
          <span className="ml-auto flex items-center gap-2">
            {dirtyCount > 0 ? (
              <>
                <span className="text-sm text-warning">● {dirtyCount} kênh có thay đổi chưa đẩy lên Channex</span>
                <button onClick={pushAllToChannex} className="cb-btn-primary px-3 py-2 text-sm">Đẩy lên Channex ngay</button>
              </>
            ) : (
              <span className="text-sm text-success">● Đã đồng bộ Channex</span>
            )}
            <Link href={`/${HOTEL_ID}/rates/bulk?tab=restrictions&mode=stop_sell&channel=${selectedChannel === "all" ? "website" : selectedChannel}&from=${startDate}&to=${addDays(startDate, WINDOW - 1)}`} className="cb-btn-ghost px-3 py-2 text-sm">
              Đóng bán
            </Link>
            <Link href={`/${HOTEL_ID}/rates/bulk?channel=${selectedChannel === "all" ? "website" : selectedChannel}&from=${startDate}&to=${addDays(startDate, WINDOW - 1)}`} className="cb-btn-primary inline-flex items-center gap-1.5 px-3 py-2 text-sm">
              <IconZap className="h-4 w-4" /> Cập nhật hàng loạt
            </Link>
          </span>
        </div>
        {/* Hang loc: loai phong | chinh sach gia | kenh ban | hien thi them */}
        <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-[var(--nui-bg)] pt-2">
          <div className="relative">
            <button onClick={() => setOpenFilter(openFilter === "type" ? null : "type")} className="cb-btn-ghost px-3 py-2 text-sm">
              Loại phòng: {typeFilter ? roomTypesDb.find((t) => t.id === typeFilter)?.name ?? typeFilter : "Tất cả"} ▾
            </button>
            {openFilter === "type" && (
              <div className="absolute left-0 top-full z-40 mt-1 w-56 rounded-xl border border-line bg-surface p-2 shadow-card">
                <button
                  onClick={() => { setTypeFilter(null); setOpenFilter(null); }}
                  className="mb-1 w-full rounded-lg px-2 py-1.5 text-left text-sm font-semibold text-primary hover:bg-primary-soft"
                >
                  Tất cả loại phòng
                </button>
                {roomTypesDb.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => { setTypeFilter(t.id); setOpenFilter(null); }}
                    className={`w-full rounded-lg px-2 py-1.5 text-left text-sm hover:bg-primary-soft ${typeFilter === t.id ? "font-semibold text-primary" : "text-ink"}`}
                  >
                    {t.name}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="relative">
            <button onClick={() => setOpenFilter(openFilter === "policy" ? null : "policy")} className="cb-btn-ghost px-3 py-2 text-sm">
              Chính sách giá: {policyFilter === "all" ? "Tất cả" : policyLabel(policyFilter)} ▾
            </button>
            {openFilter === "policy" && (
              <div className="absolute left-0 top-full z-40 mt-1 w-56 rounded-xl border border-line bg-surface p-2 shadow-card">
                <button
                  onClick={() => { setPolicyFilter("all"); setOpenFilter(null); }}
                  className="mb-1 w-full rounded-lg px-2 py-1.5 text-left text-sm font-semibold text-primary hover:bg-primary-soft"
                >
                  Tất cả chính sách
                </button>
                {policyOptions.map((p) => (
                  <button
                    key={p}
                    onClick={() => { setPolicyFilter(p); setOpenFilter(null); }}
                    className={`w-full rounded-lg px-2 py-1.5 text-left text-sm hover:bg-primary-soft ${policyFilter === p ? "font-semibold text-primary" : "text-ink"}`}
                  >
                    {policyLabel(p)}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="relative">
            <button onClick={() => setOpenFilter(openFilter === "channel" ? null : "channel")} className="cb-btn-ghost px-3 py-2 text-sm">
              Kênh bán: {selectedChannel === "all" ? "Tất cả" : selCh?.name ?? selectedChannel}
              {selectedChannel === "all" ? "" : selectedChannel === "website" ? " ★ Giá gốc" : selectedChannel === "frontdesk" ? " ±0%" : selPct !== undefined ? ` +${selPct}%` : ""} ▾
            </button>
            {openFilter === "channel" && (
              <div className="absolute left-0 top-full z-40 mt-1 w-64 rounded-xl border border-line bg-surface p-2 shadow-card">
                <button
                  onClick={() => { setSelectedChannel("all"); setOpenFilter(null); }}
                  className={`flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-sm hover:bg-primary-soft ${selectedChannel === "all" ? "font-semibold text-primary" : "text-ink"}`}
                >
                  <span>Tất cả</span>
                  <span className="text-xs text-muted">mọi kênh</span>
                </button>
                {CHANNELS.map((c) => {
                  const pct = c.code === "website" ? undefined : channelCurrentPct(c.code);
                  return (
                    <button
                      key={c.code}
                      onClick={() => { setSelectedChannel(c.code); setOpenFilter(null); }}
                      className={`flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-sm hover:bg-primary-soft ${selectedChannel === c.code ? "font-semibold text-primary" : "text-ink"}`}
                    >
                      <span>{c.name}{c.code === "website" ? " ★ Giá gốc" : ""}</span>
                      <span className="text-xs text-muted">{c.code === "website" ? "" : c.code === "frontdesk" ? "±0%" : pct !== undefined ? `+${pct}%` : ""}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          <div className="relative">
            <button onClick={() => setOpenFilter(openFilter === "display" ? null : "display")} className="cb-btn-ghost px-3 py-2 text-sm">
              Hiển thị thêm ▾
            </button>
            {openFilter === "display" && (
              <div className="absolute left-0 top-full z-40 mt-1 w-56 rounded-xl border border-line bg-surface p-2 shadow-card">
                <label className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-ink hover:bg-primary-soft">
                  <input type="checkbox" checked={showAvailRow} onChange={(e) => setShowAvailRow(e.target.checked)} />
                  Hiện dòng Phòng trống
                </label>
                <label className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-ink hover:bg-primary-soft">
                  <input type="checkbox" checked={showHint} onChange={(e) => setShowHint(e.target.checked)} />
                  Hiện chú thích dưới bảng
                </label>
              </div>
            )}
          </div>
          <div className="relative">
            <button onClick={() => setShowLegend((v) => !v)} className="cb-btn-ghost px-2.5 py-2 text-sm font-bold" title="Chú thích màu và ký hiệu">
              ?
            </button>
            {showLegend && (
              <div className="absolute right-0 top-full z-40 mt-1 w-72 rounded-xl border border-line bg-surface p-3 text-xs text-ink shadow-card">
                <div className="mb-2 text-sm font-semibold">Chú thích</div>
                <p className="py-0.5"><span className="font-semibold">★ Giá gốc</span> — hàng Website, sửa được, các kênh khác tự tính theo.</p>
                <p className="py-0.5"><span className="font-semibold">▲ đen ở góc ô</span> — giá sửa tay (chỉ kênh đó); bấm ô rồi bấm “Xoá giá riêng” để về lại giá tự tính.</p>
                <p className="py-0.5"><span className="font-semibold text-muted">Hàng xám + chip %</span> — giá tự tính từ giá gốc, bấm ô để sửa tay.</p>
                <p className="py-0.5"><span className="font-semibold text-primary">— Đặt giá —</span> — kênh chưa có giá, bấm để tạo giá cho kênh đó.</p>
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
        </div>
      </div>
    );
  }

  function InvModal() {
    if (!invOpen) return null;
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-transparent p-4" onClick={() => setInvOpen(false)}>
        <div className="my-8 max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-surface p-5 shadow-card" onClick={(e) => e.stopPropagation()}>
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
    // Gia tu tinh (khong sua tay) cua o vua bam — de nguoi dung biet gia hien tai la gia tu tinh hay gia sua tay.
    const isDerivedPlan = !!plan.derivedFromId;
    const formulaPrice = isDerivedPlan ? resolvePlanPrice(plan, quick.date, plans, {}, basePeriods) : undefined;
    const currentShownPrice = priceForCell(plan, quick.date);
    const isCurrentlyOverride = isDerivedPlan && overrides[keyOf(plan.id, quick.date)] !== undefined;
    const hasOverrideInRange = isDerivedPlan && quDates.length > 0 && quDates.some((d) => overrides[keyOf(plan.id, d)] !== undefined);
    // Goi goc (Website): gia sua tay la gia da luu khac gia goc theo giai doan (hoac co gia ma khong co giai doan nao).
    const basePriceOnDate = !isDerivedPlan ? baseRatePrice(plan.roomTypeId, quick.date) : undefined;
    const isBaseOverride = !isDerivedPlan && plan.prices[quick.date] !== undefined && plan.prices[quick.date] !== basePriceOnDate;
    const hasBaseOverrideInRange = !isDerivedPlan && quDates.length > 0 && quDates.some((d) => plan.prices[d] !== undefined && plan.prices[d] !== baseRatePrice(plan.roomTypeId, d));
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-transparent p-4" onClick={closeQuickUpdate}>
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
            {quKind === "price" && isDerivedPlan && (
              <div className="rounded-lg bg-primary-soft px-3 py-2 text-xs leading-relaxed text-muted">
                Giá tự tính ngày {quick.date.split("-").reverse().join("/")} là {formulaPrice !== undefined ? fmt(formulaPrice) : "—"}
                {isCurrentlyOverride ? ` — hiện đang là giá sửa tay ${currentShownPrice !== undefined ? fmt(currentShownPrice) : "—"}` : " — chưa sửa tay"}.
                Nhập giá mới sẽ thành giá sửa tay cho riêng kênh này (các kênh khác không đổi). Muốn về lại giá tự tính thì bấm nút “Xoá giá riêng” bên dưới.
              </div>
            )}
            {quKind === "price" && !isDerivedPlan && (
              <div className="rounded-lg bg-primary-soft px-3 py-2 text-xs leading-relaxed text-muted">
                Giá gốc theo giai đoạn ngày {quick.date.split("-").reverse().join("/")} là {basePriceOnDate !== undefined ? fmt(basePriceOnDate) : "— (chưa có giai đoạn, giá là 0)"}
                {isBaseOverride ? ` — hiện đang là giá sửa tay ${currentShownPrice !== undefined ? fmt(currentShownPrice) : "—"}` : " — chưa sửa tay"}.
                Nhập giá mới sẽ thành giá sửa tay cho riêng kênh Website. Muốn về lại giá gốc thì bấm nút “Xoá giá riêng” bên dưới.
              </div>
            )}
            {quKind === "price" && quFrom && quTo && quFrom !== quTo && (
              <p className="text-right text-xs text-muted">Áp dụng cho {rangeDates(quFrom, quTo).length} ngày</p>
            )}
            {quKind === "price" && (hasOverrideInRange || hasBaseOverrideInRange) && (
              <button onClick={() => void resetOverrideToDerived()} disabled={quSaving} className="cb-btn-ghost w-full px-4 py-2 text-sm font-semibold text-danger">
                ↩ Xoá giá riêng — {isDerivedPlan ? "về giá tự tính" : "về giá gốc"} ({quDates.length} ngày)
              </button>
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

  // Popup doi % cong them (RATES12) — giong popup Cap nhat nhanh: mo ra chua sua gi thi nut Xac nhan mo, khong bam duoc.
  function MarkupModal() {
    if (!markup) return null;
    const chName = CHANNELS.find((c) => c.code === markup.channelCode)?.name ?? markup.channelCode;
    const newPct = Number(markupDraft);
    const hasChange = markupDraft !== "" && !Number.isNaN(newPct) && newPct !== markup.currentPct;
    const mkDisabled = markupSaving || !hasChange;
    // Xem truoc gia moi theo % moi: lay gia goc Website cua loai phong dau tien co gia trong khung hien.
    const previewBase = (() => {
      const t0 = roomTypesDb[0];
      if (!t0) return undefined;
      const wp = standardPlanFor("website", t0.id);
      if (!wp) return undefined;
      const d = days.find((x) => wp.prices[x] !== undefined);
      if (!d) return undefined;
      return { typeName: t0.name, dateShort: d.split("-").reverse().join("/"), price: wp.prices[d] as number };
    })();
    const previewNew = previewBase && hasChange
      ? applyFormula(previewBase.price, { id: "preview", name: "", kind: "percent", value: newPct })
      : undefined;
    const previewNow = previewBase
      ? applyFormula(previewBase.price, { id: "now", name: "", kind: "percent", value: markup.currentPct })
      : undefined;
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-transparent p-4" onClick={closeMarkup}>
        <div className="w-full max-w-md rounded-xl bg-surface p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between">
            <h3 className="text-base font-bold text-ink">Đổi % cộng thêm</h3>
            <button onClick={closeMarkup} className="rounded-md px-2 py-1 text-lg font-bold text-muted hover:bg-[var(--nui-bg)]">✕</button>
          </div>
          <div className="mt-4 space-y-3 text-sm">
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted">Kênh bán</span>
              <span className="font-semibold text-ink">{chName}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted">% hiện tại</span>
              <span className="font-semibold text-ink">{markup.currentPct >= 0 ? `+${markup.currentPct}%` : `${markup.currentPct}%`}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted">% mới</span>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  autoFocus
                  value={markupDraft}
                  onChange={(e) => setMarkupDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !mkDisabled) void applyMarkup();
                  }}
                  className="cb-input-pill w-24 px-2 py-1.5 text-right font-semibold"
                />
                <span className="text-muted">%</span>
              </div>
            </div>
            {hasChange && previewBase && previewNew !== undefined && (
              <div className="rounded-lg bg-primary-soft px-3 py-2 text-xs leading-relaxed text-ink">
                Ví dụ — {previewBase.typeName} ngày {previewBase.dateShort}: giá gốc {fmt(previewBase.price)} → {chName} mới <b>{fmt(previewNew)}</b>
                {previewNow !== undefined && <> (hiện tại {fmt(previewNow)} với +{markup.currentPct}%)</>}.
              </div>
            )}
            <p className="text-xs text-muted">Đổi % xong, giá của kênh này tính lại ngay theo % mới cho mọi loại phòng và mọi ngày, rồi gửi lên Channex.</p>
            {markupError && <p className="text-sm font-medium text-danger">{markupError}</p>}
          </div>
          <div className="mt-5 flex gap-3">
            <button onClick={closeMarkup} className="cb-btn-ghost flex-1 px-4 py-2 text-sm">Huỷ bỏ</button>
            <button onClick={() => void applyMarkup()} disabled={mkDisabled} className="cb-btn-primary flex-1 px-4 py-2 text-sm disabled:opacity-50">{markupSaving ? "Đang lưu..." : "Xác nhận"}</button>
          </div>
        </div>
      </div>
    );
  }

  // Man hinh tao gia cho kenh (RATES14) — 1 buoc: kenh, loai phong, suy ra tu gia goc, % cong them, xem truoc bang tien that.
  function CreateRateModal() {
    if (!creator) return null;
    const ch = CHANNELS.find((c) => c.code === creator.channelCode);
    const chName = ch?.name ?? creator.channelCode;
    const typeName = roomTypesDb.find((t) => t.id === creator.roomTypeId)?.name ?? creator.roomTypeId;
    const isOta = ch?.type === "ota";
    const webPlan = standardPlanFor("website", creator.roomTypeId);
    const basePrice = webPlan?.prices[creator.date];
    // Gia goc de xem truoc: gia ngay vua bam, khong co thi ngay gan nhat co gia (trong khung hien truoc, roi moi ngay).
    const previewBase = (() => {
      if (!webPlan) return undefined;
      if (basePrice !== undefined) return { dateShort: creator.date.split("-").reverse().join("/"), price: basePrice };
      const d = days.find((x) => webPlan.prices[x] !== undefined)
        ?? Object.keys(webPlan.prices).sort().find((x) => webPlan.prices[x] !== undefined);
      return d ? { dateShort: d.split("-").reverse().join("/"), price: webPlan.prices[d] as number } : undefined;
    })();
    const pct = Number(creatorPct);
    const pctOk = creatorPct !== "" && !Number.isNaN(pct);
    const previewPrice = previewBase && pctOk && isOta
      ? applyFormula(previewBase.price, { id: "pv", name: "", kind: "percent", value: pct })
      : previewBase && !isOta
        ? previewBase.price
        : undefined;
    const noBase = !webPlan || !previewBase;
    const canCreate = !creatorSaving && !noBase && (!isOta || pctOk);
    const dateShort = creator.date.split("-").reverse().join("/");
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-transparent p-4" onClick={closeCreator}>
        <div className="w-full max-w-md rounded-xl bg-surface p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between">
            <h3 className="text-base font-bold text-ink">Tạo giá cho kênh</h3>
            <button onClick={closeCreator} className="rounded-md px-2 py-1 text-lg font-bold text-muted hover:bg-[var(--nui-bg)]">✕</button>
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
              <span className="text-muted">Suy ra từ</span>
              <span className="font-semibold text-ink">Website — Giá gốc</span>
            </div>
            {isOta && (
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted">% cộng thêm</span>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    autoFocus
                    value={creatorPct}
                    onChange={(e) => setCreatorPct(e.target.value)}
                    className="cb-input-pill w-24 px-2 py-1.5 text-right font-semibold"
                  />
                  <span className="text-muted">%</span>
                </div>
              </div>
            )}
            {!isOta && (
              <p className="text-xs text-muted">Giá bằng giá gốc (không cộng thêm).</p>
            )}
            {previewBase && previewPrice !== undefined && (
              <div className="rounded-lg bg-primary-soft px-3 py-2 text-xs leading-relaxed text-ink">
                {chName} {typeName} = Giá gốc {fmt(previewBase.price)} {isOta ? `+ ${pct}%` : ""} = <b>{fmt(previewPrice)}</b>
                {previewBase.dateShort !== dateShort && <> (giá gốc ngày {previewBase.dateShort})</>}.
              </div>
            )}
            {noBase && (
              <p className="text-sm font-medium text-danger">Chưa có giá gốc cho {typeName} — nhập giá gốc ở hàng Website trước rồi mới tạo giá cho kênh.</p>
            )}
            {isOta && <p className="text-xs text-muted">Đổi % ở đây sẽ đổi cho mọi loại phòng của kênh {chName}.</p>}
            {creatorError && <p className="text-sm font-medium text-danger">{creatorError}</p>}
          </div>
          <div className="mt-5 flex gap-3">
            <button onClick={closeCreator} className="cb-btn-ghost flex-1 px-4 py-2 text-sm">Huỷ bỏ</button>
            <button onClick={() => void applyCreateRate()} disabled={!canCreate} className="cb-btn-primary flex-1 px-4 py-2 text-sm disabled:opacity-50">{creatorSaving ? "Đang tạo..." : "Tạo giá cho kênh"}</button>
          </div>
        </div>
      </div>
    );
  }

  // ---------- luoi gia ----------
  function renderPriceCell(plan: RatePlan | undefined, date: string, channelCode: string, typeId: string) {
    // Kênh chưa có gói giá: hiện nút "— Đặt giá —" mở màn hình tạo giá 1 bước (không tự tạo ngầm khi bấm ô).
    if (!plan && channelCode !== "website") {
      return (
        <div
          key={date}
          onClick={() => void openCreator(channelCode, typeId, date)}
          className={`cursor-pointer border-b border-l border-[var(--nui-bg)] px-2 py-2 text-center hover:bg-primary-soft/70 ${date === todayStr ? "bg-primary-soft/50" : ""}`}
          title="Chưa có giá cho kênh này — bấm để tạo giá"
        >
          <span className="inline-block rounded-md border border-dashed border-line px-2 py-0.5 text-[11px] font-semibold text-primary">— Đặt giá —</span>
        </div>
      );
    }
    const r = plan ? restrictions[keyOf(plan.id, date)] : undefined;
    const isEditing = !!plan && editing?.planId === plan.id && editing?.date === date;
    const price = plan ? priceForCell(plan, date) : undefined;
    // Gia sua tay: goi suy ra thi co dong trong overrides; goi goc thi gia da luu khac gia goc theo giai doan.
    const isOverride = !!plan && (plan.derivedFromId
      ? overrides[keyOf(plan.id, date)] !== undefined
      : plan.prices[date] !== undefined && plan.prices[date] !== baseRatePrice(plan.roomTypeId, date));
    const derivedPct = plan?.derivedFromId ? getFormula(plan.formulaId)?.value : undefined;
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
        className={`relative cursor-pointer border-b border-l border-[var(--nui-bg)] px-2 py-3 text-center hover:bg-primary-soft/70 ${r?.stopSell || ib ? "bg-danger-soft" : saved ? "bg-success-soft" : date === todayStr ? "bg-primary-soft/50" : ""}`}
        title={
          isOverride
            ? plan?.derivedFromId
              ? "Giá sửa tay — bấm để xem, sửa hoặc xoá về giá tự tính."
              : "Giá sửa tay — bấm để xem, sửa hoặc xoá về giá gốc."
            : plan?.derivedFromId
              ? `Giá tự tính từ giá gốc${derivedPct !== undefined ? ` +${derivedPct}%` : ""} — bấm để đặt giá riêng (sửa tay), đổi % ở đầu hàng.`
              : undefined
        }
      >
        {isOverride && !ib && !r?.stopSell && (
          <span className="absolute right-1 top-1 text-[9px] leading-none text-ink" title="Giá sửa tay">▲</span>
        )}
        {ib ? (
          <div className="text-[11px] font-semibold text-muted">
            ĐÓNG BÁN
            <div className="text-[10px] font-medium">{ib.scope === "channel" ? "(đóng theo kênh)" : "(đóng cả loại phòng)"}</div>
          </div>
        ) : r?.stopSell ? (
          <div className="text-[11px] font-semibold text-danger">ĐÓNG BÁN</div>
        ) : (
          <>
            <div className={`text-[12px] tabular-nums ${priceWeightCls} ${priceTextCls}`}>
              {price !== undefined ? fmt(price) : <span className="font-normal text-subtle">—</span>}
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

  // Doi % cong them cua 1 kenh (RATES11) — % chi dat o Lich gia, khong dat o trang Kenh ban nua.
  // Cap nhat formula cua goi chuan suy ra cua kenh (moi loai phong 1 goi); gia kenh tinh lai tu dong theo cong thuc moi roi gui len Channex.
  async function setChannelMarkup(channelCode: string, pct: number): Promise<boolean> {
    const formulaId = pct > 0 ? `f-plus${pct}` : pct < 0 ? `f-minus${-pct}` : undefined;
    const targets = roomTypesDb
      .map((t) => standardPlanFor(channelCode, t.id))
      .filter((p): p is RatePlan => !!p && !!p.derivedFromId);
    if (targets.length === 0) return false;
    const oldPct = getFormula(targets[0].formulaId)?.value ?? 0;
    if (oldPct === pct) return true;
    const ids = targets.map((p) => p.id);
    const { error } = await supabase.from("rate_plans").update({ formula_id: formulaId ?? null }).in("id", ids);
    if (error) {
      setDbError("Đổi % cộng thêm không thành công: " + error.message);
      return false;
    }
    setPlans((prev) => prev.map((p) => (ids.includes(p.id) ? { ...p, formulaId } : p)));
    markDirty(channelCode);
    queueChannexDates(days);
    const chName = CHANNELS.find((c) => c.code === channelCode)?.name ?? channelCode;
    await writeAuditLog({
      hotelId: HOTEL_ID,
      accountId: ACCOUNT_ID,
      action: "price_updated",
      entityType: "rate_price",
      entityId: channelCode,
      summary: `Đổi % cộng thêm kênh ${chName}: ${oldPct}% → ${pct}% (giá kênh tính lại theo % mới)`,
      details: { channelCode, oldPct, newPct: pct },
    });
    logChange(`Đổi % cộng thêm kênh ${chName}: ${oldPct}% → ${pct}%`);
    showToast(`Đã đổi % cộng thêm kênh ${chName} thành ${pct}% — giá kênh đã tính lại, đang gửi lên Channex.`);
    return true;
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
        <div className={`sticky left-0 z-10 border-b shadow-[2px_0_4px_rgba(23,41,62,0.05)] border-[var(--nui-bg)] px-3 py-3 ${isBase ? "bg-primary-soft" : "bg-surface-muted"}`}>
          <div className={`flex items-center gap-1.5 text-sm ${isBase ? "font-bold text-ink" : "font-medium text-muted"}`}>
            {isBase ? "★ " : <span className="pl-4" />}
            {ch?.name ?? channelCode}
            {isBase && <span className="rounded bg-primary px-1.5 py-0.5 text-[11px] font-bold text-white">Giá gốc</span>}
            {!isBase && (
              <button
                onClick={() => openMarkup(channelCode, formulaPct ?? 0)}
                className="rounded bg-primary-soft px-1.5 py-0.5 text-[11px] font-bold text-primary hover:bg-primary hover:text-white"
                title="Bấm để đổi % cộng thêm của kênh này"
              >
                {formulaPct !== undefined ? `+${formulaPct}%` : "±0%"}
              </button>
            )}
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
        <div className="sticky left-0 z-10 border-b shadow-[2px_0_4px_rgba(23,41,62,0.05)] border-[var(--nui-bg)] bg-surface px-3 py-2.5 pl-9 text-xs text-muted">Còn trống</div>
        {days.map((date, i) => {
          const n = left[i] ?? 0;
          return (
            <div key={date} className={`border-b border-l border-[var(--nui-bg)] px-2 py-2.5 text-center text-xs font-semibold tabular-nums ${n <= 0 ? "bg-warning-soft text-danger" : "text-muted"}`}>
              {n}
            </div>
          );
        })}
      </div>
    );
  }

  // ---------- luoi "Ban phong theo loai phong" (RATES15) ----------
  // Moi loai phong chi 2 dong (Phong trong + Gia ban). Ten loai phong + ma + nut thu gon
  // om ca 2 dong (gridRow span 2) — khong con dong tieu de nhom rieng.
  function renderTypeGroup(t: RoomType) {
    const collapsed = collapsedTypes.has(t.id);
    const left = roomsLeftByType[t.id] ?? [];
    // Kênh đang xem: 1 kênh, hoặc tất cả các kênh (mỗi kênh 1 dòng giá).
    const priceChannels = selectedChannel === "all" ? CHANNELS : CHANNELS.filter((c) => c.code === selectedChannel);
    const rowSpan = (showAvailRow ? 1 : 0) + priceChannels.length;
    const toggleCollapse = () =>
      setCollapsedTypes((prev) => {
        const next = new Set(prev);
        if (next.has(t.id)) next.delete(t.id);
        else next.add(t.id);
        return next;
      });
    const nameInner = (
      <div className="flex items-start gap-1.5">
        <button
          onClick={toggleCollapse}
          className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded border border-line bg-surface text-xs font-bold text-muted"
          title={collapsed ? "Mở ra xem giá" : "Thu gọn loại phòng này"}
        >
          {collapsed ? "+" : "−"}
        </button>
        <div className="min-w-0">
          <div className="text-[12px] font-bold leading-tight text-ink">{t.name}</div>
          {t.code ? <div className="text-[10px] font-medium text-muted">Mã: {t.code}</div> : null}
        </div>
      </div>
    );
    if (collapsed) {
      const prices = priceChannels.flatMap((ch) => {
        const p = standardPlanFor(ch.code, t.id);
        if (!p) return [];
        return days.map((d) => priceForCell(p, d)).filter((v): v is number => v !== undefined);
      });
      const lo = prices.length > 0 ? Math.min(...prices) : undefined;
      const hi = prices.length > 0 ? Math.max(...prices) : undefined;
      const rangeText = lo !== undefined && hi !== undefined ? (lo === hi ? fmt(lo) : `${fmt(lo)} – ${fmt(hi)}`) : null;
      const singlePlan = priceChannels.length === 1 ? standardPlanFor(priceChannels[0].code, t.id) : undefined;
      return (
        <div className="contents" key={t.id}>
          <div
            className="sticky left-0 z-10 border-b border-[var(--nui-bg)] bg-primary-soft px-3 py-2 shadow-[2px_0_4px_rgba(23,41,62,0.05)]"
            style={{ gridColumn: "span 2" }}
          >
            {nameInner}
          </div>
          <div
            className="border-b border-l border-[var(--nui-bg)] px-3 py-2 text-[12px] text-muted"
            style={{ gridColumn: `span ${days.length}` }}
          >
            {rangeText ? (
              <>Giá {selectedChannel === "all" ? "tất cả kênh" : CHANNELS.find((c) => c.code === selectedChannel)?.name ?? selectedChannel}: {rangeText}</>
            ) : singlePlan ? (
              "Chưa có giá trong khoảng này"
            ) : priceChannels.length === 1 ? (
              <button
                onClick={() => void openCreator(selectedChannel, t.id, days[0])}
                className="rounded-md border border-dashed border-line px-2 py-0.5 text-xs font-semibold text-primary hover:bg-primary-soft"
              >
                — Đặt giá —
              </button>
            ) : (
              "Chưa có giá trong khoảng này"
            )}
          </div>
        </div>
      );
    }
    return (
      <div className="contents" key={t.id}>
        <div
          className="sticky left-0 z-10 border-b border-[var(--nui-bg)] bg-primary-soft px-3 py-2 shadow-[2px_0_4px_rgba(23,41,62,0.05)]"
          style={{ gridColumn: "1", gridRow: `span ${rowSpan}` }}
        >
          {nameInner}
        </div>
        {showAvailRow && (
          <>
            <div className="sticky left-[140px] z-10 border-b border-[var(--nui-bg)] bg-surface px-3 py-2 text-[12px] font-semibold text-muted shadow-[2px_0_4px_rgba(23,41,62,0.05)]">
              Phòng trống
            </div>
            {days.map((date, i) => {
              const n = left[i] ?? 0;
              return (
                <div
                  key={date}
                  className={`border-b border-l border-[var(--nui-bg)] px-2 py-2 text-center text-[12px] font-semibold tabular-nums ${n <= 0 ? "bg-warning-soft text-danger" : "text-muted"}`}
                >
                  {n}
                </div>
              );
            })}
          </>
        )}
        {priceChannels.map((ch) => {
          const plan = standardPlanFor(ch.code, t.id);
          // % cua rieng goi nay (co the khac nhau theo loai phong) — khong dung % chung cua kenh.
          const pct = plan?.derivedFromId
            ? getFormula(plan.formulaId)?.value
            : ch.code === "website" ? undefined : channelCurrentPct(ch.code);
          return (
            <div className="contents" key={ch.code}>
              <div className="sticky left-[140px] z-10 border-b border-[var(--nui-bg)] bg-surface px-3 py-2 shadow-[2px_0_4px_rgba(23,41,62,0.05)]">
                <div className="flex items-center gap-1.5 text-[12px] font-semibold text-ink">
                  Giá bán (VNĐ)
                  {plan && (
                    <button
                      onClick={() => void openQuickUpdate(ch.code, t.id, days[0])}
                      className="rounded p-0.5 text-muted hover:bg-primary-soft hover:text-primary"
                      title="Sửa nhanh cả hàng giá này"
                    >
                      <IconEdit className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                {priceChannels.length > 1 && (
                  <div className="text-[10px] font-medium text-muted">
                    {ch.name}
                    {ch.code === "website" ? " ★ Giá gốc" : ch.code === "frontdesk" ? " ±0%" : pct !== undefined ? ` +${pct}%` : ""}
                  </div>
                )}
              </div>
              {days.map((date) => renderPriceCell(plan, date, ch.code, t.id))}
            </div>
          );
        })}
      </div>
    );
  }

  // ---------- bang rieng 1 kenh o tab "Ban phong theo kenh" ----------
  // ---------- tab "Ban phong theo kenh" (RATES18): SO LUONG PHONG, khong phai gia ----------
  // Moi loai phong 1 dong: chon kenh o dropdown rieng, xem so phong con trong cua kenh do.
  // O = 0 to vang (het phong); o "DONG BAN" la kenh dang dong ban. Bam 1 o de mo cua so Dong ban.
  function renderChannelInventory() {
    return (
      <div className="overflow-x-auto rounded-xl border border-line bg-surface shadow-card">
        <div className="grid min-w-[1340px]" style={gridColsInv}>
          {DateHeader({ label: "Loại phòng", labelSpan: 2 })}
          {visibleTypes.map((t) => {
            const chCode = rowChannel(t.id);
            const left = roomsLeftByType[t.id] ?? [];
            return (
              <div className="contents" key={t.id}>
                <div className="sticky left-0 z-10 border-b border-[var(--nui-bg)] bg-surface px-3 py-2 shadow-[2px_0_4px_rgba(23,41,62,0.05)]">
                  <div className="text-[12px] font-bold leading-tight text-ink">{t.name}</div>
                  {t.code ? <div className="text-[10px] text-muted">Mã: {t.code}</div> : null}
                </div>
                <div className="sticky left-[180px] z-10 border-b border-[var(--nui-bg)] bg-surface px-3 py-2 shadow-[2px_0_4px_rgba(23,41,62,0.05)]">
                  <select
                    value={chCode}
                    onChange={(e) => setChannelByType((prev) => ({ ...prev, [t.id]: e.target.value }))}
                    className="w-full rounded-lg border border-line bg-surface px-2 py-1 text-[12px] font-semibold text-primary outline-none focus:border-primary"
                    title="Chọn kênh để xem số phòng còn trống của kênh đó"
                  >
                    {CHANNELS.map((c) => (
                      <option key={c.code} value={c.code}>{c.name}</option>
                    ))}
                  </select>
                  <div className="mt-1 text-[11px] font-medium text-muted">Phòng trống</div>
                </div>
                {days.map((date, i) => {
                  const n = left[i] ?? 0;
                  const ib = inventoryBlockOn(invBlocks, chCode, t.id, date);
                  return (
                    <div
                      key={date}
                      onClick={() => openInvForCell(chCode, t.id, date)}
                      className={`cursor-pointer border-b border-l border-[var(--nui-bg)] px-2 py-2 text-center text-[12px] font-semibold tabular-nums hover:bg-primary-soft/70 ${ib ? "bg-danger-soft text-danger" : n <= 0 ? "bg-warning-soft text-danger" : "text-ink"}`}
                      title={ib ? "Kênh này đang đóng bán ngày này — bấm để xem/xoá đóng bán" : n <= 0 ? "Hết phòng — bấm để đóng/mở bán kênh này ngày này" : `Còn ${n} phòng — bấm để đóng bán kênh này ngày này`}
                    >
                      {ib ? <span className="text-[11px]">ĐÓNG BÁN</span> : n}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  function renderChannelTable(channelCode: string) {
    const ch = CHANNELS.find((c) => c.code === channelCode);
    const isBase = channelCode === "website";
    const pct = isBase ? undefined : channelCurrentPct(channelCode);
    return (
      <div key={channelCode}>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className="text-[15px] font-bold text-ink">{isBase ? "★ " : ""}{ch?.name ?? channelCode}</span>
          {isBase ? (
            <span className="rounded bg-primary px-1.5 py-0.5 text-[11px] font-bold text-white">Giá gốc</span>
          ) : (
            <button
              onClick={() => openMarkup(channelCode, pct ?? 0)}
              className="rounded bg-primary-soft px-1.5 py-0.5 text-[11px] font-bold text-primary hover:bg-primary hover:text-white"
              title="Bấm để đổi % cộng thêm của kênh này"
            >
              {pct !== undefined ? `+${pct}%` : "±0%"}
            </button>
          )}
          {dirtyChannels.has(channelCode) && <span className="text-warning" title="Có thay đổi chưa đẩy lên Channex">●</span>}
          {!isBase && (
            <span className="text-xs text-muted">
              Giá tự tính từ giá gốc {pct !== undefined ? `+${pct}%` : "±0%"} — bấm ô để đặt giá riêng.
            </span>
          )}
        </div>
        <div className="overflow-x-auto rounded-xl border border-line bg-surface shadow-card">
          <div className="grid min-w-[1264px]" style={gridColsChannel}>
            {DateHeader({ label: "Loại phòng", labelSpan: 1 })}
            {visibleTypes.map((t) => {
              const plan = standardPlanFor(channelCode, t.id);
              return (
                <div className="contents" key={t.id}>
                  <div className="sticky left-0 z-10 border-b border-[var(--nui-bg)] bg-surface px-3 py-2 shadow-[2px_0_4px_rgba(23,41,62,0.05)]">
                    <div className="text-[12px] font-bold leading-tight text-ink">{t.name}</div>
                    {t.code ? <div className="text-[10px] text-muted">Mã: {t.code}</div> : null}
                  </div>
                  {days.map((date) => renderPriceCell(plan, date, channelCode, t.id))}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  // ---------- luoi gop kieu RATES14 (muc "Tat ca" o tab "Ban phong theo kenh") ----------
  function renderCombinedGrid() {
    return (
      <div className="overflow-x-auto rounded-xl border border-line bg-surface shadow-card">
        <div className="grid min-w-[1264px]" style={gridColsChannel}>
          {DateHeader({ label: "Ngày →", labelSpan: 1 })}
          {visibleTypes.map((t) => (
            <div key={t.id} className="contents">
              {TypeHeader({ t })}
              {days.map((d) => (
                <div key={d} className="border-b border-l border-[var(--nui-bg)] bg-primary-soft" />
              ))}
              {!collapsedTypes.has(t.id) && (
                <>
                  {renderAvailabilitySlimRow(t.id)}
                  {CHANNELS.map((c) => renderPriceRows(c.code, t.id))}
                </>
              )}
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ---------- hop thoai Cap nhat hang loat (RATES15): 4 cau hoi ----------
  // Ap dung cho kenh dang chon o dropdown Kenh ban; luu bang dung duong luu hien co
  // (upsert rate_prices nhu applyQuickUpdate cho gia, setRestriction cho ngung ban / min-stay).
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
      {mainTab === "byType" && (
        <>
          <div className="mt-4 overflow-x-auto rounded-xl border border-line bg-surface shadow-card">
            <div className="grid min-w-[1280px]" style={gridColsType}>
              {DateHeader({ label: "Loại phòng", labelSpan: 2 })}
              {visibleTypes.map((t) => renderTypeGroup(t))}
            </div>
          </div>
          {showHint && (
            <p className="mt-2 text-xs text-muted">
              Dòng “Giá bán” hiện giá {selectedChannel === "all" ? "của tất cả các kênh (mỗi kênh 1 dòng)" : `của kênh ${CHANNELS.find((c) => c.code === selectedChannel)?.name ?? selectedChannel}`} (đổi ở dropdown Kênh bán). Giá kênh tự tính từ giá gốc (hàng Website, có ★) theo % cộng thêm ở đầu bảng kênh. Kênh chưa có giá thì bấm “— Đặt giá —” để tạo giá. Bấm ô giá để đặt giá riêng cho kênh đó — thành giá sửa tay (tam giác đen ở góc ô), chỉ kênh đó đổi, các kênh khác không đổi; bấm nút “Xoá giá riêng” trong popup để về lại giá tự tính.
            </p>
          )}
        </>
      )}

      {mainTab === "byChannel" && (
        <>
          <div className="mt-4">{renderChannelInventory()}</div>
          {showHint && (
            <p className="mt-2 text-xs text-muted">
              Mỗi loại phòng chọn 1 kênh ở dropdown “Chọn kênh” để xem số phòng còn trống của kênh đó. Ô = 0 tô vàng (hết phòng); ô “ĐÓNG BÁN” là kênh đang đóng bán ngày đó. Bấm 1 ô để mở cửa sổ Đóng bán cho kênh + loại phòng + ngày đó. Giá bán xem ở tab “Bán phòng theo loại phòng”.
            </p>
          )}
        </>
      )}

      {InvModal()}
      {RestrictionPopover()}
      {QuickUpdateModal()}
      {MarkupModal()}
      {CreateRateModal()}
    </div>
  );
}
