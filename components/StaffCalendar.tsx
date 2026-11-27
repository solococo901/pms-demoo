"use client";
// CALTIDY23 — components/StaffCalendar.tsx (Lich phong, y het Cloudbeds)
// BLOCKEDIT1 — sua/noi dai lan chan cu tai cho (form dung chung tao + sua).
// BLOCKVIS1 — form chan phong cuon vao tam nhin + hieu ung hien ro khi mo.
// Ghi log (AUDIT): doi trang thai don (huy/nhan/tra/khong den) + chan/mo lai phong thi ghi vao audit_logs.

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
import { markRoomsDirtyAfterCheckout } from "@/lib/checkout-housekeeping";
import { writeAuditLog } from "@/lib/audit-log";
import { useParams } from "next/navigation";
import { queueChannexDates, rangeDates, stayDates } from "@/lib/channex-outbox";
import ReservationBar, { STATUS_STYLES, STATUS_LABELS } from "./ReservationBar";
import { DatePicker, DateRangePicker } from "@/components/DatePicker";
import { IconBan, IconCalendar, IconDroplet, IconMenu, IconPlus, IconSearch } from "@/components/icons";
import BookingPopup from "./BookingPopup";
import { useToast } from "@/components/Toast";

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
  clean: "bg-success",
  dirty: "bg-danger",
  in_progress: "bg-warning",
  out_of_order: "bg-muted",
};
const HK_LABEL: Record<string, string> = {
  clean: "Đã dọn",
  dirty: "Cần dọn",
  in_progress: "Đang dọn",
  out_of_order: "Đang sửa",
};

// Ten ngan kenh de hien trong o Ngung ban (o lich chi rong ~64px).
const CH_SHORT: Record<string, string> = { website: "Web", frontdesk: "Lễ tân", booking_com: "B.com", expedia: "Expedia", airbnb: "Airbnb", agoda: "Agoda" };

/** what is being dragged right now */
type DragItem = { reservationId: string; roomNumber: string | null; visibleStart: number };

export default function StaffCalendar() {
  // Khach san lay tu URL /h/[hotelId] khi co; neu khong (duong dan cu)
  // thi dung khach san da luu theo tab.
  const params = useParams();
  const { showToast } = useToast();
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
  // Lan chan dang sua (null = dang tao moi).
  const [editingBlock, setEditingBlock] = useState<RoomBlock | null>(null);
  // Ref toi form chan phong (de cuon toi khi mo ra).
  const blockFormRef = useRef<HTMLDivElement>(null);

  const selectedBlock = blocks.find((b) => b.id === selectedBlockId) ?? null;
  const typeName = (tid: string) => typeNames[tid] ?? getRoomTypeName(tid);

  // Khi form chan phong mo ra (tao moi hay sua), cuon toi cho no
  // de nguoi dung thay ngay no vua xuat hien (form nam tren dau
  // trang, con nut Sua thi o duoi lich — khong cuon thi khong thay).
  useEffect(() => {
    if (showBlockForm) {
      blockFormRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [showBlockForm, editingBlock]);

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

  // Mo form chan phong o che do tao moi.
  function openNewBlock() {
    setEditingBlock(null);
    setBfRoom("");
    setBfFrom(TODAY);
    setBfTo(TODAY);
    setBfKind("out_of_order");
    setBfReason("");
    setShowBlockForm(true);
  }

  // Mo form chan phong o che do sua lan co san.
  function openEditBlock(b: RoomBlock) {
    setEditingBlock(b);
    setBfRoom(b.roomNumber);
    setBfFrom(b.from);
    setBfTo(b.to);
    setBfKind(b.kind);
    setBfReason(b.reason);
    setSelectedBlockId(null);
    setShowBlockForm(true);
  }

  // Luu lan chan: tao moi, hoac cap nhat lan dang sua.
  async function saveBlock() {
    if (!bfRoom || !bfFrom || !bfTo || bfTo < bfFrom) return;
    // Khong chan duoc phong dang co khach o trong khoang nay,
    // va khong chan trung len lan chan da co cua phong.
    // Khi sua, loai chinh lan dang sua ra khoi danh sach kiem tra
    // (neu khong no se luon "trung voi chinh no").
    const others = editingBlock ? blocks.filter((b) => b.id !== editingBlock.id) : blocks;
    const check = validateBlock(reservations, bfRoom, bfFrom, bfTo, others);
    if (!check.ok) { showToast(check.error ?? "Có lỗi xảy ra.", "error"); return; }
    const reason = bfReason || (bfKind === "out_of_order" ? "Phòng hỏng" : "Tạm đóng");
    const dShort = (d: string) => d.split("-").reverse().join("/");
    if (editingBlock) {
      const { error } = await supabase.from("room_blocks").update({
        room_number: bfRoom, from_date: bfFrom, to_date: bfTo, kind: bfKind, reason,
      }).eq("id", editingBlock.id);
      if (error) { showToast("Lưu chặn phòng không thành công: " + error.message, "error"); return; }
      const updated: RoomBlock = { ...editingBlock, roomNumber: bfRoom, from: bfFrom, to: bfTo, kind: bfKind, reason };
      setBlocks((prev) => prev.map((b) => (b.id === editingBlock.id ? updated : b)));
      writeAuditLog({
        hotelId: HOTEL_ID,
        accountId: ACCOUNT_ID,
        action: "room_blocked",
        entityType: "room_block",
        entityId: editingBlock.id,
        summary: `Sửa chặn phòng ${bfRoom} · ${dShort(bfFrom)} → ${dShort(bfTo)} (${bfKind === "out_of_order" ? "Phòng hỏng" : "Tạm đóng"}: ${reason})`,
        details: { blockId: editingBlock.id, roomNumber: bfRoom, from: bfFrom, to: bfTo, kind: bfKind, reason, oldFrom: editingBlock.from, oldTo: editingBlock.to, oldKind: editingBlock.kind, oldRoomNumber: editingBlock.roomNumber },
      });
      // Day Channex tinh lai ton cho ca khoang cu + moi
      // (neu 1 trong 2 loai la Phong hong).
      if (editingBlock.kind === "out_of_order" || bfKind === "out_of_order") {
        const from = editingBlock.from < bfFrom ? editingBlock.from : bfFrom;
        const to = editingBlock.to > bfTo ? editingBlock.to : bfTo;
        queueChannexDates(rangeDates(from, to));
      }
      showToast(`Đã sửa chặn phòng ${bfRoom} · ${dShort(bfFrom)} → ${dShort(bfTo)}.`, "success");
      setEditingBlock(null);
    } else {
      const nb: RoomBlock = {
        id: `blk-${Date.now()}`,
        roomNumber: bfRoom,
        from: bfFrom,
        to: bfTo,
        kind: bfKind,
        reason,
      };
      const { error } = await supabase.from("room_blocks").insert({
        id: nb.id, hotel_id: HOTEL_ID, account_id: ACCOUNT_ID,
        room_number: nb.roomNumber, from_date: nb.from, to_date: nb.to, kind: nb.kind, reason: nb.reason,
      });
      if (error) { showToast("Lưu chặn phòng không thành công: " + error.message, "error"); return; }
      setBlocks((prev) => [...prev, nb]);
      writeAuditLog({
        hotelId: HOTEL_ID,
        accountId: ACCOUNT_ID,
        action: "room_blocked",
        entityType: "room_block",
        entityId: nb.id,
        summary: `Chặn phòng ${nb.roomNumber} · ${dShort(nb.from)} → ${dShort(nb.to)} (${nb.kind === "out_of_order" ? "Phòng hỏng" : "Tạm đóng"}: ${nb.reason})`,
        details: { blockId: nb.id, roomNumber: nb.roomNumber, from: nb.from, to: nb.to, kind: nb.kind, reason: nb.reason },
      });
      if (nb.kind === "out_of_order") queueChannexDates(rangeDates(nb.from, nb.to));
      showToast(`Đã chặn phòng ${nb.roomNumber} · ${dShort(nb.from)} → ${dShort(nb.to)}.`, "success");
    }
    setBfReason("");
    setShowBlockForm(false);
  }

  async function removeBlock(id: string) {
    const blk = blocks.find((b) => b.id === id);
    const { error } = await supabase.from("room_blocks").delete().eq("id", id);
    if (error) { showToast("Xoá chặn phòng không thành công: " + error.message, "error"); return; }
    setBlocks((prev) => prev.filter((b) => b.id !== id));
    setSelectedBlockId(null);
    // Ghi log mo lai phong (AUDIT).
    if (blk) {
      const dShort = (d: string) => d.split("-").reverse().join("/");
      writeAuditLog({
        hotelId: HOTEL_ID,
        accountId: ACCOUNT_ID,
        action: "room_unblocked",
        entityType: "room_block",
        entityId: id,
        summary: `Mở lại phòng ${blk.roomNumber} · ${dShort(blk.from)} → ${dShort(blk.to)} (${blk.reason})`,
        details: { blockId: id, roomNumber: blk.roomNumber, from: blk.from, to: blk.to, kind: blk.kind, reason: blk.reason },
      });
    }
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
  // So ghi chu theo don (cham vang tren thanh) + loc loai phong tren
  // lich + dong/mo panel Assignments (kieu Cloudbeds thu duoc panel)
  const [notesCount, setNotesCount] = useState<Record<string, number>>({});
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [collapsedTypes, setCollapsedTypes] = useState<Record<string, boolean>>({});
  const [jumpOpen, setJumpOpen] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
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
  // Danh sach hien trong panel: loc theo ngay den + sap theo ngay den
  const panelUnassigned = useMemo(() => {
    return [...visibleUnassigned].sort((a, b) => (a.checkIn < b.checkIn ? -1 : a.checkIn > b.checkIn ? 1 : a.guestName.localeCompare(b.guestName)));
  }, [visibleUnassigned]);
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
    if (["checked_out", "cancelled", "no_show"].includes(res.status)) {
      showToast("Không gán phòng cho đơn đã trả phòng / đã huỷ / khách không đến.", "error");
      return;
    }
    const effType = assignTypeId ?? res.roomTypeId;
    // Kiem tra dung chung: dung loai phong / khong phong hong / khong trung don khac.
    const check = validateAssign(availData, res, roomNumber, effType);
    if (!check.ok) { showToast(check.error ?? "Có lỗi xảy ra.", "error"); return; }
    const room = rooms.find((rm) => rm.number === roomNumber);
    if (!room) { showToast("Không tìm thấy phòng này.", "error"); return; }
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
      if (!newPlan) { showToast(`Kênh ${getChannelName(res.channelCode)} chưa có gói giá cho loại phòng này — không gán sang loại khác được.`, "error"); return; }
      const bd = priceBreakdown(newPlan, planObjs, res.checkIn, res.checkOut, res.adults ?? res.guests, res.children ?? 0, priceOverrides);
      if (bd.unpriced.length > 0) {
        showToast(`Chưa có giá cho đêm ${bd.unpriced.join(", ")} ở loại phòng mới — nhập giá ở Lịch giá rồi gán lại.`, "error");
        return;
      }
      if (bd.grandTotal <= 0) { showToast("Tổng tiền mới bằng 0 — kiểm tra lại giá loại phòng mới.", "error"); return; }
      if (bd.grandTotal !== res.totalAmount && !window.confirm(`Đổi sang loại phòng mới, tổng tiền đổi từ ${fmtPrice(res.totalAmount)} thành ${fmtPrice(bd.grandTotal)}. Áp giá mới?`)) return;
      newTotal = bd.grandTotal;
      newPlanId = newPlan.id;
    }
    const { error } = await supabase
      .from("reservation_rooms")
      .insert({ reservation_id: res.id, room_number: roomNumber });
    if (error) { showToast("Gán phòng không thành công: " + error.message, "error"); return; }
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
        showToast(`Gán phòng cho ${b.guestName} không thành công: ${error.message}`, "error");
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
    if (done === 0) showToast("Không có đơn nào gán được (hết phòng trống phù hợp).", "error");
    else if (done < panelUnassigned.length) showToast(`Đã tự gán ${done}/${panelUnassigned.length} đơn, còn lại không đủ phòng trống phù hợp.`, "error");
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
    if (!check.ok) { showToast(check.error ?? "Có lỗi xảy ra.", "error"); return; }
    if (check.warnings.length > 0 && !window.confirm(`${check.warnings.join("\n")}\nVẫn chuyển?`)) return;

    // Doi ngay: tinh lai gia theo goi cua don (kieu Cloudbeds hoi
    // "giu gia cu / ap gia moi" — o day hoi truoc khi ap gia moi).
    // Chua co gia cho dem moi thi khong keo duoc.
    let newTotal = res.totalAmount;
    if (newCheckIn !== res.checkIn || newCheckOut !== res.checkOut) {
      const plan = planObjs.find((p) => p.id === res.ratePlanId);
      if (!plan) { showToast("Không tìm thấy gói giá của đơn này — không tính được tiền ngày mới.", "error"); return; }
      const bd = priceBreakdown(plan, planObjs, newCheckIn, newCheckOut, res.adults ?? res.guests, res.children ?? 0, priceOverrides);
      if (bd.unpriced.length > 0) {
        showToast(`Chưa có giá cho đêm ${bd.unpriced.join(", ")} — nhập giá ở Lịch giá rồi kéo lại.`, "error");
        return;
      }
      if (bd.grandTotal <= 0) { showToast("Tổng tiền mới bằng 0 — kiểm tra lại giá các đêm mới.", "error"); return; }
      if (bd.grandTotal !== res.totalAmount && !window.confirm(`Đổi ngày: tổng tiền đổi từ ${fmtPrice(res.totalAmount)} thành ${fmtPrice(bd.grandTotal)}. Áp giá mới?`)) return;
      newTotal = bd.grandTotal;
    }

    const { error: e1 } = await supabase
      .from("reservations")
      .update({ check_in: newCheckIn, check_out: newCheckOut, ...(newTotal !== res.totalAmount ? { total_amount: newTotal } : {}) })
      .eq("id", res.id);
    if (e1) { showToast("Lưu thay đổi không thành công: " + e1.message, "error"); return; }
    if (dragging.roomNumber === null) {
      const { error: e2 } = await supabase
        .from("reservation_rooms")
        .insert({ reservation_id: res.id, room_number: roomNumber });
      if (e2) { showToast("Gán phòng không thành công: " + e2.message, "error"); return; }
    } else if (dragging.roomNumber !== roomNumber) {
      const { error: e2 } = await supabase
        .from("reservation_rooms")
        .update({ room_number: roomNumber })
        .eq("reservation_id", res.id)
        .eq("room_number", dragging.roomNumber);
      if (e2) { showToast("Đổi phòng không thành công: " + e2.message, "error"); return; }
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
      if (!check.ok) { showToast(check.error ?? "Có lỗi xảy ra.", "error"); return; }
      if (check.warnings.length > 0 && !window.confirm(`${check.warnings.join("\n")}\nVẫn nhận phòng?`)) return;
    } else if (status === "checked_out") {
      const check = canCheckOut(r);
      if (!check.ok) { showToast(check.error ?? "Có lỗi xảy ra.", "error"); return; }
      if (check.warnings.length > 0 && !window.confirm(check.warnings.join("\n"))) return;
    } else if (status === "cancelled") {
      const check = canCancel(r);
      if (!check.ok) { showToast(check.error ?? "Có lỗi xảy ra.", "error"); return; }
      if (!window.confirm(`Huỷ đơn ${r.id} của ${r.guestName}?`)) return;
    } else if (status === "no_show") {
      if (r.status !== "confirmed") { showToast("Chỉ đánh dấu không đến cho đơn đã xác nhận.", "error"); return; }
      if (!window.confirm(`Đánh dấu khách không đến cho đơn ${r.id} của ${r.guestName}?`)) return;
    }
    const { error } = await supabase.from("reservations").update({ status }).eq("id", id);
    if (error) { showToast("Lưu trạng thái không thành công: " + error.message, "error"); return; }
    setReservations((prev) => prev.map((x) => (x.id === id ? { ...x, status } : x)));
    // Ghi log doi trang thai don (AUDIT): huy / nhan / tra phong / khong den.
    const logAction = status === "cancelled" ? "booking_cancelled" : status === "in_house" ? "booking_checked_in" : status === "checked_out" ? "booking_checked_out" : "booking_updated";
    const logLabel = status === "cancelled" ? "Huỷ đơn" : status === "in_house" ? "Nhận phòng" : status === "checked_out" ? "Trả phòng" : status === "no_show" ? "Đánh dấu không đến" : "Đổi trạng thái";
    const dShort = (d: string) => d.split("-").reverse().join("/");
    writeAuditLog({
      hotelId: HOTEL_ID,
      accountId: ACCOUNT_ID,
      action: logAction,
      entityType: "reservation",
      entityId: id,
      summary: `${logLabel} ${r.guestName} · ${dShort(r.checkIn)} → ${dShort(r.checkOut)}${r.roomNumbers.length > 0 ? ` · phòng ${r.roomNumbers.join(", ")}` : ""}`,
      details: { reservationId: id, guestName: r.guestName, checkIn: r.checkIn, checkOut: r.checkOut, roomNumbers: r.roomNumbers, oldStatus: r.status, newStatus: status, totalAmount: r.totalAmount },
    });
    // Huy don thi dong popup + thanh booking bien khoi lich ngay
    if (status === "cancelled") closePopup();
    queueChannexDates(stayDates(r.checkIn, r.checkOut));
    // Tra phong xong: phong dang Sach tu chuyen Chua don (helper khong bao gio lam hong viec tra phong).
    if (status === "checked_out") void markRoomsDirtyAfterCheckout(HOTEL_ID, r.roomNumbers);
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

  // Dong ban theo loai phong + ngay (tu inventory_blocks) — chi de HIEN tren luoi,
  // khong doi cach tinh phong trong (le tan van ban truc tiep duoc).
  const stopSellByType = useMemo(() => {
    const map: Record<string, Record<string, InventoryBlock[]>> = {};
    for (const g of groups) {
      for (const d of days) {
        const bl = invBlocks.filter((b) => b.roomTypeId === g.typeId && b.from <= d && d <= b.to);
        if (bl.length > 0) {
          if (!map[g.typeId]) map[g.typeId] = {};
          map[g.typeId][d] = bl;
        }
      }
    }
    return map;
  }, [groups, days, invBlocks]);

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

  // Nhom hien tren lich (loc theo dropdown All Room Types)
  const gridGroups = typeFilter ? groups.filter((g) => g.typeId === typeFilter) : groups;
  // O ngay kieu Cloudbeds: vien so don chua gan / thu + ngay / % cong suat
  // (dung chung cho dau lich va cuoi lich; keyPrefix tranh trung key)
  const dayHeaderCell = (d: string, i: number, keyPrefix: string) => {
    const dt = new Date(d + "T00:00:00");
    const unCount = unassignedByDay[d] ?? 0;
    return (
      <div
        key={`${keyPrefix}${d}`}
        onClick={() => {
          const next = assignDate === d ? null : d;
          setAssignDate(next);
          setCalMonth(null);
          if (next) setPanelOpen(true);
        }}
        title={unCount > 0 ? `Xem ${unCount} đơn chưa gán đến ngày ${d}` : "Không có đơn chưa gán đến ngày này"}
        className={`flex h-18 cursor-pointer flex-col items-center justify-center border-b border-l border-[var(--nui-bg)] px-1 text-center ${d === assignDate ? "bg-warning-soft" : d === todayStr ? "bg-success-soft" : "bg-surface"}`}
      >
        <div className={`mx-auto w-fit rounded-full px-2 py-0.5 text-[10px] font-bold ${unCount > 0 ? "bg-primary text-white" : "bg-line text-muted"}`}>
          {unCount}
        </div>
        <div className="text-sm font-bold text-ink">
          {WEEKDAYS[dt.getDay()]} {dt.getDate()}
        </div>
        <div className="text-[10px] text-muted">{occByDay[i]}%</div>
      </div>
    );
  };

  // ---------- render ----------
  return (
    <div className="relative">
      {dbError && <p className="mb-3 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">Lỗi cơ sở dữ liệu: {dbError}</p>}

      {/* Khung lich kieu Cloudbeds: thanh cong cu nam tren 3 hang dau cua luoi */}
      <div className="bg-surface">
      {/* Unassigned strip: da chuyen xuong panel Assignments ben trai */}

      {/* assignment-mode banner: da chuyen vao panel Assignments ben trai */}

      {/* popup nho tai o vua bam: ngay o + Assign / Go to Reservation */}
      {assigningBooking && pendingRoom && !selected && spotAnchor && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => { setPendingRoom(null); setSpotAnchor(null); }} />
          <div
            className="fixed z-50 w-[260px] overflow-hidden rounded-xl bg-surface shadow-2xl"
            style={{
              left: Math.min(Math.max(spotAnchor.x - 40, 8), Math.max((typeof window !== "undefined" ? window.innerWidth : 1200) - 268, 8)),
              top: spotAnchor.y + 162 > (typeof window !== "undefined" ? window.innerHeight : 800) ? Math.max(spotAnchor.y - 162, 8) : spotAnchor.y + 12,
            }}
          >
            <div className="flex items-center justify-between bg-[#4aa8de] px-3 py-2 text-sm font-semibold text-white">
              <span>{fmtStayDay(assigningBooking.checkIn)} – {fmtStayDay(assigningBooking.checkOut)}</span>
              <button onClick={() => { setPendingRoom(null); setSpotAnchor(null); }} className="rounded-full px-1.5 leading-none hover:bg-surface/20">✕</button>
            </div>
            <div className="p-2 text-sm">
              <button onClick={() => assignRoom(pendingRoom)} className="block w-full rounded-lg px-3 py-2 text-left font-medium text-ink hover:bg-primary-soft">› Assign</button>
              <button onClick={() => { setSelectedId(assigningBooking.id); setPopupAnchor(spotAnchor); }} className="block w-full rounded-lg px-3 py-2 text-left font-medium text-ink hover:bg-primary-soft">› Go to Reservation</button>
            </div>
          </div>
        </>
      )}

      {/* Block-a-room form (mo bang muc Chan phong trong menu + xanh) */}
      {showBlockForm && (
        <div
          key={editingBlock ? editingBlock.id : "new"}
          ref={blockFormRef}
          className="cb-card page-enter mb-4 flex flex-wrap items-end gap-3 p-4 text-sm text-ink ring-2 ring-primary"
        >
          <div className="flex w-full items-center justify-between">
            <span className="text-base font-bold text-primary">{editingBlock ? `Sửa chặn phòng ${editingBlock.roomNumber}` : "Chặn phòng mới"}</span>
            <button onClick={() => { setShowBlockForm(false); setEditingBlock(null); }} className="cb-btn-ghost px-3 py-1.5 text-sm">Huỷ</button>
          </div>
          <label>
            Phòng
            <select value={bfRoom} onChange={(e) => setBfRoom(e.target.value)} className="ml-2 rounded-lg border border-line px-2 py-2">
              <option value="">— Chọn phòng —</option>
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
            <select value={bfKind} onChange={(e) => setBfKind(e.target.value as RoomBlock["kind"])} className="ml-2 rounded-lg border border-line px-2 py-2">
              <option value="out_of_order">Phòng hỏng — trừ khỏi phòng bán được</option>
              <option value="out_of_service">Tạm đóng — vẫn tính trong tồn, chỉ đánh dấu</option>
            </select>
          </label>
          <label>
            Lý do
            <input value={bfReason} onChange={(e) => setBfReason(e.target.value)} className="ml-2 rounded-lg border border-line px-2 py-2" placeholder="VD: Sửa điều hoà" />
          </label>
          <button onClick={saveBlock} className="cb-btn-primary px-4 py-2 text-sm">{editingBlock ? "Lưu sửa" : "Thêm chặn"}</button>
        </div>
      )}

      {/* ===== assignments layout: panel trai + lich ===== */}
      <div className="flex items-start gap-0">
        {/* panel don chua xep phong (truot ngang khi bat/tat) */}
        <aside className={`sticky top-4 shrink-0 overflow-hidden border-line bg-surface transition-all duration-300 ease-in-out ${panelOpen ? "w-[200px] border-r" : "w-0 border-r-0"}`}>
          <div className="max-h-[calc(100vh-2rem)] w-[200px] overflow-y-auto p-3">
          <div className="flex items-center justify-between gap-2 border-b border-line pb-2">
            <h3 className="text-sm font-bold uppercase tracking-wide text-ink">Đơn chưa xếp phòng</h3>
            <button onClick={() => { setPanelOpen(false); setCalOpen(false); }} title="Thu panel" className="shrink-0 rounded-md px-1.5 text-sm font-bold text-muted hover:bg-[var(--nui-bg)]">«</button>
          </div>
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
              className="flex w-full items-center justify-between border-b border-line bg-surface px-0 py-2.5 text-sm font-medium text-ink">
              <span className="flex items-center gap-1.5"><IconCalendar className="h-4 w-4" /> {assignDate ? `${assignDate.slice(8, 10)}/${assignDate.slice(5, 7)}/${assignDate.slice(0, 4)}` : "Tất cả ngày"}</span>
              <span className="flex items-center gap-1">
                {assignDate && <span onClick={(e) => { e.stopPropagation(); setAssignDate(null); setCalOpen(false); }} title="Xem tất cả ngày" className="rounded-full px-1 text-muted hover:bg-[var(--nui-bg)] hover:text-ink">✕</span>}
                <span className="text-muted">▾</span>
              </span>
            </button>
            {calOpen && calAnchor && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setCalOpen(false)} />
                <div className="fixed z-50 rounded-xl border border-line bg-surface p-3 shadow-xl" style={{ top: calAnchor.top, left: calAnchor.left, width: calAnchor.width }}>
                  <div className="flex items-center justify-between">
                    <button onClick={() => setCalMonth(addMonths(effMonth, -1))} className="rounded-md px-2 py-1 font-bold text-muted hover:bg-[var(--nui-bg)]">‹</button>
                    <span className="text-sm font-bold text-ink">Tháng {Number(effMonth.slice(5, 7))} · {effMonth.slice(0, 4)}</span>
                    <button onClick={() => setCalMonth(addMonths(effMonth, 1))} className="rounded-md px-2 py-1 font-bold text-muted hover:bg-[var(--nui-bg)]">›</button>
                  </div>
                  <div className="mt-2 grid grid-cols-7 gap-1 text-center text-[11px] font-semibold text-muted">
                    {["T2", "T3", "T4", "T5", "T6", "T7", "CN"].map((w) => <div key={w}>{w}</div>)}
                  </div>
                  <div className="mt-1 grid grid-cols-7 gap-1">
                    {calCells.map((c, idx) => c === null ? <div key={`b${idx}`} /> : (
                      <button
                        key={c}
                        onClick={() => { setAssignDate(c); setCalOpen(false); }}
                        className={`rounded-lg py-1.5 text-sm ${c === assignDate ? "bg-primary font-bold text-white" : c === todayStr ? "font-bold text-primary ring-1 ring-primary" : "text-ink hover:bg-[var(--nui-bg)]"}`}
                      >
                        {Number(c.slice(8, 10))}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
          {/* danh sach don chua gan, nhom theo loai phong */}
          <div className="mt-3 space-y-3">
            {unassignedGroups.length === 0 && (
              <p className="mt-6 text-center text-sm font-medium uppercase tracking-wide text-muted">Không còn đơn chờ xếp phòng</p>
            )}
            {unassignedGroups.map((g) => (
              <div key={g.typeId}>
                <div className="text-xs font-bold text-ink">▾ {typeName(g.typeId)} ({g.rows.length})</div>
                <div className="mt-1 space-y-2">
                  {g.rows.map((r) => (
                    <div key={r.id} className={`overflow-hidden rounded-lg border bg-surface ${assigningId === r.id ? "border-primary" : "border-line"}`}>
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
                        className={`cursor-pointer px-2 py-1.5 ${assigningId === r.id ? "bg-primary-soft" : "bg-surface"}`}
                      >
                        <div className="flex items-center gap-1.5">
                          <span className={`h-2 w-2 shrink-0 rounded-full ${STATUS_STYLES[r.status].split(" ")[0]}`} />
                          <span className="text-xs font-bold text-ink">{r.guestName}</span>
                          <span className="text-[11px] text-muted">{r.id}</span>
                        </div>
                        <div className="mt-0.5 text-[11px] text-muted">{r.checkIn.slice(5)} → {r.checkOut.slice(5)} · {diffDays(r.checkIn, r.checkOut)} đêm</div>
                      </div>
                      {/* form gán phòng mở ngay dưới đơn đang chọn */}
                      {assigningId === r.id && assigningBooking && (
                        <div className="border-t border-line bg-primary-soft p-2">
                          <label className="block text-xs text-muted">
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
                              className="mt-1 w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-ink"
                            >
                              {groups.map((g) => (
                                <option key={g.typeId} value={g.typeId}>{g.name}</option>
                              ))}
                            </select>
                          </label>
                          <label className="mt-2 block text-xs text-muted">
                            Phòng:
                            <select
                              value={pendingRoom ?? ""}
                              onChange={(e) => { setPendingRoom(e.target.value || null); setSpotAnchor(null); }}
                              className="mt-1 w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-ink"
                            >
                              {assignFitting.length === 0 && <option value="">Hết phòng trống phù hợp</option>}
                              {assignFitting.map((rm) => (
                                <option key={rm.number} value={rm.number}>{rm.number}</option>
                              ))}
                            </select>
                          </label>
                          {/* Het phong: giai thich tung dem + goi y loai khac con phong ca ky */}
                          {assignFitting.length === 0 && assignEffType && (
                            <div className="mt-2 rounded-lg bg-surface/70 p-2 text-xs text-muted">
                              <div className="font-semibold text-ink">Không có phòng nào trống cả kỳ ở:</div>
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
                                    className="mt-1 block font-semibold text-primary"
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
                              className="w-full rounded-full bg-primary py-2 text-sm font-bold text-white disabled:opacity-40"
                            >
                              ASSIGN
                            </button>
                            <button onClick={() => { setAssigningId(null); setPendingRoom(null); setSpotAnchor(null); setAssignTypeId(null); }} className="w-full rounded-full bg-[var(--nui-bg)] py-2 text-sm font-semibold text-ink">CANCEL</button>
                          </div>
                          <p className="mt-2 text-xs text-muted">Hoặc bấm ô sáng trên lịch để chọn phòng.</p>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
          </div>
        </aside>

        {/* lich (phan con lai) */}
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-0 bg-surface">
            {/* ===== ASIDE (cot Phong) — thu tu: 4 icon, Hom nay, All Room Types, loai phong, phong ===== */}
            <div className="w-[200px] shrink-0 bg-surface">
              {/* 1. 4 icon */}
              <div className="flex h-10 items-center gap-1 border-b border-[var(--nui-bg)] bg-surface px-3">
                <button onClick={() => { setPanelOpen((v) => !v); setCalOpen(false); }} title="Mở/đóng panel đơn chưa xếp phòng" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-line bg-surface text-ink hover:bg-surface-muted">
                  <IconMenu className="h-5 w-5" />
                </button>
                <div className="relative">
                  <button onClick={() => { setJumpOpen((v) => !v); setQuickOpen(false); }} title="Nhảy tới ngày" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-line bg-surface text-ink hover:bg-surface-muted">
                    <IconCalendar className="h-5 w-5" />
                  </button>
                  {jumpOpen && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setJumpOpen(false)} />
                      <div className="absolute left-0 top-10 z-50 rounded-xl border border-line bg-surface p-3 shadow-2xl">
                        <div className="mb-2 text-xs font-bold text-muted">Nhảy tới ngày</div>
                        <DatePicker value={startDate} onChange={(d) => { setStartDate(d); setJumpOpen(false); }} />
                      </div>
                    </>
                  )}
                </div>
                <button onClick={() => setPanelOpen(true)} title="Mở panel đơn chưa xếp phòng" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-line bg-surface text-ink hover:bg-surface-muted">
                  <IconSearch className="h-5 w-5" />
                </button>
                <div className="relative">
                  <button onClick={() => { setQuickOpen((v) => !v); setJumpOpen(false); }} title="Tác vụ nhanh" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-success text-white hover:opacity-90">
                    <IconPlus className="h-5 w-5" />
                  </button>
                  {quickOpen && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setQuickOpen(false)} />
                      <div className="absolute left-0 top-10 z-50 w-60 overflow-hidden rounded-xl border border-line bg-surface shadow-2xl">
                        <a href={`/${HOTEL_ID}/reservations/new`} className="block px-3 py-2 text-sm font-medium text-ink hover:bg-primary-soft">＋ Tạo đặt phòng mới</a>
                        <button onClick={() => { openNewBlock(); setQuickOpen(false); }} className="block w-full px-3 py-2 text-left text-sm font-medium text-ink hover:bg-primary-soft">⊘ Chặn phòng</button>
                      </div>
                    </>
                  )}
                </div>
              </div>
              {/* 2. Hom nay */}
              <div className="flex h-9 items-center gap-1.5 border-b border-[var(--nui-bg)] bg-surface px-3">
                <button onClick={() => setStartDate((d) => addDays(d, -7))} className="rounded-full border border-line bg-surface px-2 py-1 text-sm font-semibold text-ink">‹</button>
                <button onClick={() => setStartDate(todayStr)} className="rounded-full border border-line bg-surface px-3 py-1 text-sm font-bold text-primary">Hôm nay</button>
                <button onClick={() => setStartDate((d) => addDays(d, 7))} className="rounded-full border border-line bg-surface px-2 py-1 text-sm font-semibold text-ink">›</button>
              </div>
              {/* 3. All Room Types */}
              <div className="flex h-9 items-center gap-1 border-b border-[var(--nui-bg)] bg-surface px-3">
                <span className="shrink-0 text-xs text-muted">▾</span>
                <select value={typeFilter ?? ""} onChange={(e) => setTypeFilter(e.target.value || null)} className="appearance-none border-0 bg-transparent px-0 py-1 text-sm font-semibold text-ink">
                  <option value="">All Room Types</option>
                  {groups.map((g) => (
                    <option key={g.typeId} value={g.typeId}>{g.name}</option>
                  ))}
                </select>
              </div>
              {/* 4-7. Loai phong + phong */}
              {gridGroups.map((g) => (
                <div key={g.typeId}>
                  <div onClick={() => setCollapsedTypes((c) => ({ ...c, [g.typeId]: !c[g.typeId] }))} title={collapsedTypes[g.typeId] ? "Mở rộng loại phòng" : "Thu gọn loại phòng"} className="flex h-10 cursor-pointer items-center justify-between border-b border-[var(--nui-bg)] bg-surface px-3">
                    <span className="whitespace-nowrap text-xs font-bold text-ink">{collapsedTypes[g.typeId] ? "▸" : "▾"} {g.name}</span>
                  </div>
                  {stopSellByType[g.typeId] && (
                    <div className="flex h-7 items-center border-b border-[var(--nui-bg)] bg-surface px-3">
                      <span className="whitespace-nowrap text-[11px] font-bold text-warning">⊘ Ngừng bán</span>
                    </div>
                  )}
                  {!collapsedTypes[g.typeId] && g.rooms.map((room) => (
                    <div key={room.number} className="flex h-10 items-center justify-between border-b border-[var(--nui-bg)] bg-surface px-3">
                      <div className="whitespace-nowrap text-sm font-medium text-ink">{room.number}</div>
                      <span className="shrink-0 text-danger">*</span>
                    </div>
                  ))}
                </div>
              ))}
              {/* o goc duoi (khop hang tieu de ngay cuoi lich) */}
              <div className="h-18 shrink-0 bg-surface" />
            </div>
            {/* ===== VUNG NGAY (cuon ngang) ===== */}
            <div className="min-w-0 flex-1 overflow-x-auto bg-surface">
              <div
                className="grid"
                style={{
                  gridTemplateColumns: `repeat(${days.length}, minmax(64px, 1fr))`,
                  minWidth: `${days.length * 64}px`,
                }}
              >
                {/* thang */}
                {monthRuns.map((m, i) => (
                  <div
                    key={i}
                    className="flex h-10 items-center border-l border-[var(--nui-bg)] bg-surface px-2 text-[11px] font-bold tracking-wide text-ink"
                    style={{ gridColumn: `span ${m.span}` }}
                  >
                    {m.label}
                  </div>
                ))}
                {/* tieu de ngay */}
                {days.map((d, i) => dayHeaderCell(d, i, "t-"))}
                {/* loai phong + phong (chi o ngay) */}
                {gridGroups.map((g) => (
                  <div key={g.typeId} className="contents">
                    {days.map((d, i) => {
                      const left = leftByType[g.typeId]?.[i] ?? 0;
                      return (
                        <div key={d} className={`flex h-10 flex-col items-center justify-center border-b border-l border-[var(--nui-bg)] px-1 text-center leading-tight ${d === assignDate ? "bg-warning-soft" : d === todayStr ? "bg-success-soft" : "bg-surface"}`}>
                          <div className="text-xs font-bold text-ink">
                            {left}
                          </div>
                          <div className="text-[10px] text-muted">{fmtPrice(rack[g.typeId]?.[d])}</div>
                        </div>
                      );
                    })}
                    {stopSellByType[g.typeId] && (
                      <>
                        {days.map((d) => {
                          const bl = stopSellByType[g.typeId]?.[d] ?? [];
                          const full = bl.some((b) => b.scope === "room_type");
                          const chs = bl.filter((b) => b.scope === "channel");
                          const names = full ? ["Toàn bộ kênh"] : chs.map((b) => getChannelName(b.channelCode ?? ""));
                          const reason = bl.find((b) => b.reason)?.reason;
                          const title = bl.length === 0 ? undefined : `Ngừng bán: ${names.join(", ")}${reason ? ` — ${reason}` : ""}`;
                          const short = chs.length === 0 ? "" : chs.length === 1 ? (CH_SHORT[chs[0].channelCode ?? ""] ?? chs[0].channelCode ?? "") : `${CH_SHORT[chs[0].channelCode ?? ""] ?? chs[0].channelCode ?? ""} +${chs.length - 1}`;
                          return (
                            <div key={d} title={title} className={`flex h-7 items-center justify-center border-b border-l border-[var(--nui-bg)] px-1 text-center text-[10px] font-bold leading-tight ${bl.length > 0 ? "bg-warning-soft text-warning" : d === todayStr ? "bg-success-soft" : "bg-surface"}`}>
                              {full ? "ĐÓNG BÁN" : short}
                            </div>
                          );
                        })}
                      </>
                    )}
                    {!collapsedTypes[g.typeId] && g.rooms.map((room) => (
                      <div key={room.number} className="contents">
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
                            className={`relative h-10 border-b border-l border-[var(--nui-bg)] ${
                              assigningBooking &&
                              day >= assigningBooking.checkIn &&
                              day < assigningBooking.checkOut &&
                              roomFitsForType(assigningBooking, room, assignEffType ?? assigningBooking.roomTypeId)
                                ? "cursor-pointer bg-primary-soft ring-1 ring-inset ring-primary"
                                : day === assignDate
                                  ? "bg-warning-soft"
                                  : day === todayStr
                                    ? "bg-success-soft"
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
                                const startsMid = startIdx >= 0;
                                const endsMid = endIdx < days.length;
                                const spanCells =
                                  visibleEnd - visibleStart - (startsMid ? 0.5 : 0) + (endsMid ? 0.5 : 0);
                                return (
                                  <div
                                    key={b.id}
                                    onClick={(e) => { e.stopPropagation(); setSelectedBlockId(b.id); }}
                                    title={`${b.kind === "out_of_order" ? "Phòng hỏng" : "Tạm đóng"} · ${b.from} → ${b.to} · ${b.reason} (bấm để xem / xoá)`}
                                    className={`absolute inset-y-1 z-[5] flex cursor-pointer items-center overflow-hidden whitespace-nowrap px-3 text-[11px] font-medium text-white ${b.kind === "out_of_order" ? "bg-muted" : "bg-muted"}`}
                                    style={{
                                      left: startsMid ? "calc(50% + 1px)" : "2px",
                                      width: `calc(${spanCells * 100}% - ${startsMid ? 3 : 4}px)`,
                                      clipPath: "polygon(8px 0, calc(100% - 8px) 0, 100% 50%, calc(100% - 8px) 100%, 8px 100%, 0 50%)",
                                    }}
                                  >
                                    {b.kind === "out_of_order" ? <IconBan className="h-4 w-4" /> : <IconDroplet className="h-4 w-4" />} {b.reason}
                                  </div>
                                );
                              })}
                            {reservations
                              .filter((r) => r.roomNumbers.includes(room.number) && r.status !== "cancelled")
                              .map((r) => {
                                const startIdx = diffDays(startDate, r.checkIn);
                                const endIdx = diffDays(startDate, r.checkOut);
                                const visibleStart = Math.max(0, startIdx);
                                const visibleEnd = Math.min(days.length, endIdx);
                                if (visibleStart !== dayIndex || visibleEnd <= visibleStart) return null;
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
                {/* tieu de ngay cuoi lich */}
                {days.map((d, i) => dayHeaderCell(d, i, "b-"))}
              </div>
            </div>
          </div>
        </div>
      </div>
      </div>

      {/* selected room-block panel */}
      {selectedBlock && (
        <div className="cb-card mt-3 flex flex-wrap items-center gap-3 p-4 text-sm text-ink">
          <span className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-bold text-white ${selectedBlock.kind === "out_of_order" ? "bg-muted" : "bg-muted"}`}>
            {selectedBlock.kind === "out_of_order" ? (<><IconBan className="h-3.5 w-3.5" /> PHÒNG HỎNG</>) : (<><IconDroplet className="h-3.5 w-3.5" /> TẠM ĐÓNG</>)}
          </span>
          <span className="font-semibold">Phòng {selectedBlock.roomNumber}</span>
          <span>{selectedBlock.from} → {selectedBlock.to} (đến đêm {selectedBlock.to})</span>
          <span className="text-muted">{selectedBlock.reason}</span>
          <span className="ml-auto flex gap-2">
            <button onClick={() => openEditBlock(selectedBlock)} className="cb-btn-ghost px-3 py-1.5 text-sm">Sửa</button>
            <button onClick={() => removeBlock(selectedBlock.id)} className="rounded-lg border border-danger px-3 py-1.5 text-sm font-semibold text-danger hover:bg-danger-soft">
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
