"use client";
// ============================================================
// components/StaffCalendar.tsx — LICH PHONG kieu Cloudbeds
// CALDATE1 (2026-11-13): lich + form chan phong mo dung ngay
// hom nay that theo gio dia phuong, khong ket o ngay mau
// 21/10/2026 cua mock-data nua (cach lam giong RatesCalendar).
// Tape chart: truc thoi gian DAI (28 ngay), nhom theo loai
// phong, moi cot ngay co % cong suat + so phong trong, moi
// nhom loai phong co dong tom tat (trong + gia quay).
// Logic giu nguyen: keo-tha doi phong/ngay, chan phong,
// check-in/out, du lieu doc/ghi Supabase, day Channex qua
// hang doi khi ton phong thay doi.
// CBCAL1 (2026-11-17): huy hieu "0 don chua gan" doi mau kem
// #e7ddd3 sang vien --cb-border theo bang mau Cloudbeds moi.
// ============================================================

import { useEffect, useMemo, useRef, useState } from "react";
import {
  TODAY,
  getChannelName,
  getRoomTypeName,
  resolvePlanPrice,
  roomBlockOn,
  type InventoryBlock,
  type RatePlan,
  type Reservation,
  type Room,
  type RoomBlock,
} from "@/lib/mock-data";
import {
  canCancel,
  canCheckIn,
  canCheckOut,
  priceBreakdown,
  roomFits,
  validateAssign,
  validateBlock,
  validateDrop,
  type AvailabilityData,
} from "@/lib/booking-rules";
import { supabase } from "@/lib/supabase";
import { currentHotelId } from "@/lib/current-hotel";
import { useParams } from "next/navigation";
import { queueChannexDates, rangeDates, stayDates } from "@/lib/channex-outbox";
import ReservationBar, { STATUS_STYLES, STATUS_LABELS } from "./ReservationBar";
import { DateRangePicker } from "@/components/DatePicker";
import { IconBan, IconCalendar, IconDroplet } from "@/components/icons";
import BookingPopup from "./BookingPopup";

const ACCOUNT_ID = "11111111-1111-1111-1111-111111111111";

// ---------- date helpers (dates are "YYYY-MM-DD" strings) ----------
const DAY_MS = 86_400_000;
const toTime = (d: string) => new Date(d + "T00:00:00Z").getTime();
const toISO = (t: number) => new Date(t).toISOString().slice(0, 10);
const addDays = (d: string, n: number) => toISO(toTime(d) + n * DAY_MS);
// "2026-10" + so thang -> "2026-11" (cho lich mini chon ngay o panel)
const addMonths = (yyyyMM: string, delta: number) => {
  const [y, m] = yyyyMM.split("-").map(Number);
  const total = y * 12 + (m - 1) + delta;
  const ny = Math.floor(total / 12);
  return `${ny}-${String(total - ny * 12 + 1).padStart(2, "0")}`;
};
const diffDays = (from: string, to: string) => Math.round((toTime(to) - toTime(from)) / DAY_MS);
const WEEKDAYS = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];
// "T5, 12/11" — tieu de popup nho khi bam o lich (kieu Cloudbeds)
const fmtStayDay = (iso: string) => {
  const d = new Date(iso + "T12:00:00");
  const p = (n: number) => String(n).padStart(2, "0");
  return `${WEEKDAYS[d.getDay()]}, ${p(d.getDate())}/${p(d.getMonth() + 1)}`;
};
const overlaps = (aIn: string, aOut: string, bIn: string, bOut: string) => aIn < bOut && bIn < aOut;

const WINDOW = 28; // so ngay hien tren truc (Cloudbeds ~4 tuan)

const HK_DOT: Record<string, string> = {
  clean: "bg-[#1db584]",
  dirty: "bg-[#e5484d]",
  in_progress: "bg-[#f59e0b]",
  out_of_order: "bg-[var(--cb-muted)]",
};
const HK_LABEL: Record<string, string> = {
  clean: "Đã dọn",
  dirty: "Cần dọn",
  in_progress: "Đang dọn",
  out_of_order: "Đang sửa",
};

/** what is being dragged right now */
type DragItem = { reservationId: string; roomNumber: string | null; visibleStart: number };

export default function StaffCalendar() {
  // Khach san lay tu URL /h/[hotelId] khi co; neu khong (duong dan cu)
  // thi dung khach san da luu theo tab.
  const params = useParams();
  const HOTEL_ID = typeof params.hotelId === "string" ? params.hotelId : currentHotelId();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [blocks, setBlocks] = useState<RoomBlock[]>([]);
  const [invBlocks, setInvBlocks] = useState<InventoryBlock[]>([]);
  const [typeNames, setTypeNames] = useState<Record<string, string>>({});
  const [rack, setRack] = useState<Record<string, Record<string, number>>>({});
  // Goi gia + gia rieng (goi ke thua) — phuc vu tinh lai tien khi
  // keo doi ngay / gan sang loai phong khac.
  const [planObjs, setPlanObjs] = useState<RatePlan[]>([]);
  const [priceOverrides, setPriceOverrides] = useState<Record<string, number>>({});

  // Du lieu dung chung cho bo kiem tra: phong + don + chan phong + dong ban.
  const availData: AvailabilityData = useMemo(
    () => ({ rooms, reservations, blocks, invBlocks }),
    [rooms, reservations, blocks, invBlocks],
  );
  const [currency, setCurrency] = useState("VND");
  const [dbError, setDbError] = useState("");
  const [dragging, setDragging] = useState<DragItem | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [popupAnchor, setPopupAnchor] = useState<{ x: number; y: number } | null>(null);
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [showBlockForm, setShowBlockForm] = useState(false);
  const [startDate, setStartDate] = useState(TODAY);
  const [todayStr, setTodayStr] = useState<string>(TODAY);

  // block form state
  const [bfRoom, setBfRoom] = useState<string>("");
  const [bfFrom, setBfFrom] = useState(TODAY);
  const [bfTo, setBfTo] = useState(TODAY);
  const [bfKind, setBfKind] = useState<RoomBlock["kind"]>("out_of_order");
  const [bfReason, setBfReason] = useState("");

  const selectedBlock = blocks.find((b) => b.id === selectedBlockId) ?? null;
  const typeName = (tid: string) => typeNames[tid] ?? getRoomTypeName(tid);

  const days = useMemo(
    () => Array.from({ length: WINDOW }, (_, i) => addDays(startDate, i)),
    [startDate]
  );

  // Ngay hom nay that theo gio dia phuong (tinh o client, sau
  // khi mount, de khong lech ngay khi render phia may chu).
  // Lich mo dung ngay hom nay thay vi ket o ngay mau TODAY.
  // (Cung cach nhu RatesCalendar.)
  useEffect(() => {
    const d = new Date();
    const s = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    setTodayStr(s);
    setStartDate(s);
    setBfFrom(s);
    setBfTo(s);
  }, []);

  // ---------- load everything from Supabase ----------
  useEffect(() => {
    (async () => {
      const [roomsRes, resRes, rrRes, blocksRes, typesRes, hotelRes, plansRes, invRes] = await Promise.all([
        supabase.from("rooms").select("*").eq("hotel_id", HOTEL_ID).order("number"),
        supabase.from("reservations").select("*").eq("hotel_id", HOTEL_ID),
        supabase.from("reservation_rooms").select("reservation_id, room_number"),
        supabase.from("room_blocks").select("*").eq("hotel_id", HOTEL_ID),
        supabase.from("room_types").select("id, name").eq("hotel_id", HOTEL_ID),
        supabase.from("hotels").select("currency").eq("id", HOTEL_ID).single(),
        supabase.from("rate_plans").select("*").eq("hotel_id", HOTEL_ID),
        supabase.from("inventory_blocks").select("*").eq("hotel_id", HOTEL_ID),
      ]);
      const err = roomsRes.error ?? resRes.error ?? rrRes.error ?? blocksRes.error;
      if (err) return setDbError(err.message);
      setRooms(
        (roomsRes.data ?? []).map((r) => ({
          number: r.number,
          roomTypeId: r.room_type_id,
          housekeepingStatus: r.housekeeping_status,
        }))
      );
      if ((roomsRes.data ?? []).length > 0) setBfRoom((prev) => prev || roomsRes.data![0].number);
      const tnames: Record<string, string> = {};
      for (const t of typesRes.data ?? []) tnames[t.id] = t.name;
      setTypeNames(tnames);
      if (hotelRes.data?.currency) setCurrency(hotelRes.data.currency);
      const roomsMap = new Map<string, string[]>();
      for (const row of rrRes.data ?? []) {
        const list = roomsMap.get(row.reservation_id) ?? [];
        list.push(row.room_number);
        roomsMap.set(row.reservation_id, list);
      }
      setReservations(
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
      setBlocks(
        (blocksRes.data ?? []).map((b) => ({
          id: b.id,
          roomNumber: b.room_number,
          from: b.from_date,
          to: b.to_date,
          kind: b.kind,
          reason: b.reason ?? "",
        }))
      );
      setInvBlocks((invRes.data ?? []).map((b) => ({
        id: b.id,
        scope: b.scope,
        channelCode: b.channel_code ?? undefined,
        roomTypeId: b.room_type_id,
        from: b.from_date,
        to: b.to_date,
        reason: b.reason ?? undefined,
      })));

      // ----- dem ghi chu theo don (cham vang tren thanh lich) -----
      // Bang reservation_notes co the chua ton tai neu chua chay SQL 14:
      // loi o day khong chan lich, chi khong hien cham vang.
      try {
        const counts: Record<string, number> = {};
        for (let from = 0; ; from += 1000) {
          const { data, error } = await supabase
            .from("reservation_notes")
            .select("reservation_id")
            .eq("hotel_id", HOTEL_ID)
            .range(from, from + 999);
          if (error || !data || data.length === 0) break;
          for (const row of data) counts[row.reservation_id] = (counts[row.reservation_id] ?? 0) + 1;
          if (data.length < 1000) break;
        }
        setNotesCount(counts);
      } catch {
        // bo qua: lich van chay binh thuong, chi thieu cham vang
      }

      // ----- rack price per room type (front-desk plan if the
      // type has one, otherwise its first plan) for the header --
      const planObjs: RatePlan[] = (plansRes.data ?? []).map((p) => ({
        id: p.id,
        channelCode: p.channel_code,
        roomTypeId: p.room_type_id,
        name: p.name,
        mealPlan: p.meal_plan as RatePlan["mealPlan"],
        baseOccupancy: p.base_occupancy,
        extraAdultFee: p.extra_adult_fee,
        extraChildFee: p.extra_child_fee,
        cancellationPolicy: p.cancellation_policy as RatePlan["cancellationPolicy"],
        prices: {},
        derivedFromId: p.derived_from_id ?? undefined,
        formulaId: p.formula_id ?? undefined,
      }));
      const chosen = new Map<string, RatePlan>();
      for (const p of [...planObjs].sort((a, b) => a.name.localeCompare(b.name))) {
        const cur = chosen.get(p.roomTypeId);
        if (!cur || (p.channelCode === "frontdesk" && cur.channelCode !== "frontdesk"))
          chosen.set(p.roomTypeId, p);
      }
      if (chosen.size > 0) {
        const needIds = new Set<string>();
        for (const p of chosen.values()) {
          needIds.add(p.id);
          if (p.derivedFromId) needIds.add(p.derivedFromId);
        }
        // Them gia cua goi tung don dang co tren lich (de tinh lai
        // tien khi keo doi ngay) + goi goc cua cac goi ke thua do.
        for (const r of resRes.data ?? []) {
          if (!r.rate_plan_id) continue;
          needIds.add(r.rate_plan_id);
          const pl = planObjs.find((x) => x.id === r.rate_plan_id);
          if (pl?.derivedFromId) needIds.add(pl.derivedFromId);
        }
        // Supabase tra toi da 1000 dong/lan — lay theo trang
        let priceRows: { rate_plan_id: string; date: string; price: number }[] = [];
        for (let from = 0; ; from += 1000) {
          const { data: page } = await supabase
            .from("rate_prices")
            .select("rate_plan_id, date, price")
            .in("rate_plan_id", [...needIds])
            .range(from, from + 999);
          priceRows = [...priceRows, ...(page ?? [])];
          if (!page || page.length < 1000) break;
        }
        const overrides: Record<string, number> = {};
        for (const row of priceRows) {
          const pl = planObjs.find((x) => x.id === row.rate_plan_id);
          if (!pl) continue;
          if (pl.derivedFromId) overrides[`${pl.id}|${row.date}`] = row.price;
          else pl.prices[row.date] = row.price;
        }
        const rackMap: Record<string, Record<string, number>> = {};
        const allDates = [...new Set(priceRows.map((r) => r.date))];
        for (const [tid, pl] of chosen) {
          const m: Record<string, number> = {};
          for (const d of allDates) {
            const v = resolvePlanPrice(pl, d, planObjs, overrides);
            if (v != null) m[d] = v;
          }
          rackMap[tid] = m;
        }
        setRack(rackMap);
        setPlanObjs(planObjs);
        setPriceOverrides(overrides);
      }
    })();
  }, []);

  async function addBlock() {
    if (!bfRoom || !bfFrom || !bfTo || bfTo < bfFrom) return;
    // Khong chan duoc phong dang co khach o trong khoang nay.
    const check = validateBlock(reservations, bfRoom, bfFrom, bfTo);
    if (!check.ok) return alert(check.error);
    const nb: RoomBlock = {
      id: `blk-${Date.now()}`,
      roomNumber: bfRoom,
      from: bfFrom,
      to: bfTo,
      kind: bfKind,
      reason: bfReason || (bfKind === "out_of_order" ? "Phòng hỏng" : "Tạm đóng"),
    };
    const { error } = await supabase.from("room_blocks").insert({
      id: nb.id, hotel_id: HOTEL_ID, account_id: ACCOUNT_ID,
      room_number: nb.roomNumber, from_date: nb.from, to_date: nb.to, kind: nb.kind, reason: nb.reason,
    });
    if (error) return alert("Lưu chặn phòng không thành công: " + error.message);
    setBlocks((prev) => [...prev, nb]);
    if (nb.kind === "out_of_order") queueChannexDates(rangeDates(nb.from, nb.to));
    setBfReason("");
    setShowBlockForm(false);
  }

  async function removeBlock(id: string) {
    const blk = blocks.find((b) => b.id === id);
    const { error } = await supabase.from("room_blocks").delete().eq("id", id);
    if (error) return alert("Xoá chặn phòng không thành công: " + error.message);
    setBlocks((prev) => prev.filter((b) => b.id !== id));
    setSelectedBlockId(null);
    if (blk?.kind === "out_of_order") queueChannexDates(rangeDates(blk.from, blk.to));
  }

  const selected = reservations.find((r) => r.id === selectedId) ?? null;
  // Mo popup canh thanh vua bam (lay toa do chuot tu su kien click)
  const openPopup = (id: string, e: { clientX: number; clientY: number }) => {
    setSelectedId(id);
    setPopupAnchor({ x: e.clientX, y: e.clientY });
  };
  const closePopup = () => {
    setSelectedId(null);
    setPopupAnchor(null);
  };
  const unassigned = reservations.filter(
    (r) => r.roomNumbers.length === 0 && !["cancelled", "no_show", "checked_out"].includes(r.status)
  );

  // ---------- Cloudbeds-style click-to-assign ----------
  // Bam vao don chua gan phong -> lich sang len cac o ghep duoc
  // (cung loai phong, trong suot ky o, khong bi chan hong);
  // bam vao o sang la gan phong ngay, khong can keo-tha.
  const [assigningId, setAssigningId] = useState<string | null>(null);
  const assigningBooking = reservations.find((r) => r.id === assigningId) ?? null;
  // Ngay dang loc o panel Assignments (bam cot ngay tren lich de chon;
  // null = hien tat ca). Panel chi hien don chua gan DEN vao ngay do.
  const [assignDate, setAssignDate] = useState<string | null>(null);
  const [assignQuery, setAssignQuery] = useState("");
  // So ghi chu theo don (cham vang tren thanh) + loc loai phong tren
  // lich + dong/mo panel Assignments (kieu Cloudbeds thu duoc panel)
  const [notesCount, setNotesCount] = useState<Record<string, number>>({});
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);
  // Lich mini chon ngay o panel (kieu Cloudbeds): thang dang xem
  // + cac o ngay cua thang do (null = o trong, thu 2 dau tuan)
  const [calOpen, setCalOpen] = useState(false);
  const [calMonth, setCalMonth] = useState<string | null>(null); // YYYY-MM
  // Vi tri popup lich mini (fixed theo viewport de khong bi panel cuon cat)
  const dateBtnRef = useRef<HTMLButtonElement | null>(null);
  const [calAnchor, setCalAnchor] = useState<{ top: number; left: number; width: number } | null>(null);
  const effMonth = calMonth ?? assignDate?.slice(0, 7) ?? days[0].slice(0, 7);
  const calCells = useMemo(() => {
    const [y, m] = effMonth.split("-").map(Number);
    const first = new Date(y, m - 1, 1);
    const offset = (first.getDay() + 6) % 7; // Monday-first
    const daysInMonth = new Date(y, m, 0).getDate();
    const cells: (string | null)[] = Array(offset).fill(null);
    const p = (n: number) => String(n).padStart(2, "0");
    for (let d = 1; d <= daysInMonth; d++) cells.push(`${y}-${p(m)}-${p(d)}`);
    return cells;
  }, [effMonth]);
  // Ngay duoc chon phai luon nam trong cua so lich: neu ngay chon nam
  // ngoai cua so hien tai thi nhay cua so ve bat dau tu ngay do (de cac
  // dem o sau ngay den van nhin thay duoc). Ngay da nam trong cua so hoac
  // xoa loc thi khong nhay.
  useEffect(() => {
    if (!assignDate) return;
    if (assignDate < startDate || assignDate > addDays(startDate, WINDOW - 1)) {
      setStartDate(assignDate);
    }
  }, [assignDate, startDate]);
  const visibleUnassigned = assignDate
    ? unassigned.filter((r) => r.checkIn === assignDate)
    : unassigned;
  // So don chua gan den vao tung ngay (vien so tren dau cot ngay)
  const unassignedByDay = useMemo(() => {
    const m: Record<string, number> = {};
    for (const r of unassigned) m[r.checkIn] = (m[r.checkIn] ?? 0) + 1;
    return m;
  }, [unassigned]);
  // Danh sach hien trong panel: loc theo ngay den + tim kiem + sap theo ngay den
  const panelUnassigned = useMemo(() => {
    const q = assignQuery.trim().toLowerCase();
    const list = q
      ? visibleUnassigned.filter((r) => r.guestName.toLowerCase().includes(q) || r.id.toLowerCase().includes(q))
      : [...visibleUnassigned];
    return list.sort((a, b) => (a.checkIn < b.checkIn ? -1 : a.checkIn > b.checkIn ? 1 : a.guestName.localeCompare(b.guestName)));
  }, [visibleUnassigned, assignQuery]);
  // Nhom don chua gan theo loai phong (kieu panel Cloudbeds)
  const unassignedGroups = useMemo(() => {
    const order: string[] = [];
    for (const r of panelUnassigned) if (!order.includes(r.roomTypeId)) order.push(r.roomTypeId);
    return order.map((tid) => ({ typeId: tid, rows: panelUnassigned.filter((r) => r.roomTypeId === tid) }));
  }, [panelUnassigned]);
  // Phong dang chon de gán (bam o sang tren lich) + vi tri popup nho
  const [pendingRoom, setPendingRoom] = useState<string | null>(null);
  const [spotAnchor, setSpotAnchor] = useState<{ x: number; y: number } | null>(null);
  // Loai phong dang chon trong form gan (mac dinh = loai phong cua don;
  // doi dropdown se loc lai danh sach phong)
  const [assignTypeId, setAssignTypeId] = useState<string | null>(null);

  // Phong nay co nhan duoc don b khong? Dung bo kiem tra dung chung
  // (cung loai phong, khong dinh phong hong, khong trung don khac
  // dang o — don da tra phong thi phong duoc tinh la trong).
  // typeId rieng de form doi loai phong van loc dung.
  const roomFitsForType = (b: Reservation, room: Room, typeId: string) =>
    roomFits(availData, room, typeId, b.checkIn, b.checkOut, b.id).ok;
  // Goi chuan cua 1 kenh + 1 loai phong (goi khong ke thua, uu tien
  // chi phong khong kem an) — dung khi gan don sang loai phong khac.
  const standardPlanFor = (channelCode: string, typeId: string) => {
    const plans = planObjs.filter(
      (p) => p.channelCode === channelCode && p.roomTypeId === typeId && !p.derivedFromId,
    );
    return plans.find((p) => p.mealPlan === "room_only") ?? plans[0];
  };
  // Phong trong sap theo so phong, dung cho dropdown Room #
  const fittingRoomsFor = (b: Reservation, typeId: string) =>
    rooms.filter((rm) => roomFitsForType(b, rm, typeId)).sort((a, z) => a.number.localeCompare(z.number));
  // Loai phong + phong trong hieu luc cho form gan dang mo
  const assignEffType = assigningBooking ? (assignTypeId ?? assigningBooking.roomTypeId) : null;
  const assignFitting = assigningBooking && assignEffType ? fittingRoomsFor(assigningBooking, assignEffType) : [];

  async function assignRoom(roomNumber: string) {
    const res = assigningBooking;
    if (!res) return;
    if (["checked_out", "cancelled", "no_show"].includes(res.status))
      return alert("Không gán phòng cho đơn đã trả phòng / đã huỷ / khách không đến.");
    const effType = assignTypeId ?? res.roomTypeId;
    // Kiem tra dung chung: dung loai phong / khong phong hong / khong trung don khac.
    const check = validateAssign(availData, res, roomNumber, effType);
    if (!check.ok) return alert(check.error);
    const room = rooms.find((rm) => rm.number === roomNumber);
    if (!room) return alert("Không tìm thấy phòng này.");
    // Canh bao (khong chan): phong chua don xong hoac tam dong — de nguoi quyet
    if (["dirty", "in_progress"].includes(room.housekeepingStatus)) {
      if (!confirm(`Phòng ${roomNumber} chưa dọn xong (${HK_LABEL[room.housekeepingStatus] ?? room.housekeepingStatus}). Vẫn gán cho khách?`)) return;
    }
    const oosBlk = stayDates(res.checkIn, res.checkOut).map((d) => roomBlockOn(blocks, roomNumber, d, "out_of_service")).find(Boolean);
    if (oosBlk && !confirm(`Phòng ${roomNumber} đang tạm đóng (${oosBlk.reason}) trong kỳ ở. Vẫn gán cho khách?`)) return;
    // Doi loai phong (kieu Cloudbeds: gan sang loai khac thi don chuyen
    // sang loai do) — tinh lai gia theo goi chuan cua kenh + loai moi,
    // hoi truoc khi ap gia moi.
    let newTotal = res.totalAmount;
    let newPlanId = res.ratePlanId;
    if (effType !== res.roomTypeId) {
      const newPlan = standardPlanFor(res.channelCode, effType);
      if (!newPlan) return alert(`Kênh ${getChannelName(res.channelCode)} chưa có gói giá cho loại phòng này — không gán sang loại khác được.`);
      const bd = priceBreakdown(newPlan, planObjs, res.checkIn, res.checkOut, res.adults ?? res.guests, res.children ?? 0, priceOverrides);
      if (bd.unpriced.length > 0)
        return alert(`Chưa có giá cho đêm ${bd.unpriced.join(", ")} ở loại phòng mới — nhập giá ở Lịch giá rồi gán lại.`);
      if (bd.grandTotal <= 0) return alert("Tổng tiền mới bằng 0 — kiểm tra lại giá loại phòng mới.");
      if (bd.grandTotal !== res.totalAmount && !window.confirm(`Đổi sang loại phòng mới, tổng tiền đổi từ ${fmtPrice(res.totalAmount)} thành ${fmtPrice(bd.grandTotal)}. Áp giá mới?`)) return;
      newTotal = bd.grandTotal;
      newPlanId = newPlan.id;
    }
    const { error } = await supabase
      .from("reservation_rooms")
      .insert({ reservation_id: res.id, room_number: roomNumber });
    if (error) return alert("Gán phòng không thành công: " + error.message);
    if (effType !== res.roomTypeId) {
      await supabase.from("reservations").update({ room_type_id: effType, rate_plan_id: newPlanId, total_amount: newTotal }).eq("id", res.id);
    }
    setReservations((prev) =>
      prev.map((r) =>
        r.id === res.id ? { ...r, roomNumbers: [...r.roomNumbers, roomNumber], roomTypeId: effType, ratePlanId: newPlanId, totalAmount: newTotal } : r
      )
    );
    setAssigningId(null);
    setPendingRoom(null);
    setSpotAnchor(null);
    setAssignTypeId(null);
    // Tu nhay sang don chua gan tiep theo trong panel (lam mot mach)
    const next = panelUnassigned.find((r) => r.id !== res.id);
    if (next) {
      setAssigningId(next.id);
      setAssignTypeId(next.roomTypeId);
      const first = fittingRoomsFor(next, next.roomTypeId).find((rm) => rm.number !== roomNumber);
      setPendingRoom(first ? first.number : null);
    }
    queueChannexDates(stayDates(res.checkIn, res.checkOut));
  }

  // Tu gan het: moi don chua gan nhan phong trong dau tien
  // ghep duoc (tinh tuan tu de 2 don khong gianh nhau 1 phong)
  async function autoAssignAll() {
    const taken = new Map<string, { checkIn: string; checkOut: string }[]>();
    for (const r of reservations) {
      // Don da tra phong thi phong duoc tinh la trong.
      if (["cancelled", "no_show", "checked_out"].includes(r.status)) continue;
      for (const n of r.roomNumbers) {
        const list = taken.get(n) ?? [];
        list.push({ checkIn: r.checkIn, checkOut: r.checkOut });
        taken.set(n, list);
      }
    }
    let done = 0;
    for (const b of panelUnassigned) {
      const room = rooms.find((rm) => {
        if (rm.roomTypeId !== b.roomTypeId) return false;
        // Tu gan chi chon phong sach + khong bi chan (phong ban/tam dong de nguoi quyet tay)
        if (["dirty", "in_progress"].includes(rm.housekeepingStatus)) return false;
        for (let d = b.checkIn; d < b.checkOut; d = addDays(d, 1)) {
          if (roomBlockOn(blocks, rm.number, d, "out_of_order")) return false;
          if (roomBlockOn(blocks, rm.number, d, "out_of_service")) return false;
        }
        return !(taken.get(rm.number) ?? []).some((s) =>
          overlaps(b.checkIn, b.checkOut, s.checkIn, s.checkOut)
        );
      });
      if (!room) continue;
      const { error } = await supabase
        .from("reservation_rooms")
        .insert({ reservation_id: b.id, room_number: room.number });
      if (error) {
        alert(`Gán phòng cho ${b.guestName} không thành công: ${error.message}`);
        continue;
      }
      const list = taken.get(room.number) ?? [];
      list.push({ checkIn: b.checkIn, checkOut: b.checkOut });
      taken.set(room.number, list);
      done += 1;
      setReservations((prev) =>
        prev.map((r) =>
          r.id === b.id ? { ...r, roomNumbers: [...r.roomNumbers, room.number] } : r
        )
      );
      queueChannexDates(stayDates(b.checkIn, b.checkOut));
    }
    if (done === 0) alert("Không có đơn nào gán được (hết phòng trống phù hợp).");
    else if (done < panelUnassigned.length) alert(`Đã tự gán ${done}/${panelUnassigned.length} đơn, còn lại không đủ phòng trống phù hợp.`);
  }

  // ---------- drop logic (kieu Cloudbeds: keo doi phong/ngay) ----------
  async function handleDrop(roomNumber: string, dayIndex: number) {
    if (!dragging) return;
    const res = reservations.find((r) => r.id === dragging.reservationId);
    setDragging(null);
    if (!res) return;

    const shift = dragging.roomNumber === null ? 0 : dayIndex - dragging.visibleStart;
    const newCheckIn = addDays(res.checkIn, shift);
    const newCheckOut = addDays(res.checkOut, shift);

    // Kiem tra dung chung: don con keo duoc / ngay khong qua khu /
    // cung loai phong / khong phong hong / khong trung don khac.
    const check = validateDrop(availData, res, roomNumber, newCheckIn, newCheckOut, todayStr);
    if (!check.ok) return alert(check.error);
    if (check.warnings.length > 0 && !window.confirm(`${check.warnings.join("\n")}\nVẫn chuyển?`)) return;

    // Doi ngay: tinh lai gia theo goi cua don (kieu Cloudbeds hoi
    // "giu gia cu / ap gia moi" — o day hoi truoc khi ap gia moi).
    // Chua co gia cho dem moi thi khong keo duoc.
    let newTotal = res.totalAmount;
    if (newCheckIn !== res.checkIn || newCheckOut !== res.checkOut) {
      const plan = planObjs.find((p) => p.id === res.ratePlanId);
      if (!plan) return alert("Không tìm thấy gói giá của đơn này — không tính được tiền ngày mới.");
      const bd = priceBreakdown(plan, planObjs, newCheckIn, newCheckOut, res.adults ?? res.guests, res.children ?? 0, priceOverrides);
      if (bd.unpriced.length > 0)
        return alert(`Chưa có giá cho đêm ${bd.unpriced.join(", ")} — nhập giá ở Lịch giá rồi kéo lại.`);
      if (bd.grandTotal <= 0) return alert("Tổng tiền mới bằng 0 — kiểm tra lại giá các đêm mới.");
      if (bd.grandTotal !== res.totalAmount && !window.confirm(`Đổi ngày: tổng tiền đổi từ ${fmtPrice(res.totalAmount)} thành ${fmtPrice(bd.grandTotal)}. Áp giá mới?`)) return;
      newTotal = bd.grandTotal;
    }

    const { error: e1 } = await supabase
      .from("reservations")
      .update({ check_in: newCheckIn, check_out: newCheckOut, ...(newTotal !== res.totalAmount ? { total_amount: newTotal } : {}) })
      .eq("id", res.id);
    if (e1) return alert("Lưu thay đổi không thành công: " + e1.message);
    if (dragging.roomNumber === null) {
      const { error: e2 } = await supabase
        .from("reservation_rooms")
        .insert({ reservation_id: res.id, room_number: roomNumber });
      if (e2) return alert("Gán phòng không thành công: " + e2.message);
    } else if (dragging.roomNumber !== roomNumber) {
      const { error: e2 } = await supabase
        .from("reservation_rooms")
        .update({ room_number: roomNumber })
        .eq("reservation_id", res.id)
        .eq("room_number", dragging.roomNumber);
      if (e2) return alert("Đổi phòng không thành công: " + e2.message);
    }

    setReservations((prev) =>
      prev.map((r) => {
        if (r.id !== res.id) return r;
        const roomNumbers =
          dragging.roomNumber === null
            ? [...r.roomNumbers, roomNumber]
            : r.roomNumbers.map((n) => (n === dragging.roomNumber ? roomNumber : n));
        return { ...r, roomNumbers, checkIn: newCheckIn, checkOut: newCheckOut, totalAmount: newTotal };
      })
    );
    queueChannexDates([...stayDates(res.checkIn, res.checkOut), ...stayDates(newCheckIn, newCheckOut)]);
  }

  async function setStatus(id: string, status: Reservation["status"]) {
    const r = reservations.find((x) => x.id === id);
    if (!r) return;
    // Chay qua bo kiem tra dung chung truoc khi doi trang thai
    // (giong trang Dat phong): nhan phong chan khi chua gan phong
    // hoac phong hong; tra phong canh bao khi con no; huy chi don
    // cho / da xac nhan.
    if (status === "in_house") {
      const check = canCheckIn(availData, r);
      if (!check.ok) return alert(check.error);
      if (check.warnings.length > 0 && !window.confirm(`${check.warnings.join("\n")}\nVẫn nhận phòng?`)) return;
    } else if (status === "checked_out") {
      const check = canCheckOut(r);
      if (!check.ok) return alert(check.error);
      if (check.warnings.length > 0 && !window.confirm(check.warnings.join("\n"))) return;
    } else if (status === "cancelled") {
      const check = canCancel(r);
      if (!check.ok) return alert(check.error);
      if (!window.confirm(`Huỷ đơn ${r.id} của ${r.guestName}?`)) return;
    } else if (status === "no_show") {
      if (r.status !== "confirmed") return alert("Chỉ đánh dấu không đến cho đơn đã xác nhận.");
      if (!window.confirm(`Đánh dấu khách không đến cho đơn ${r.id} của ${r.guestName}?`)) return;
    }
    const { error } = await supabase.from("reservations").update({ status }).eq("id", id);
    if (error) return alert("Lưu trạng thái không thành công: " + error.message);
    setReservations((prev) => prev.map((x) => (x.id === id ? { ...x, status } : x)));
    // Huy don thi dong popup + thanh booking bien khoi lich ngay
    if (status === "cancelled") closePopup();
    queueChannexDates(stayDates(r.checkIn, r.checkOut));
  }

  // ---------- derived display data ----------
  const groups = useMemo(() => {
    const order: string[] = [];
    for (const r of rooms) if (!order.includes(r.roomTypeId)) order.push(r.roomTypeId);
    return order.map((tid) => ({
      typeId: tid,
      name: typeName(tid),
      rooms: rooms.filter((r) => r.roomTypeId === tid),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rooms, typeNames]);

  const activeRes = useMemo(
    () => reservations.filter((r) => !["cancelled", "no_show", "checked_out"].includes(r.status)),
    [reservations]
  );

  // rooms left per type per visible day (shared pool logic —
  // same formula as the rates grid and Channex compute)
  const leftByType = useMemo(() => {
    const roomTypeOf = (num: string) => rooms.find((r) => r.number === num)?.roomTypeId;
    const map: Record<string, number[]> = {};
    for (const g of groups) {
      map[g.typeId] = days.map((day) => {
        const sellable = g.rooms.filter(
          (r) => !roomBlockOn(blocks, r.number, day, "out_of_order")
        ).length;
        let used = 0;
        for (const r of activeRes) {
          if (!(r.checkIn <= day && day < r.checkOut)) continue;
          const inType = r.roomNumbers.filter((n) => roomTypeOf(n) === g.typeId).length;
          used += inType > 0 ? inType : r.roomNumbers.length === 0 && r.roomTypeId === g.typeId ? 1 : 0;
        }
        return sellable - used;
      });
    }
    return map;
  }, [groups, days, blocks, activeRes, rooms]);

  // occupancy % per visible day (whole hotel)
  const occByDay = useMemo(
    () =>
      days.map((day) => {
        if (rooms.length === 0) return 0;
        let sold = 0;
        const counted = new Set<string>();
        for (const r of activeRes) {
          if (!(r.checkIn <= day && day < r.checkOut)) continue;
          if (r.roomNumbers.length > 0) {
            for (const n of r.roomNumbers) if (!counted.has(n)) { counted.add(n); sold++; }
          } else sold += 1;
        }
        return Math.min(100, Math.round((sold / rooms.length) * 100));
      }),
    [days, activeRes, rooms]
  );

  const monthRuns = useMemo(() => {
    const runs: { label: string; span: number }[] = [];
    for (const d of days) {
      const dt = new Date(d + "T00:00:00");
      const label = `THÁNG ${dt.getMonth() + 1} ${dt.getFullYear()}`;
      const last = runs[runs.length - 1];
      if (last && last.label === label) last.span++;
      else runs.push({ label, span: 1 });
    }
    return runs;
  }, [days]);

  const fmtPrice = (v?: number) => {
    if (v == null) return "";
    if (currency === "USD") return `$${v.toLocaleString("en-US")}`;
    return `₫${v.toLocaleString("en-US")}`;
  };

  const stickyCell = "sticky left-0 z-20";
  // Nhom hien tren lich (loc theo dropdown All Room Types)
  const gridGroups = typeFilter ? groups.filter((g) => g.typeId === typeFilter) : groups;
  // O ngay kieu Cloudbeds: vien so don chua gan / thu + ngay / % cong suat
  // (dung chung cho dau lich va cuoi lich; keyPrefix tranh trung key)
  const dayHeaderCell = (d: string, i: number, keyPrefix: string) => {
    const dt = new Date(d + "T00:00:00");
    const weekend = dt.getDay() === 0 || dt.getDay() === 6;
    const unCount = unassignedByDay[d] ?? 0;
    return (
      <div
        key={`${keyPrefix}${d}`}
        onClick={() => { setAssignDate(assignDate === d ? null : d); setCalMonth(null); }}
        title={unCount > 0 ? `Xem ${unCount} đơn chưa gán đến ngày ${d}` : "Không có đơn chưa gán đến ngày này"}
        className={`cursor-pointer border-b border-l border-[var(--cb-bg)] px-1 py-1.5 text-center ${d === assignDate ? "bg-[#fef9c3]" : d === todayStr ? "bg-[var(--cb-blue-soft)]" : "bg-[var(--cb-blue-soft)]"}`}
      >
        <div className={`mx-auto w-fit rounded-full px-2 py-0.5 text-[10px] font-bold ${unCount > 0 ? "bg-[var(--cb-blue)] text-white" : "bg-[var(--cb-border)] text-[var(--cb-muted)]"}`}>
          {unCount}
        </div>
        <div className={`text-sm font-bold ${weekend ? "text-[#e5484d]" : d === todayStr ? "text-[var(--cb-blue)]" : "text-[var(--cb-text)]"}`}>
          {WEEKDAYS[dt.getDay()]} {dt.getDate()}
        </div>
        <div className="text-[10px] text-[var(--cb-muted)]">{occByDay[i]}%</div>
      </div>
    );
  };

  // ---------- render ----------
  return (
    <div className="relative">
      {dbError && <p className="mb-3 rounded-lg bg-[#fdecec] px-3 py-2 text-sm text-[#e5484d]">Lỗi cơ sở dữ liệu: {dbError}</p>}

      {/* week navigation kieu Cloudbeds: pill ‹ TODAY › + loc loai phong */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button onClick={() => setStartDate((d) => addDays(d, -7))} className="rounded-full border border-[var(--cb-border)] bg-white px-3 py-1.5 text-sm font-semibold text-[var(--cb-text)]">‹</button>
        <button onClick={() => setStartDate(todayStr)} className="rounded-full border border-[var(--cb-border)] bg-white px-4 py-1.5 text-sm font-bold text-[var(--cb-blue)]">Hôm nay</button>
        <button onClick={() => setStartDate((d) => addDays(d, 7))} className="rounded-full border border-[var(--cb-border)] bg-white px-3 py-1.5 text-sm font-semibold text-[var(--cb-text)]">›</button>
        <select value={typeFilter ?? ""} onChange={(e) => setTypeFilter(e.target.value || null)} className="rounded-full border border-[var(--cb-border)] bg-white px-3 py-1.5 text-sm text-[var(--cb-text)]">
          <option value="">All Room Types</option>
          {groups.map((g) => (
            <option key={g.typeId} value={g.typeId}>{g.name}</option>
          ))}
        </select>
        <span className="ml-1 text-sm text-[var(--cb-muted)]">
          {days[0]} → {days[days.length - 1]} · {WINDOW} ngày
        </span>
      </div>

      {/* Unassigned strip: da chuyen xuong panel Assignments ben trai */}

      {/* assignment-mode banner: da chuyen vao panel Assignments ben trai */}

      {/* popup nho tai o vua bam: ngay o + Assign / Go to Reservation */}
      {assigningBooking && pendingRoom && !selected && spotAnchor && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => { setPendingRoom(null); setSpotAnchor(null); }} />
          <div
            className="fixed z-50 w-[260px] overflow-hidden rounded-xl bg-white shadow-2xl"
            style={{
              left: Math.min(Math.max(spotAnchor.x - 40, 8), Math.max((typeof window !== "undefined" ? window.innerWidth : 1200) - 268, 8)),
              top: spotAnchor.y + 162 > (typeof window !== "undefined" ? window.innerHeight : 800) ? Math.max(spotAnchor.y - 162, 8) : spotAnchor.y + 12,
            }}
          >
            <div className="flex items-center justify-between bg-[#4aa8de] px-3 py-2 text-sm font-semibold text-white">
              <span>{fmtStayDay(assigningBooking.checkIn)} – {fmtStayDay(assigningBooking.checkOut)}</span>
              <button onClick={() => { setPendingRoom(null); setSpotAnchor(null); }} className="rounded-full px-1.5 leading-none hover:bg-white/20">✕</button>
            </div>
            <div className="p-2 text-sm">
              <button onClick={() => assignRoom(pendingRoom)} className="block w-full rounded-lg px-3 py-2 text-left font-medium text-[var(--cb-text)] hover:bg-[var(--cb-blue-soft)]">› Assign</button>
              <button onClick={() => { setSelectedId(assigningBooking.id); setPopupAnchor(spotAnchor); }} className="block w-full rounded-lg px-3 py-2 text-left font-medium text-[var(--cb-text)] hover:bg-[var(--cb-blue-soft)]">› Go to Reservation</button>
            </div>
          </div>
        </>
      )}

      {/* Block-a-room toolbar + form */}
      <div className="mb-4">
        <button onClick={() => setShowBlockForm((v) => !v)} className="cb-btn-ghost px-3 py-2 text-sm">
          ＋ Chặn phòng (sửa chữa / tạm đóng)
        </button>
        {showBlockForm && (
          <div className="cb-card mt-3 flex flex-wrap items-end gap-3 p-4 text-sm text-[var(--cb-text)]">
            <label>
              Phòng
              <select value={bfRoom} onChange={(e) => setBfRoom(e.target.value)} className="ml-2 rounded-lg border border-[var(--cb-border)] px-2 py-2">
                {rooms.map((r) => (
                  <option key={r.number} value={r.number}>{r.number} — {typeName(r.roomTypeId)}</option>
                ))}
              </select>
            </label>
            <div className="flex items-center gap-2">
              <span className="text-sm">Từ đêm → đến đêm (tính cả đêm này)</span>
              <DateRangePicker from={bfFrom} to={bfTo} onChange={(f, t) => { setBfFrom(f); setBfTo(t); }} />
            </div>
            <label>
              Loại chặn
              <select value={bfKind} onChange={(e) => setBfKind(e.target.value as RoomBlock["kind"])} className="ml-2 rounded-lg border border-[var(--cb-border)] px-2 py-2">
                <option value="out_of_order">Phòng hỏng — trừ khỏi phòng bán được</option>
                <option value="out_of_service">Tạm đóng — vẫn tính trong tồn, chỉ đánh dấu</option>
              </select>
            </label>
            <label>
              Lý do
              <input value={bfReason} onChange={(e) => setBfReason(e.target.value)} className="ml-2 rounded-lg border border-[var(--cb-border)] px-2 py-2" placeholder="VD: Sửa điều hoà" />
            </label>
            <button onClick={addBlock} className="cb-btn-primary px-4 py-2 text-sm">Thêm chặn</button>
          </div>
        )}
      </div>

      {/* ===== assignments layout: panel trai + lich ===== */}
      <div className="flex items-start gap-0 border border-[var(--cb-border)] bg-white">
        {/* panel don chua xep phong (co the thu lai) */}
        {panelOpen ? (
        <aside className="sticky top-4 max-h-[calc(100vh-2rem)] w-[280px] shrink-0 overflow-y-auto border-r border-[var(--cb-border)] bg-white p-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="flex items-center gap-1.5 text-sm font-bold text-[var(--cb-text)]">Đơn chưa xếp phòng <span className="rounded-full bg-[var(--cb-blue)] px-1.5 py-0.5 text-[11px] font-bold text-white">{panelUnassigned.length}</span></h3>
            <button onClick={() => setPanelOpen(false)} title="Thu panel" className="shrink-0 rounded-md px-1.5 text-sm font-bold text-[var(--cb-muted)] hover:bg-[var(--cb-bg)]">«</button>
          </div>
          {assignDate && (
            <div className="mt-1 text-right">
              <button onClick={() => { setAssignDate(null); setCalOpen(false); }} className="text-xs font-semibold text-[var(--cb-blue)]">Xem tất cả</button>
            </div>
          )}
          {/* O chon ngay: nut ngay + lich mini popup (fixed de khong bi panel cuon cat) */}
          <div className="mt-2">
            <button
              ref={dateBtnRef}
              onClick={() => {
                if (!calOpen) {
                  const r = dateBtnRef.current?.getBoundingClientRect();
                  if (r) setCalAnchor({ top: r.bottom + 4, left: r.left, width: r.width });
                }
                setCalOpen(!calOpen);
              }}
              className="flex w-full items-center justify-between rounded-lg border border-[var(--cb-border)] bg-white px-3 py-2 text-sm font-medium text-[var(--cb-text)]">
              <span className="flex items-center gap-1.5"><IconCalendar className="h-4 w-4" /> {assignDate ? `${assignDate.slice(8, 10)}/${assignDate.slice(5, 7)}/${assignDate.slice(0, 4)}` : "Tất cả ngày"}</span>
              <span className="text-[var(--cb-muted)]">▾</span>
            </button>
            {calOpen && calAnchor && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setCalOpen(false)} />
                <div className="fixed z-50 rounded-xl border border-[var(--cb-border)] bg-white p-3 shadow-xl" style={{ top: calAnchor.top, left: calAnchor.left, width: calAnchor.width }}>
                  <div className="flex items-center justify-between">
                    <button onClick={() => setCalMonth(addMonths(effMonth, -1))} className="rounded-md px-2 py-1 font-bold text-[var(--cb-muted)] hover:bg-[var(--cb-bg)]">‹</button>
                    <span className="text-sm font-bold text-[var(--cb-text)]">Tháng {Number(effMonth.slice(5, 7))} · {effMonth.slice(0, 4)}</span>
                    <button onClick={() => setCalMonth(addMonths(effMonth, 1))} className="rounded-md px-2 py-1 font-bold text-[var(--cb-muted)] hover:bg-[var(--cb-bg)]">›</button>
                  </div>
                  <div className="mt-2 grid grid-cols-7 gap-1 text-center text-[11px] font-semibold text-[var(--cb-muted)]">
                    {["T2", "T3", "T4", "T5", "T6", "T7", "CN"].map((w) => <div key={w}>{w}</div>)}
                  </div>
                  <div className="mt-1 grid grid-cols-7 gap-1">
                    {calCells.map((c, idx) => c === null ? <div key={`b${idx}`} /> : (
                      <button
                        key={c}
                        onClick={() => { setAssignDate(c); setCalOpen(false); }}
                        className={`rounded-lg py-1.5 text-sm ${c === assignDate ? "bg-[var(--cb-blue)] font-bold text-white" : c === todayStr ? "font-bold text-[var(--cb-blue)] ring-1 ring-[var(--cb-blue)]" : "text-[var(--cb-text)] hover:bg-[var(--cb-bg)]"}`}
                      >
                        {Number(c.slice(8, 10))}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
          <button onClick={autoAssignAll} className="mt-3 w-full rounded-full bg-[#1db584] py-2 text-xs font-bold text-white shadow-sm">
            Tự gán tất cả
          </button>
          <input
            value={assignQuery}
            onChange={(e) => setAssignQuery(e.target.value)}
            placeholder="Tìm tên khách / mã đơn…"
            className="mt-2 w-full rounded-full border border-[var(--cb-border)] px-2 py-1.5 text-sm text-[var(--cb-text)]"
          />


          {/* danh sach don chua gan, nhom theo loai phong */}
          <div className="mt-3 space-y-3">
            {unassignedGroups.length === 0 && (
              <p className="text-sm font-semibold text-[var(--cb-muted)]">Không còn đơn chờ xếp phòng</p>
            )}
            {unassignedGroups.map((g) => (
              <div key={g.typeId}>
                <div className="text-xs font-bold text-[var(--cb-text)]">▾ {typeName(g.typeId)} ({g.rows.length})</div>
                <div className="mt-1 space-y-2">
                  {g.rows.map((r) => (
                    <div key={r.id} className={`overflow-hidden rounded-lg border bg-white ${assigningId === r.id ? "border-[var(--cb-blue)]" : "border-[var(--cb-border)]"}`}>
                      <div
                        draggable
                        onDragStart={() => setDragging({ reservationId: r.id, roomNumber: null, visibleStart: 0 })}
                        onClick={() => {
                          if (assigningId === r.id) {
                            setAssigningId(null); setPendingRoom(null); setSpotAnchor(null); setAssignTypeId(null);
                          } else {
                            setAssigningId(r.id);
                            setAssignTypeId(r.roomTypeId);
                            const first = fittingRoomsFor(r, r.roomTypeId)[0];
                            setPendingRoom(first ? first.number : null);
                            setSpotAnchor(null);
                          }
                        }}
                        title="Bấm để mở form gán phòng (kéo để thả vào phòng)"
                        className={`cursor-pointer px-2 py-1.5 ${assigningId === r.id ? "bg-[var(--cb-blue-soft)]" : "bg-white"}`}
                      >
                        <div className="flex items-center gap-1.5">
                          <span className={`h-2 w-2 shrink-0 rounded-full ${STATUS_STYLES[r.status].split(" ")[0]}`} />
                          <span className="text-xs font-bold text-[var(--cb-text)]">{r.guestName}</span>
                          <span className="text-[11px] text-[var(--cb-muted)]">{r.id}</span>
                        </div>
                        <div className="mt-0.5 text-[11px] text-[var(--cb-muted)]">{r.checkIn.slice(5)} → {r.checkOut.slice(5)} · {diffDays(r.checkIn, r.checkOut)} đêm</div>
                      </div>
                      {/* form gán phòng mở ngay dưới đơn đang chọn */}
                      {assigningId === r.id && assigningBooking && (
                        <div className="border-t border-[var(--cb-border)] bg-[var(--cb-blue-soft)] p-2">
                          <label className="block text-xs text-[var(--cb-muted)]">
                            Loại phòng:
                            <select
                              value={assignEffType ?? ""}
                              onChange={(e) => {
                                const tid = e.target.value;
                                setAssignTypeId(tid);
                                const first = fittingRoomsFor(assigningBooking, tid)[0];
                                setPendingRoom(first ? first.number : null);
                                setSpotAnchor(null);
                              }}
                              className="mt-1 w-full rounded-lg border border-[var(--cb-border)] bg-white px-2 py-1.5 text-sm text-[var(--cb-text)]"
                            >
                              {groups.map((g) => (
                                <option key={g.typeId} value={g.typeId}>{g.name}</option>
                              ))}
                            </select>
                          </label>
                          <label className="mt-2 block text-xs text-[var(--cb-muted)]">
                            Phòng:
                            <select
                              value={pendingRoom ?? ""}
                              onChange={(e) => { setPendingRoom(e.target.value || null); setSpotAnchor(null); }}
                              className="mt-1 w-full rounded-lg border border-[var(--cb-border)] bg-white px-2 py-1.5 text-sm text-[var(--cb-text)]"
                            >
                              {assignFitting.length === 0 && <option value="">Hết phòng trống phù hợp</option>}
                              {assignFitting.map((rm) => (
                                <option key={rm.number} value={rm.number}>{rm.number}</option>
                              ))}
                            </select>
                          </label>
                          {/* Het phong: giai thich tung dem + goi y loai khac con phong ca ky */}
                          {assignFitting.length === 0 && assignEffType && (
                            <div className="mt-2 rounded-lg bg-white/70 p-2 text-xs text-[var(--cb-muted)]">
                              <div className="font-semibold text-[var(--cb-text)]">Không có phòng nào trống cả kỳ ở:</div>
                              {stayDates(assigningBooking.checkIn, assigningBooking.checkOut).map((d) => {
                                const free = rooms.filter((rm) =>
                                  rm.roomTypeId === assignEffType &&
                                  !roomBlockOn(blocks, rm.number, d, "out_of_order") &&
                                  !reservations.some((o) => o.id !== assigningBooking.id && !["cancelled", "no_show", "checked_out"].includes(o.status) && o.roomNumbers.includes(rm.number) && o.checkIn <= d && d < o.checkOut)
                                );
                                return <div key={d}>Đêm {d.slice(5)} còn: {free.length > 0 ? free.map((rm) => rm.number).join(", ") : "hết"}</div>;
                              })}
                              {groups.filter((g) => g.typeId !== assignEffType).map((g) => {
                                const fit = fittingRoomsFor(assigningBooking, g.typeId);
                                if (fit.length === 0) return null;
                                return (
                                  <button
                                    key={g.typeId}
                                    onClick={() => { setAssignTypeId(g.typeId); setPendingRoom(fit[0].number); setSpotAnchor(null); }}
                                    className="mt-1 block font-semibold text-[var(--cb-blue)]"
                                  >
                                    → Chuyển sang {g.name}: còn phòng {fit.map((rm) => rm.number).join(", ")}
                                  </button>
                                );
                              })}
                            </div>
                          )}
                          <div className="mt-2 space-y-2">
                            <button
                              disabled={!pendingRoom}
                              onClick={() => pendingRoom && assignRoom(pendingRoom)}
                              className="w-full rounded-full bg-[var(--cb-blue)] py-2 text-sm font-bold text-white disabled:opacity-40"
                            >
                              ASSIGN
                            </button>
                            <button onClick={() => { setAssigningId(null); setPendingRoom(null); setSpotAnchor(null); setAssignTypeId(null); }} className="w-full rounded-full bg-[var(--cb-bg)] py-2 text-sm font-semibold text-[var(--cb-text)]">CANCEL</button>
                          </div>
                          <p className="mt-2 text-xs text-[var(--cb-muted)]">Hoặc bấm ô sáng trên lịch để chọn phòng.</p>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </aside>
        ) : (
          <button onClick={() => setPanelOpen(true)} title="Mở panel đơn chưa xếp phòng" className="sticky top-4 shrink-0 rounded-xl border border-[var(--cb-border)] bg-white px-2 py-3 text-sm font-bold text-[var(--cb-blue)] shadow-[0_1px_3px_rgba(16,28,66,0.06)]">»</button>
        )}

        {/* lich (phan con lai) */}
        <div className="min-w-0 flex-1">
      {/* ===== tape chart (Cloudbeds style) ===== */}
      <div className="overflow-x-auto bg-white">
        <div
          className="grid"
          style={{
            gridTemplateColumns: `170px repeat(${days.length}, minmax(64px, 1fr))`,
            minWidth: `${170 + days.length * 64}px`,
          }}
        >
          {/* month band */}
          <div className={`${stickyCell} border-b border-[var(--cb-bg)] bg-[var(--cb-bg)] px-3 py-1.5 text-[11px] font-semibold text-[var(--cb-muted)]`}>
            Phòng ↓ · Ngày →
          </div>
          {monthRuns.map((m, i) => (
            <div
              key={i}
              className="border-b border-l border-[var(--cb-bg)] bg-[var(--cb-bg)] px-2 py-1.5 text-[11px] font-bold tracking-wide text-[var(--cb-text)]"
              style={{ gridColumn: `span ${m.span}` }}
            >
              {m.label}
            </div>
          ))}

          {/* day header kieu Cloudbeds: vien so + thu/ngay + % */}
          <div className="sticky left-0 z-20 border-b border-[var(--cb-bg)] bg-[var(--cb-blue-soft)] px-3 py-2 text-xs font-semibold text-[var(--cb-muted)]">Phòng</div>
          {days.map((d, i) => dayHeaderCell(d, i, "t-"))}

          {/* one section per room type */}
          {gridGroups.map((g) => (
            <div key={g.typeId} className="contents">
              {/* section summary row: rooms left + rack price per day */}
              <div className="sticky left-0 z-20 flex items-center justify-between border-b border-[var(--cb-bg)] bg-[#eef4fb] px-3 py-1.5">
                <span className="text-xs font-bold text-[var(--cb-text)]">▾ {g.name}</span>
                <span className="text-[10px] text-[var(--cb-muted)]">{g.rooms.length} phòng</span>
              </div>
              {days.map((d, i) => {
                const left = leftByType[g.typeId]?.[i] ?? 0;
                return (
                  <div key={d} className={`border-b border-l border-[var(--cb-bg)] px-1 py-1 text-center leading-tight ${d === assignDate ? "bg-[#fef9c3]" : "bg-[#eef4fb]"}`}>
                    <div className={`text-xs font-bold ${left <= 0 ? "text-[#e5484d]" : left === 1 ? "text-[#b45309]" : "text-[var(--cb-text)]"}`}>
                      {left}
                    </div>
                    <div className="text-[10px] text-[var(--cb-muted)]">{fmtPrice(rack[g.typeId]?.[d])}</div>
                  </div>
                );
              })}

              {/* physical room rows */}
              {g.rooms.map((room) => (
                <div key={room.number} className="contents">
                  <div className="sticky left-0 z-10 flex items-center gap-2 border-b border-[var(--cb-bg)] bg-white px-3 py-1">
                    <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${HK_DOT[room.housekeepingStatus]}`} title={HK_LABEL[room.housekeepingStatus]} />
                    <div className="text-sm font-semibold text-[var(--cb-text)]">{room.number}</div>
                  </div>

                  {days.map((day, dayIndex) => (
                    <div
                      key={day}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={() => handleDrop(room.number, dayIndex)}
                      onClick={(e) => {
                        if (
                          assigningBooking &&
                          day >= assigningBooking.checkIn &&
                          day < assigningBooking.checkOut &&
                          roomFitsForType(assigningBooking, room, assignEffType ?? assigningBooking.roomTypeId)
                        ) {
                          setPendingRoom(room.number);
                          setSpotAnchor({ x: e.clientX, y: e.clientY });
                        }
                      }}
                      className={`relative min-h-[34px] border-b border-l border-[var(--cb-bg)] ${
                        assigningBooking &&
                        day >= assigningBooking.checkIn &&
                        day < assigningBooking.checkOut &&
                        roomFitsForType(assigningBooking, room, assignEffType ?? assigningBooking.roomTypeId)
                          ? "cursor-pointer bg-[var(--cb-blue-soft)] ring-1 ring-inset ring-[var(--cb-blue)]"
                          : day === assignDate
                            ? "bg-[#fffde7]"
                            : day === todayStr
                              ? "bg-[var(--cb-blue-soft)]"
                              : ""
                      }`}
                    >
                      {blocks
                        .filter((b) => b.roomNumber === room.number)
                        .map((b) => {
                          const startIdx = diffDays(startDate, b.from);
                          const endIdx = diffDays(startDate, b.to) + 1;
                          const visibleStart = Math.max(0, startIdx);
                          const visibleEnd = Math.min(days.length, endIdx);
                          if (visibleStart !== dayIndex || visibleEnd <= visibleStart) return null;
                          // Cloudbeds style: block runs from the middle of
                          // its first day cell to the middle of the cell
                          // after its last night
                          const startsMid = startIdx >= 0;
                          const endsMid = endIdx < days.length;
                          const spanCells =
                            visibleEnd - visibleStart - (startsMid ? 0.5 : 0) + (endsMid ? 0.5 : 0);
                          return (
                            <div
                              key={b.id}
                              onClick={(e) => { e.stopPropagation(); setSelectedBlockId(b.id); }}
                              title={`${b.kind === "out_of_order" ? "Phòng hỏng" : "Tạm đóng"} · ${b.from} → ${b.to} · ${b.reason} (bấm để xem / xoá)`}
                              className={`absolute inset-y-1 z-[5] flex cursor-pointer items-center overflow-hidden whitespace-nowrap px-3 text-[11px] font-medium text-white ${b.kind === "out_of_order" ? "bg-[var(--cb-muted)]" : "bg-[var(--cb-muted)]"}`}
                              style={{
                                left: startsMid ? "calc(50% + 1px)" : "2px",
                                width: `calc(${spanCells * 100}% - ${startsMid ? 3 : 4}px)`,
                                clipPath: "polygon(8px 0, 100% 0, calc(100% - 8px) 100%, 0 100%)",
                              }}
                            >
                              {b.kind === "out_of_order" ? <IconBan className="h-4 w-4" /> : <IconDroplet className="h-4 w-4" />} {b.reason}
                            </div>
                          );
                        })}
                      {/* Don da huy khong ve len lich */}
                      {reservations
                        .filter((r) => r.roomNumbers.includes(room.number) && r.status !== "cancelled")
                        .map((r) => {
                          const startIdx = diffDays(startDate, r.checkIn);
                          const endIdx = diffDays(startDate, r.checkOut);
                          const visibleStart = Math.max(0, startIdx);
                          const visibleEnd = Math.min(days.length, endIdx);
                          if (visibleStart !== dayIndex || visibleEnd <= visibleStart) return null;
                          // Cloudbeds style: from the middle of the
                          // check-in cell to the middle of the
                          // check-out cell
                          const startsMid = startIdx >= 0;
                          const endsMid = endIdx < days.length;
                          const spanCells =
                            visibleEnd - visibleStart - (startsMid ? 0.5 : 0) + (endsMid ? 0.5 : 0);
                          return (
                            <ReservationBar
                              key={r.id + room.number}
                              reservation={r}
                              span={spanCells}
                              startHalf={startsMid}
                              hasNotes={!!r.note || (notesCount[r.id] ?? 0) > 0}
                              draggable={!["checked_out", "no_show"].includes(r.status)}
                              onDragStart={() =>
                                setDragging({ reservationId: r.id, roomNumber: room.number, visibleStart })
                              }
                              onClick={(e) => openPopup(r.id, e)}
                            />
                          );
                        })}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          ))}

          {/* day header lap lai o cuoi lich (kieu Cloudbeds) */}
          <div className="sticky left-0 z-20 border-b border-[var(--cb-bg)] bg-[var(--cb-blue-soft)] px-3 py-2 text-xs font-semibold text-[var(--cb-muted)]">Phòng</div>
          {days.map((d, i) => dayHeaderCell(d, i, "b-"))}
        </div>
      </div>
        </div>
      </div>

      {/* Legend kieu Cloudbeds */}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-[var(--cb-muted)]">
        <span className="font-bold text-[var(--cb-text)]">Legend</span>
        {(["in_house", "confirmed", "pending", "checked_out"] as const).map((s) => (
          <span key={s} className="flex items-center gap-1.5">
            <span className={`inline-block h-3 w-3 rounded-sm ${STATUS_STYLES[s].split(" ")[0]}`} />
            {STATUS_LABELS[s]}
          </span>
        ))}
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded-sm bg-[var(--cb-muted)]" />
          Phòng bị chặn
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-full bg-[#e5484d]" />
          Còn nợ tiền
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-full bg-[#facc15]" />
          Có ghi chú
        </span>
        <span>Kéo thanh khách để đổi phòng/ngày. Bấm thanh khách để mở hồ sơ.</span>
      </div>

      {/* selected room-block panel */}
      {selectedBlock && (
        <div className="cb-card mt-3 flex flex-wrap items-center gap-3 p-4 text-sm text-[var(--cb-text)]">
          <span className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-bold text-white ${selectedBlock.kind === "out_of_order" ? "bg-[var(--cb-muted)]" : "bg-[var(--cb-muted)]"}`}>
            {selectedBlock.kind === "out_of_order" ? (<><IconBan className="h-3.5 w-3.5" /> PHÒNG HỎNG</>) : (<><IconDroplet className="h-3.5 w-3.5" /> TẠM ĐÓNG</>)}
          </span>
          <span className="font-semibold">Phòng {selectedBlock.roomNumber}</span>
          <span>{selectedBlock.from} → {selectedBlock.to} (đến đêm {selectedBlock.to})</span>
          <span className="text-[var(--cb-muted)]">{selectedBlock.reason}</span>
          <span className="ml-auto flex gap-2">
            <button onClick={() => removeBlock(selectedBlock.id)} className="rounded-lg border border-[#e5484d] px-3 py-1.5 text-sm font-semibold text-[#e5484d] hover:bg-red-50">
              Xoá chặn (mở phòng lại)
            </button>
            <button onClick={() => setSelectedBlockId(null)} className="cb-btn-ghost px-3 py-1.5 text-sm">Đóng</button>
          </span>
        </div>
      )}

      {/* ---------- booking popup (kieu Cloudbeds) ---------- */}
      {selected && (
        <BookingPopup
          reservation={selected}
          currency={currency}
          hotelId={HOTEL_ID}
          accountId={ACCOUNT_ID}
          anchor={popupAnchor}
          onClose={closePopup}
          onSetStatus={setStatus}
          onEnterAssignMode={(id) => {
            const b = reservations.find((r) => r.id === id);
            closePopup();
            setAssigningId(id);
            if (b) {
              setAssignTypeId(b.roomTypeId);
              const first = fittingRoomsFor(b, b.roomTypeId)[0];
              setPendingRoom(first ? first.number : null);
            }
            setSpotAnchor(null);
          }}
        />
      )}
    </div>
  );
}
