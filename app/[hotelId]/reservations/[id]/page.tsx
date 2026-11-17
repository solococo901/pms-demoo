"use client";
// ============================================================
// app/[hotelId]/reservations/[id]/page.tsx — TRANG CHI TIET DON
// kieu Cloudbeds (RESDETAIL1, 2026-11-17).
//   Header: ten khach + trang thai + ma don + kenh + ngay o +
//   so con no + nut hanh dong chinh (Nhan/Tra phong tuy giai doan).
//   8 tab nhu Cloudbeds: Cho o | Folio | Khach | The | Ghi chu |
//   Tai lieu | Hoat dong | Email.
//   - Cho o: bang phong o + sua don + gia han (chay bo kiem tra
//     dung chung, giong drawer o trang danh sach).
//   - Folio: gia tung dem + dich vu them + thu tien (nhu drawer).
//   - Khach: thong tin khach + sua (mo form sua o tab Cho o).
//   - Ghi chu: doc/ghi reservation_notes (mau BookingPopup).
//   - The / Tai lieu / Hoat dong / Email: chua co — ghi ro, khong
//     lam nut gia (The lam cung buoc Payment; Tai lieu can kho luu
//     tru; Hoat dong = nhat ky thao tac, lam 19-20/11; Email chua
//     co ha tang gui mail).
// RESDETAIL2 (2026-11-17): bo max-w-4xl — trang dung dung width
// 80% cua layout chung (app/layout.tsx) nhu moi trang khac.
// ============================================================

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  getChannelName,
  resolvePlanPrice,
  type FolioItem,
  type InventoryBlock,
  type RatePlan,
  type Reservation,
  type ReservationStatus,
  type Room,
  type RoomBlock,
  type RoomType,
} from "@/lib/mock-data";
import { supabase } from "@/lib/supabase";
import { queueChannexDates, stayDates } from "@/lib/channex-outbox";
import { currentHotelId } from "@/lib/current-hotel";
import { STATUS_LABELS, STATUS_STYLES } from "@/components/ReservationBar";
import { DatePicker } from "@/components/DatePicker";
import {
  canCancel,
  canCheckIn,
  canCheckOut,
  canEdit,
  priceBreakdown,
  validateEdit,
  validateExtend,
  validatePayment,
  type AvailabilityData,
} from "@/lib/booking-rules";

const ACCOUNT_ID = "11111111-1111-1111-1111-111111111111";

const DAY_MS = 86_400_000;
const toTime = (d: string) => new Date(d + "T00:00:00Z").getTime();
const toISO = (t: number) => new Date(t).toISOString().slice(0, 10);
const addDays = (d: string, n: number) => toISO(toTime(d) + n * DAY_MS);
const nightsOf = (r: Reservation) =>
  Math.round((new Date(r.checkOut + "T00:00:00Z").getTime() - new Date(r.checkIn + "T00:00:00Z").getTime()) / DAY_MS);
const fmt = (n: number) => n.toLocaleString("vi-VN");
const fmtDate = (d: string) => d.split("-").reverse().join("/");
const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

type Note = { id: string; author: string; body: string; createdAt: string };
type TabKey = "stay" | "folio" | "guest" | "cards" | "notes" | "docs" | "activity" | "email";
const TABS: { key: TabKey; label: string }[] = [
  { key: "stay", label: "Chỗ ở" },
  { key: "folio", label: "Folio" },
  { key: "guest", label: "Khách" },
  { key: "cards", label: "Thẻ" },
  { key: "notes", label: "Ghi chú" },
  { key: "docs", label: "Tài liệu" },
  { key: "activity", label: "Hoạt động" },
  { key: "email", label: "Email" },
];

export default function ReservationDetailPage() {
  const params = useParams();
  const HOTEL_ID = typeof params.hotelId === "string" ? params.hotelId : currentHotelId();
  const RES_ID = typeof params.id === "string" ? params.id : "";
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [todayStr, setTodayStr] = useState("");
  const [roomBlocks, setRoomBlocks] = useState<RoomBlock[]>([]);
  const [invBlocks, setInvBlocks] = useState<InventoryBlock[]>([]);
  const [priceOverrides, setPriceOverrides] = useState<Record<string, number>>({});
  const [catalog, setCatalog] = useState<{ roomTypes: RoomType[]; ratePlans: RatePlan[]; rooms: Room[] }>({
    roomTypes: [],
    ratePlans: [],
    rooms: [],
  });
  const [folioItems, setFolioItems] = useState<FolioItem[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [tab, setTab] = useState<TabKey>("stay");

  // Folio: them dich vu + thu tien.
  const [extraLabel, setExtraLabel] = useState("");
  const [extraAmount, setExtraAmount] = useState<number>(0);
  const [payAmount, setPayAmount] = useState<number>(0);
  const [payMethod, setPayMethod] = useState("Tiền mặt");
  // Ghi chu.
  const [noteBody, setNoteBody] = useState("");
  // Sua don + gia han.
  const [editing, setEditing] = useState(false);
  const [editError, setEditError] = useState("");
  const [eName, setEName] = useState("");
  const [ePhone, setEPhone] = useState("");
  const [eCheckIn, setECheckIn] = useState("");
  const [eCheckOut, setECheckOut] = useState("");
  const [eType, setEType] = useState("");
  const [ePlan, setEPlan] = useState("");
  const [eAdults, setEAdults] = useState(2);
  const [eChildren, setEChildren] = useState(0);
  const [eNote, setENote] = useState("");
  const [extending, setExtending] = useState(false);
  const [extCheckOut, setExtCheckOut] = useState("");
  const [extError, setExtError] = useState("");

  const detail = reservations.find((r) => r.id === RES_ID) ?? null;
  const roomTypeName = (id: string) => catalog.roomTypes.find((t) => t.id === id)?.name ?? id;
  const detailNights = detail ? nightsOf(detail) : 0;
  const detailExtras = detail ? folioItems.filter((f) => f.reservationId === detail.id) : [];
  const extrasTotal = detailExtras.reduce((a, f) => a + f.amount, 0);
  const totalDue = detail ? detail.totalAmount + extrasTotal : 0;
  const balance = detail ? totalDue - detail.paidAmount : 0;
  const detailPlan = detail ? catalog.ratePlans.find((p) => p.id === detail.ratePlanId) : undefined;
  const detailBreakdown =
    detail && detailPlan
      ? priceBreakdown(detailPlan, catalog.ratePlans, detail.checkIn, detail.checkOut, detail.adults ?? detail.guests, detail.children ?? 0, priceOverrides)
      : null;

  const availData: AvailabilityData = useMemo(
    () => ({ rooms: catalog.rooms, reservations, blocks: roomBlocks, invBlocks }),
    [catalog.rooms, reservations, roomBlocks, invBlocks],
  );

  useEffect(() => {
    setTodayStr(localToday());
  }, []);

  // ---------- load: don nay + toan bo du lieu can cho bo kiem tra ----------
  useEffect(() => {
    if (!HOTEL_ID || !RES_ID) return;
    (async () => {
      const [res, rr, folio, typesRes, roomsRes, plansRes, blocksRes, invRes, notesRes] = await Promise.all([
        supabase.from("reservations").select("*").eq("hotel_id", HOTEL_ID).order("booked_at", { ascending: false }),
        supabase.from("reservation_rooms").select("reservation_id, room_number"),
        supabase.from("folio_items").select("*").eq("hotel_id", HOTEL_ID),
        supabase.from("room_types").select("*").eq("hotel_id", HOTEL_ID),
        supabase.from("rooms").select("*").eq("hotel_id", HOTEL_ID),
        supabase.from("rate_plans").select("*").eq("hotel_id", HOTEL_ID),
        supabase.from("room_blocks").select("*").eq("hotel_id", HOTEL_ID),
        supabase.from("inventory_blocks").select("*").eq("hotel_id", HOTEL_ID),
        supabase.from("reservation_notes").select("id, author, body, created_at").eq("reservation_id", RES_ID).order("created_at", { ascending: true }),
      ]);
      const err = res.error ?? rr.error ?? folio.error ?? typesRes.error ?? roomsRes.error ?? plansRes.error ?? blocksRes.error ?? invRes.error ?? notesRes.error;
      if (err) {
        setLoadError(err.message);
        setLoading(false);
        return;
      }
      const roomsMap = new Map<string, string[]>();
      for (const row of rr.data ?? []) {
        const list = roomsMap.get(row.reservation_id) ?? [];
        list.push(row.room_number);
        roomsMap.set(row.reservation_id, list);
      }
      setReservations(
        (res.data ?? []).map((r) => ({
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
      setFolioItems(
        (folio.data ?? []).map((f) => ({ id: f.id, reservationId: f.reservation_id, date: f.date, label: f.label, amount: f.amount }))
      );
      setNotes(
        (notesRes.data ?? []).map((n) => ({ id: n.id, author: n.author, body: n.body, createdAt: n.created_at }))
      );
      setRoomBlocks(
        (blocksRes.data ?? []).map((b) => ({ id: b.id, roomNumber: b.room_number, from: b.from_date, to: b.to_date, kind: b.kind, reason: b.reason ?? "" }))
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
      let priceRows: { rate_plan_id: string; date: string; price: number }[] = [];
      if (planIds.size > 0) {
        for (let from = 0; ; from += 1000) {
          const { data: page, error: priceErr } = await supabase
            .from("rate_prices")
            .select("rate_plan_id, date, price")
            .in("rate_plan_id", [...planIds])
            .range(from, from + 999);
          if (priceErr) {
            setLoadError(priceErr.message);
            setLoading(false);
            return;
          }
          priceRows = [...priceRows, ...(page ?? [])];
          if (!page || page.length < 1000) break;
        }
      }
      for (const row of priceRows) {
        const plan = dbPlans.find((p) => p.id === row.rate_plan_id);
        if (plan && !plan.derivedFromId) plan.prices[row.date] = Number(row.price);
      }
      const dbOverrides: Record<string, number> = {};
      for (const row of priceRows) {
        const plan = dbPlans.find((p) => p.id === row.rate_plan_id);
        if (plan?.derivedFromId && resolvePlanPrice(plan, row.date, dbPlans, {}) !== Number(row.price)) {
          dbOverrides[`${row.rate_plan_id}|${row.date}`] = Number(row.price);
        }
      }
      setPriceOverrides(dbOverrides);
      setCatalog({
        roomTypes: (typesRes.data ?? []).map((t) => ({
          id: t.id, code: t.code ?? undefined, name: t.name,
          maxOccupancy: t.max_occupancy, maxAdults: t.max_adults,
          maxChildren: t.max_children, maxInfants: t.max_infants,
          bedConfig: t.bed_config ?? "", sizeM2: t.size_sqm ?? undefined,
          priceFloor: t.min_price ?? undefined, priceCeiling: t.max_price ?? undefined,
          descriptionVi: t.description_vi ?? undefined,
          descriptionEn: t.description_en ?? undefined, active: t.active,
        })),
        rooms: (roomsRes.data ?? []).map((r) => ({
          number: r.number, roomTypeId: r.room_type_id,
          housekeepingStatus: r.housekeeping_status as Room["housekeepingStatus"],
        })),
        ratePlans: dbPlans,
      });
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- luu thay doi: DB truoc, man hinh sau ----------
  async function patchReservation(id: string, patch: Partial<Reservation>): Promise<boolean> {
    const dbPatch: Record<string, unknown> = {};
    if (patch.status !== undefined) dbPatch.status = patch.status;
    if (patch.paidAmount !== undefined) dbPatch.paid_amount = patch.paidAmount;
    if (patch.guestName !== undefined) dbPatch.guest_name = patch.guestName;
    if (patch.guestPhone !== undefined) dbPatch.guest_phone = patch.guestPhone;
    if (patch.checkIn !== undefined) dbPatch.check_in = patch.checkIn;
    if (patch.checkOut !== undefined) dbPatch.check_out = patch.checkOut;
    if (patch.adults !== undefined) dbPatch.adults = patch.adults;
    if (patch.children !== undefined) dbPatch.children = patch.children;
    if (patch.roomTypeId !== undefined) dbPatch.room_type_id = patch.roomTypeId;
    if (patch.ratePlanId !== undefined) dbPatch.rate_plan_id = patch.ratePlanId;
    if (patch.totalAmount !== undefined) dbPatch.total_amount = patch.totalAmount;
    if (patch.note !== undefined) dbPatch.note = patch.note ?? null;
    const { error } = await supabase.from("reservations").update(dbPatch).eq("id", id);
    if (error) {
      alert("Lưu xuống cơ sở dữ liệu không thành công: " + error.message);
      return false;
    }
    setReservations((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    if (patch.status !== undefined || patch.checkIn !== undefined || patch.checkOut !== undefined) {
      const r = reservations.find((x) => x.id === id);
      if (r) {
        const dates = new Set([...stayDates(r.checkIn, r.checkOut), ...stayDates(patch.checkIn ?? r.checkIn, patch.checkOut ?? r.checkOut)]);
        queueChannexDates([...dates]);
      }
    }
    return true;
  }

  // ---------- doi trang thai: chay bo kiem tra dung chung truoc ----------
  async function changeStatus(id: string, status: ReservationStatus) {
    const r = reservations.find((x) => x.id === id);
    if (!r) return;
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
    await patchReservation(id, { status });
  }

  // ---------- folio: them / xoa dich vu, ghi nhan thanh toan ----------
  async function addExtra() {
    if (!detail || !extraLabel.trim() || extraAmount <= 0) return;
    const item: FolioItem = { id: `fi-${Date.now()}`, reservationId: detail.id, date: todayStr || localToday(), label: extraLabel.trim(), amount: extraAmount };
    const { error } = await supabase.from("folio_items").insert({
      id: item.id, reservation_id: item.reservationId, hotel_id: HOTEL_ID, account_id: ACCOUNT_ID,
      date: item.date, label: item.label, amount: item.amount,
    });
    if (error) return alert("Lưu khoản dịch vụ không thành công: " + error.message);
    setFolioItems((prev) => [...prev, item]);
    setExtraLabel("");
    setExtraAmount(0);
  }

  async function deleteExtra(id: string) {
    const { error } = await supabase.from("folio_items").delete().eq("id", id);
    if (error) return alert("Xoá khoản dịch vụ không thành công: " + error.message);
    setFolioItems((prev) => prev.filter((x) => x.id !== id));
  }

  function recordPayment() {
    if (!detail || payAmount <= 0) return;
    const check = validatePayment(payAmount, balance);
    if (!check.ok) return alert(check.error);
    patchReservation(detail.id, { paidAmount: detail.paidAmount + payAmount });
    setPayAmount(0);
  }

  // ---------- ghi chu (mau BookingPopup) ----------
  async function addNote() {
    if (!detail || !noteBody.trim()) return;
    const { data: userData } = await supabase.auth.getUser();
    const author = userData.user?.email ?? "Lễ tân";
    const { data, error } = await supabase
      .from("reservation_notes")
      .insert({ hotel_id: HOTEL_ID, account_id: ACCOUNT_ID, reservation_id: detail.id, author, body: noteBody.trim() })
      .select("id, author, body, created_at")
      .single();
    if (error || !data) return alert("Lưu ghi chú không thành công: " + (error?.message ?? ""));
    setNotes((prev) => [...prev, { id: data.id, author: data.author, body: data.body, createdAt: data.created_at }]);
    setNoteBody("");
  }

  // ---------- sua don + gia han ----------
  function openEdit() {
    if (!detail) return;
    setEName(detail.guestName);
    setEPhone(detail.guestPhone);
    setECheckIn(detail.checkIn);
    setECheckOut(detail.checkOut);
    setEType(detail.roomTypeId);
    setEPlan(detail.ratePlanId);
    setEAdults(detail.adults ?? detail.guests);
    setEChildren(detail.children ?? 0);
    setENote(detail.note ?? "");
    setEditError("");
    setEditing(true);
    setTab("stay");
  }

  const editType = catalog.roomTypes.find((t) => t.id === eType);
  const editPlans = catalog.ratePlans.filter((p) => p.channelCode === detail?.channelCode && p.roomTypeId === eType);
  const editPlan = editPlans.find((p) => p.id === ePlan) ?? editPlans[0];
  const editNights = Math.max(0, Math.round((toTime(eCheckOut) - toTime(eCheckIn)) / DAY_MS));
  const editBreakdown =
    editPlan && editNights > 0
      ? priceBreakdown(editPlan, catalog.ratePlans, eCheckIn, eCheckOut, eAdults, eChildren, priceOverrides)
      : null;
  const editTotal = editBreakdown ? editBreakdown.grandTotal : 0;

  async function saveEdit() {
    if (!detail) return;
    if (!eName.trim()) return setEditError("Chưa nhập tên khách.");
    const editable = canEdit(detail);
    if (!editable.ok) return setEditError(editable.error ?? "Không sửa được đơn này.");
    const plan = catalog.ratePlans.find((p) => p.id === ePlan);
    const check = validateEdit({
      data: availData,
      checkIn: eCheckIn,
      checkOut: eCheckOut,
      adults: eAdults,
      children: eChildren,
      maxOccupancy: editType?.maxOccupancy ?? 0,
      roomTypeId: eType,
      plan,
      allPlans: catalog.ratePlans,
      overrides: priceOverrides,
      channelCode: detail.channelCode,
      today: todayStr,
      booking: detail,
    });
    if (!check.ok) return setEditError(check.error ?? "Không lưu được thay đổi.");
    if (check.warnings.length > 0 && !window.confirm(`${check.warnings.join("\n")}\nVẫn lưu thay đổi?`)) return;
    if (!plan) return setEditError("Kênh này chưa có gói giá cho loại phòng đã chọn.");
    const typeChanged = eType !== detail.roomTypeId;
    const assigned = detail.roomNumbers.length > 0;
    if (typeChanged && assigned && !window.confirm("Đổi loại phòng sẽ huỷ các phòng đã gán cho đơn này — cần gán lại trên Lịch phòng. Vẫn đổi?")) return;
    if (typeChanged && assigned) {
      const { error } = await supabase.from("reservation_rooms").delete().eq("reservation_id", detail.id);
      if (error) return setEditError("Huỷ phòng đã gán không thành công: " + error.message);
    }
    const ok = await patchReservation(detail.id, {
      guestName: eName.trim(), guestPhone: ePhone,
      checkIn: eCheckIn, checkOut: eCheckOut,
      adults: eAdults, children: eChildren, guests: eAdults + eChildren,
      roomTypeId: eType, ratePlanId: plan.id,
      totalAmount: editTotal, note: eNote || undefined,
      ...(typeChanged && assigned ? { roomNumbers: [] as string[] } : {}),
    });
    if (ok) setEditing(false);
  }

  function openExtend() {
    if (!detail) return;
    setExtCheckOut(addDays(detail.checkOut, 1));
    setExtError("");
    setExtending(true);
    setTab("stay");
  }

  const extNights = detail ? Math.max(0, Math.round((toTime(extCheckOut) - toTime(detail.checkOut)) / DAY_MS)) : 0;
  const extPlan = detail ? catalog.ratePlans.find((p) => p.id === detail.ratePlanId) : undefined;
  const extAdded =
    detail && extPlan && Number.isFinite(extNights) && extNights > 0
      ? priceBreakdown(extPlan, catalog.ratePlans, detail.checkOut, extCheckOut, detail.adults ?? detail.guests, detail.children ?? 0, priceOverrides).grandTotal
      : 0;
  const extTotal = detail ? detail.totalAmount + extAdded : 0;

  async function saveExtend() {
    if (!detail) return;
    if (!extCheckOut) return setExtError("Chưa chọn ngày đi mới.");
    if (!extPlan) return setExtError("Không tìm thấy gói giá của đơn này — không tính được tiền các đêm thêm.");
    const check = validateExtend(availData, detail, extCheckOut, extPlan, catalog.ratePlans, priceOverrides, detail.channelCode);
    if (!check.ok) return setExtError(check.error ?? "Không gia hạn được.");
    if (check.warnings.length > 0 && !window.confirm(`${check.warnings.join("\n")}\nVẫn gia hạn?`)) return;
    const ok = await patchReservation(detail.id, { checkOut: extCheckOut, totalAmount: extTotal });
    if (ok) setExtending(false);
  }

  // Ghi chu cu o cot note cua don (neu co) hien nhu 1 ghi chu dau tien.
  const allNotes: Note[] = detail?.note
    ? [{ id: "legacy", author: "Ghi chú đơn", body: detail.note, createdAt: "" }, ...notes]
    : notes;

  const inputCls = "rounded-lg border border-[var(--cb-border)] px-3 py-2 text-sm text-[var(--cb-text)] outline-none focus:border-[var(--cb-blue)]";

  if (loading) {
    return (
      <div>
        <p className="mt-10 text-sm text-[var(--cb-muted)]">Đang tải chi tiết đơn...</p>
      </div>
    );
  }

  if (loadError || !detail) {
    return (
      <div>
        <Link href={`/${HOTEL_ID}/reservations`} className="text-sm font-medium text-[var(--cb-blue)] hover:underline">← Về danh sách Đặt phòng</Link>
        <div className="cb-card mt-4 p-6 text-center">
          <h1 className="text-xl font-bold text-[var(--cb-text)]">Không tìm thấy đơn này</h1>
          <p className="mt-2 text-sm text-[var(--cb-muted)]">{loadError || `Không có đơn ${RES_ID} ở khách sạn này.`}</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <Link href={`/${HOTEL_ID}/reservations`} className="text-sm font-medium text-[var(--cb-blue)] hover:underline">← Về danh sách Đặt phòng</Link>

      {/* header — Cloudbeds: ten khach + trang thai + so con no + nut hanh dong chinh */}
      <div className="cb-card mt-3 border-t-4 border-t-[var(--cb-blue)] p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-extrabold tracking-tight text-[var(--cb-text)]">{detail.guestName}</h1>
              <span className="rounded-full bg-[var(--cb-bg)] px-3 py-1 text-xs font-semibold text-[var(--cb-text)]">
                <span className={`mr-1.5 inline-block h-2 w-2 rounded-full ${STATUS_STYLES[detail.status].split(" ")[0]}`} />
                {STATUS_LABELS[detail.status]}
              </span>
              {balance > 0 && (
                <span className="rounded-full bg-[#fdecec] px-3 py-1 text-xs font-semibold text-[#e5484d]">Còn nợ {fmt(balance)}₫</span>
              )}
              {balance <= 0 && detail.totalAmount > 0 && (
                <span className="rounded-full bg-[#e6f7f1] px-3 py-1 text-xs font-semibold text-[#0e7a56]">Đã thanh toán đủ</span>
              )}
            </div>
            <p className="mt-1 text-sm text-[var(--cb-muted)]">
              Đơn {detail.id} · {getChannelName(detail.channelCode)} · {fmtDate(detail.checkIn)} → {fmtDate(detail.checkOut)} ({detailNights} đêm) · {roomTypeName(detail.roomTypeId)}
              {detail.roomNumbers.length > 0 ? ` · Phòng ${detail.roomNumbers.join(", ")}` : " · Chưa gán phòng"}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {detail.status === "confirmed" && (
              <button onClick={() => changeStatus(detail.id, "in_house")} className="cb-btn-primary px-4 py-2 text-sm">Nhận phòng</button>
            )}
            {detail.status === "in_house" && (
              <button onClick={() => changeStatus(detail.id, "checked_out")} className="cb-btn-primary px-4 py-2 text-sm">Trả phòng</button>
            )}
            {!["cancelled", "no_show", "checked_out"].includes(detail.status) && (
              <button onClick={openEdit} className="cb-btn-ghost px-4 py-2 text-sm">Sửa đơn</button>
            )}
            {["pending", "confirmed", "in_house"].includes(detail.status) && (
              <button onClick={openExtend} className="cb-btn-ghost px-4 py-2 text-sm">Gia hạn</button>
            )}
            {detail.status === "confirmed" && (
              <button onClick={() => changeStatus(detail.id, "no_show")} className="cb-btn-ghost px-4 py-2 text-sm">Khách không đến</button>
            )}
            {["pending", "confirmed"].includes(detail.status) && (
              <button onClick={() => changeStatus(detail.id, "cancelled")} className="rounded-lg border border-[#e5484d] px-4 py-2 text-sm font-semibold text-[#e5484d] hover:bg-red-50">Huỷ đơn</button>
            )}
          </div>
        </div>
      </div>

      {/* tab bar — 8 tab nhu Cloudbeds */}
      <div className="mt-4 flex flex-wrap gap-1 border-b border-[var(--cb-border)]">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`rounded-t-lg px-4 py-2.5 text-sm font-semibold ${
              tab === t.key
                ? "border-b-2 border-[var(--cb-blue)] bg-white text-[var(--cb-blue)]"
                : "text-[var(--cb-muted)] hover:bg-white hover:text-[var(--cb-text)]"
            }`}
          >
            {t.label}
            {t.key === "notes" && allNotes.length > 0 ? ` (${allNotes.length})` : ""}
          </button>
        ))}
      </div>

      {/* ---------- tab Cho o ---------- */}
      {tab === "stay" && (
        <div className="cb-card mt-4 p-5 text-sm">
          {editing ? (
            <div>
              <div className="mb-4 flex items-start justify-between">
                <div>
                  <div className="text-lg font-bold text-[var(--cb-text)]">Sửa đơn {detail.id}</div>
                  <div className="text-sm text-[var(--cb-muted)]">{detail.guestName} · {getChannelName(detail.channelCode)}</div>
                </div>
                <button onClick={() => setEditing(false)} className="cb-btn-ghost flex h-8 w-8 items-center justify-center rounded-full text-sm">✕</button>
              </div>
              <div className="space-y-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-[var(--cb-muted)]">Tên khách *</label>
                  <input className={`${inputCls} w-full`} value={eName} onChange={(e) => setEName(e.target.value)} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-[var(--cb-muted)]">Số điện thoại</label>
                  <input className={`${inputCls} w-full`} value={ePhone} onChange={(e) => setEPhone(e.target.value)} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-[var(--cb-muted)]">Ngày đến</label>
                    <DatePicker
                      value={eCheckIn}
                      onChange={(v) => {
                        setECheckIn(v);
                        if (v && eCheckOut && v >= eCheckOut) setECheckOut(addDays(v, 1));
                      }}
                      fullWidth
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-[var(--cb-muted)]">Ngày đi</label>
                    <DatePicker value={eCheckOut} onChange={setECheckOut} min={eCheckIn ? addDays(eCheckIn, 1) : undefined} rangeStart={eCheckIn || undefined} fullWidth />
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-[var(--cb-muted)]">Loại phòng</label>
                  <select className={`${inputCls} w-full`} value={eType} onChange={(e) => {
                    const nt = e.target.value;
                    setEType(nt);
                    const first = catalog.ratePlans.find((p) => p.channelCode === detail.channelCode && p.roomTypeId === nt);
                    setEPlan(first?.id ?? "");
                  }}>
                    {catalog.roomTypes.map((t) => (<option key={t.id} value={t.id}>{t.name} (tối đa {t.maxOccupancy} khách)</option>))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-[var(--cb-muted)]">Gói giá (của kênh {getChannelName(detail.channelCode)})</label>
                  <select className={`${inputCls} w-full`} value={ePlan} onChange={(e) => setEPlan(e.target.value)}>
                    {editPlans.map((p) => (<option key={p.id} value={p.id}>{p.name}{p.derivedFromId ? " (kế thừa)" : ""}</option>))}
                    {editPlans.length === 0 && <option value="">— chưa có gói giá —</option>}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-[var(--cb-muted)]">Người lớn</label>
                    <input type="number" min={1} className={`${inputCls} w-full`} value={eAdults} onChange={(e) => setEAdults(Number(e.target.value))} />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-[var(--cb-muted)]">Trẻ em</label>
                    <input type="number" min={0} className={`${inputCls} w-full`} value={eChildren} onChange={(e) => setEChildren(Number(e.target.value))} />
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-[var(--cb-muted)]">Ghi chú</label>
                  <input className={`${inputCls} w-full`} value={eNote} onChange={(e) => setENote(e.target.value)} placeholder="Yêu cầu đặc biệt..." />
                </div>
                {eType !== detail.roomTypeId && detail.roomNumbers.length > 0 && (
                  <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-[#e5484d]">Đổi loại phòng sẽ huỷ các phòng đã gán ({detail.roomNumbers.join(", ")}) — cần gán lại trên Lịch phòng.</p>
                )}
                <div className="space-y-1 rounded-xl bg-[var(--cb-blue-soft)] px-4 py-3">
                  <div className="flex justify-between"><span>Tiền phòng + phụ thu — {editNights} đêm</span><span className="font-semibold">{fmt(editTotal)}₫</span></div>
                  <div className="flex justify-between text-[var(--cb-muted)]"><span>Tổng hiện tại</span><span>{fmt(detail.totalAmount)}₫</span></div>
                </div>
                {editError && <p className="text-sm text-[#e5484d]">{editError}</p>}
                <div className="flex gap-2">
                  <button onClick={saveEdit} className="cb-btn-primary flex-1 py-2.5 text-sm">Lưu thay đổi</button>
                  <button onClick={() => setEditing(false)} className="cb-btn-ghost px-5 py-2.5 text-sm">Huỷ</button>
                </div>
                <p className="text-xs text-[var(--cb-muted)]">Không sửa được ở đây: nguồn đơn, hình thức thu tiền, trạng thái (dùng nút Nhận/Trả/Huỷ bên trên) và tiền đã thu (sửa trong tab Folio).</p>
              </div>
            </div>
          ) : (
            <div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm">
                  <thead className="border-b-2 border-[var(--cb-border)]">
                    <tr>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-[var(--cb-muted)]">Loại phòng</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-[var(--cb-muted)]">Phòng</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-[var(--cb-muted)]">Gói giá</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-[var(--cb-muted)]">Ngày đến</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-[var(--cb-muted)]">Ngày đi</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-[var(--cb-muted)]">Khách</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-[var(--cb-muted)]">Đêm</th>
                      <th className="px-3 py-2 text-right text-xs font-semibold text-[var(--cb-muted)]">Tổng</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-t border-[var(--cb-bg)]">
                      <td className="px-3 py-3 font-medium">{roomTypeName(detail.roomTypeId)}</td>
                      <td className="px-3 py-3">{detail.roomNumbers.length ? detail.roomNumbers.join(", ") : "Chưa gán"}</td>
                      <td className="px-3 py-3">{detailPlan?.name ?? detail.ratePlanId}</td>
                      <td className="px-3 py-3">{fmtDate(detail.checkIn)}</td>
                      <td className="px-3 py-3">{fmtDate(detail.checkOut)}</td>
                      <td className="px-3 py-3">{detail.adults ?? detail.guests} người lớn{(detail.children ?? 0) > 0 ? `, ${detail.children} trẻ em` : ""}</td>
                      <td className="px-3 py-3">{detailNights}</td>
                      <td className="px-3 py-3 text-right font-semibold">{fmt(detail.totalAmount)}₫</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div className="mt-4 space-y-2">
                <DetailRow label="Số điện thoại" value={detail.guestPhone || "—"} />
                <DetailRow label="Thu tiền bởi" value={detail.paymentCollector === "channel_collect" ? "Kênh thu hộ" : "Khách sạn tự thu"} />
                <DetailRow label="Ngày đặt" value={fmtDate(detail.createdAt)} />
                {detail.note && <DetailRow label="Ghi chú" value={detail.note} />}
              </div>
              {["pending", "confirmed", "in_house"].includes(detail.status) && extending && (
                <div className="mt-4 rounded-xl border border-[var(--cb-border)] p-4">
                  <div className="font-semibold text-[var(--cb-text)]">Gia hạn — ngày đi hiện tại {fmtDate(detail.checkOut)}</div>
                  <div className="mt-3 flex flex-wrap items-end gap-2">
                    <div>
                      <span className="text-xs text-[var(--cb-muted)]">Ngày đi mới</span>
                      <div className="mt-0.5"><DatePicker value={extCheckOut} onChange={setExtCheckOut} min={addDays(detail.checkOut, 1)} /></div>
                    </div>
                    <span className="pb-2 text-sm">Thêm {extNights} đêm · Tổng mới {fmt(extTotal)}₫ (hiện tại {fmt(detail.totalAmount)}₫)</span>
                  </div>
                  {detail.roomNumbers.length > 0 && (
                    <p className="mt-2 text-xs text-[var(--cb-muted)]">Trước khi lưu sẽ kiểm tra phòng {detail.roomNumbers.join(", ")} còn trống các đêm thêm.</p>
                  )}
                  {detail.roomNumbers.length === 0 && (
                    <p className="mt-2 text-xs text-[var(--cb-muted)]">Đơn chưa gán phòng — trước khi lưu sẽ kiểm tra còn phòng trống loại {roomTypeName(detail.roomTypeId)} các đêm thêm.</p>
                  )}
                  {extError && <p className="mt-2 text-sm text-[#e5484d]">{extError}</p>}
                  <div className="mt-3 flex gap-2">
                    <button onClick={saveExtend} className="cb-btn-primary px-3 py-2 text-sm">Xác nhận gia hạn</button>
                    <button onClick={() => setExtending(false)} className="cb-btn-ghost px-3 py-2 text-sm">Huỷ</button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ---------- tab Folio ---------- */}
      {tab === "folio" && (
        <div className="cb-card mt-4 p-5 text-sm">
          <div className="text-base font-bold text-[var(--cb-text)]">Folio — hoá đơn chi tiết</div>
          <div className="mt-3 space-y-1.5">
            {detailBreakdown && detailBreakdown.unpriced.length === 0 ? (
              detailBreakdown.perNight.map((n) => (
                <div key={n.date} className="flex justify-between gap-3">
                  <span className="text-[var(--cb-muted)]">Tiền phòng — đêm {fmtDate(n.date)}{detail.roomNumbers.length > 1 ? ` (${detail.roomNumbers.length} phòng)` : ""}</span>
                  <span className="font-medium text-[var(--cb-text)]">{n.price === null ? "Chưa có giá" : `${fmt(n.price)}₫`}</span>
                </div>
              ))
            ) : (
              Array.from({ length: detailNights }, (_, i) => {
                const base = Math.floor(detail.totalAmount / Math.max(1, detailNights));
                const amount = i === detailNights - 1 ? detail.totalAmount - base * (detailNights - 1) : base;
                return (
                  <div key={i} className="flex justify-between gap-3">
                    <span className="text-[var(--cb-muted)]">Tiền phòng — đêm {fmtDate(addDays(detail.checkIn, i))}{detail.roomNumbers.length > 1 ? ` (${detail.roomNumbers.length} phòng)` : ""}</span>
                    <span className="font-medium text-[var(--cb-text)]">{fmt(amount)}₫</span>
                  </div>
                );
              })
            )}
            {detailExtras.map((f) => (
              <div key={f.id} className="flex items-center justify-between gap-3">
                <span className="text-[var(--cb-muted)]">{f.label} — {fmtDate(f.date)}</span>
                <span className="flex items-center gap-2">
                  <span className="font-medium text-[var(--cb-text)]">{fmt(f.amount)}₫</span>
                  <button onClick={() => deleteExtra(f.id)} className="text-[#e5484d]" title="Xoá khoản này">✕</button>
                </span>
              </div>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input value={extraLabel} onChange={(e) => setExtraLabel(e.target.value)} placeholder="Dịch vụ thêm: giặt ủi, minibar..." className="min-w-0 flex-1 rounded-lg border border-[var(--cb-border)] px-2 py-2 text-sm outline-none focus:border-[var(--cb-blue)]" />
            <input type="number" value={extraAmount || ""} onChange={(e) => setExtraAmount(Number(e.target.value))} placeholder="Số tiền" className="w-28 rounded-lg border border-[var(--cb-border)] px-2 py-2 text-sm outline-none focus:border-[var(--cb-blue)]" />
            <button onClick={addExtra} className="cb-btn-ghost px-3 py-2 text-sm">+ Thêm</button>
          </div>
          <div className="mt-3 space-y-1.5 border-t border-[var(--cb-bg)] pt-3">
            <div className="flex justify-between"><span className="text-[var(--cb-muted)]">Tổng phải thu (phòng + dịch vụ)</span><span className="font-semibold text-[var(--cb-text)]">{fmt(totalDue)}₫</span></div>
            <div className="flex justify-between"><span className="text-[var(--cb-muted)]">Đã thanh toán{detail.paymentCollector === "channel_collect" ? " (kênh thu hộ)" : ""}</span><span className="font-semibold text-[var(--cb-text)]">{fmt(detail.paidAmount)}₫</span></div>
            <div className="flex justify-between"><span className="font-semibold text-[var(--cb-text)]">Còn nợ</span><span className={`font-bold ${balance > 0 ? "text-[#e5484d]" : "text-[#1db584]"}`}>{balance > 0 ? fmt(balance) + "₫" : "Đã thanh toán đủ"}</span></div>
            {detail.totalAmount === 0 && detailNights > 0 && !["cancelled", "no_show"].includes(detail.status) && (
              <p className="rounded-lg bg-[#fdf3e3] px-3 py-2 text-xs text-[#9a6a12]">⚠ Tổng đơn đang là 0₫ — có thể do chưa nhập giá cho các đêm này ở Lịch giá. Kiểm tra giá theo kênh rồi sửa đơn.</p>
            )}
          </div>
          {balance > 0 && detail.paymentCollector === "hotel_collect" && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <input type="number" value={payAmount || ""} onChange={(e) => setPayAmount(Number(e.target.value))} placeholder="Số tiền khách trả" className="w-36 rounded-lg border border-[var(--cb-border)] px-2 py-2 text-sm outline-none focus:border-[var(--cb-blue)]" />
              <select value={payMethod} onChange={(e) => setPayMethod(e.target.value)} className="rounded-lg border border-[var(--cb-border)] px-2 py-2 text-sm outline-none">
                <option>Tiền mặt</option>
                <option>Chuyển khoản</option>
                <option>Thẻ</option>
              </select>
              <button onClick={recordPayment} className="cb-btn-primary px-3 py-2 text-sm">Ghi nhận thanh toán ({payMethod})</button>
            </div>
          )}
          {detail.paymentCollector === "channel_collect" && (
            <p className="mt-2 text-xs text-[var(--cb-muted)]">Đơn này do kênh thu hộ tiền của khách — khách sạn nhận tiền từ kênh sau, không thu thêm tại quầy.</p>
          )}
        </div>
      )}

      {/* ---------- tab Khach ---------- */}
      {tab === "guest" && (
        <div className="cb-card mt-4 p-5 text-sm">
          <div className="text-base font-bold text-[var(--cb-text)]">Thông tin khách</div>
          <div className="mt-3 space-y-2">
            <DetailRow label="Họ tên" value={detail.guestName} />
            <DetailRow label="Số điện thoại" value={detail.guestPhone || "—"} />
            <DetailRow label="Email" value="— (chưa lưu — cần thêm cột email, làm cùng bước Payment)" />
            <DetailRow label="Số khách" value={`${detail.adults ?? detail.guests} người lớn${(detail.children ?? 0) > 0 ? `, ${detail.children} trẻ em` : ""}`} />
            <DetailRow label="Nguồn đơn" value={getChannelName(detail.channelCode)} />
            {detail.note && <DetailRow label="Ghi chú" value={detail.note} />}
          </div>
          <button onClick={openEdit} className="cb-btn-primary mt-4 px-4 py-2 text-sm">Sửa thông tin khách</button>
        </div>
      )}

      {/* ---------- tab The ---------- */}
      {tab === "cards" && (
        <div className="cb-card mt-4 p-5 text-sm">
          <div className="text-base font-bold text-[var(--cb-text)]">Thẻ thanh toán</div>
          <p className="mt-3 rounded-lg bg-[var(--cb-bg)] px-3 py-3 text-[var(--cb-muted)]">
            Chưa lưu thẻ cho đơn này — tính năng lưu thẻ sẽ làm cùng bước Payment (thu tiền đặt cọc / thanh toán online), không lưu số thẻ vào cơ sở dữ liệu.
          </p>
        </div>
      )}

      {/* ---------- tab Ghi chu ---------- */}
      {tab === "notes" && (
        <div className="cb-card mt-4 p-5 text-sm">
          <div className="text-base font-bold text-[var(--cb-text)]">Ghi chú ({allNotes.length})</div>
          {allNotes.length === 0 ? (
            <p className="mt-3 rounded-lg bg-[var(--cb-bg)] px-3 py-3 text-[var(--cb-muted)]">Chưa có ghi chú nào cho đơn này.</p>
          ) : (
            <div className="mt-3 space-y-3">
              {allNotes.map((n) => (
                <div key={n.id} className="rounded-xl border border-[var(--cb-border)] px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--cb-muted)]">
                    <b className="text-[var(--cb-text)]">{n.author}</b>
                    {n.createdAt && <span>{fmtDate(n.createdAt.slice(0, 10))}</span>}
                  </div>
                  <p className="mt-1 whitespace-pre-wrap text-[var(--cb-text)]">{n.body}</p>
                </div>
              ))}
            </div>
          )}
          <div className="mt-4">
            <textarea
              value={noteBody}
              onChange={(e) => setNoteBody(e.target.value)}
              placeholder="Ghi chú cho ca sau: khách đến muộn, cần thêm khăn..."
              rows={3}
              className="w-full rounded-lg border border-[var(--cb-border)] px-3 py-2 text-sm outline-none focus:border-[var(--cb-blue)]"
            />
            <button onClick={addNote} className="cb-btn-primary mt-2 px-4 py-2 text-sm">+ Thêm ghi chú</button>
          </div>
        </div>
      )}

      {/* ---------- tab Tai lieu ---------- */}
      {tab === "docs" && (
        <div className="cb-card mt-4 p-5 text-sm">
          <div className="text-base font-bold text-[var(--cb-text)]">Tài liệu</div>
          <p className="mt-3 rounded-lg bg-[var(--cb-bg)] px-3 py-3 text-[var(--cb-muted)]">
            Chưa tải được tài liệu lên cho đơn này — cần kho lưu trữ file, sẽ làm sau (cùng đợt với tải ảnh khách sạn).
          </p>
        </div>
      )}

      {/* ---------- tab Hoat dong ---------- */}
      {tab === "activity" && (
        <div className="cb-card mt-4 p-5 text-sm">
          <div className="text-base font-bold text-[var(--cb-text)]">Hoạt động của đơn</div>
          <p className="mt-3 rounded-lg bg-[var(--cb-bg)] px-3 py-3 text-[var(--cb-muted)]">
            Chưa có nhật ký thao tác cho đơn này — nhật ký (ai sửa giá, huỷ đơn, đóng phòng lúc nào) sẽ làm ngày 19–20/11, trước buổi họp test giai đoạn 1.
          </p>
        </div>
      )}

      {/* ---------- tab Email ---------- */}
      {tab === "email" && (
        <div className="cb-card mt-4 p-5 text-sm">
          <div className="text-base font-bold text-[var(--cb-text)]">Email đã gửi</div>
          <p className="mt-3 rounded-lg bg-[var(--cb-bg)] px-3 py-3 text-[var(--cb-muted)]">
            Chưa gửi email nào cho đơn này — khách sạn liên hệ khách qua điện thoại. Hạ tầng gửi email sẽ làm sau.
          </p>
        </div>
      )}
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-[var(--cb-muted)]">{label}</span>
      <span className="text-right font-medium text-[var(--cb-text)]">{value}</span>
    </div>
  );
}
