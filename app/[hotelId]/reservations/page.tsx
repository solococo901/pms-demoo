"use client";
// ============================================================
// FILE 8a — app/reservations/page.tsx (Cloudbeds style)
// The reservations LIST page, following the Cloudbeds layout
// (screenshot from Vos, 2026-10-21):
//   header + export/print -> search -> count + bulk action +
//   filter chips -> table -> pagination
//
// Same data as the Calendar page, different view:
// calendar = "by day, to arrange rooms", list = "to search,
// filter and process many bookings at once".
// Logic unchanged from the first version — colors only.
// RESLAYOUT1 (2026-11-17): restyle giong Cloudbeds that — tieu de lon,
// nut icon vuong, card vien xanh tren, search co kinh lup + nut loc,
// chip loc xam, thead trang, highlight ma don trung tim kiem.
// Chi doi giao dien, khong doi logic (loc, sap xep, bulk, drawer).
// ============================================================

import { useEffect, useMemo, useState } from "react";
import {
  CHANNELS,
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
import { useParams } from "next/navigation";

// Round B: this page reads/writes the REAL database. Until the
// Auth step (Buoc 5), the app works as the demo account on the
// pilot hotel; after Auth these two constants come from the
// signed-in user instead.
const ACCOUNT_ID = "11111111-1111-1111-1111-111111111111";
import Link from "next/link";
import { STATUS_LABELS, STATUS_STYLES } from "@/components/ReservationBar";
import { DatePicker } from "@/components/DatePicker";
import { IconDownload, IconFileText, IconPrinter, IconReceipt, IconSearch, IconSliders } from "@/components/icons";
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

type SortKey = "guestName" | "checkIn" | "totalAmount" | "createdAt";
type Note = { id: string; author: string; body: string; createdAt: string };

export default function ReservationsPage() {
  // Khach san lay tu URL /h/[hotelId] khi co; neu khong (duong dan cu)
  // thi dung khach san da luu theo tab.
  const params = useParams();
  const HOTEL_ID = typeof params.hotelId === "string" ? params.hotelId : currentHotelId();
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [channelFilter, setChannelFilter] = useState<string>("all");
  const [roomTypeFilter, setRoomTypeFilter] = useState<string>("all");
  const [checkInFilter, setCheckInFilter] = useState<string>("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sortKey, setSortKey] = useState<SortKey>("createdAt");
  const [sortAsc, setSortAsc] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(5);
  const [bulkAction, setBulkAction] = useState<"export" | "cancel">("export");
  const [showFilters, setShowFilters] = useState(true);

  // ---------- reservation detail + folio ----------
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<"stay" | "folio" | "notes">("stay");
  const [detailNotes, setDetailNotes] = useState<Note[]>([]);
  const [noteDraft, setNoteDraft] = useState("");
  const [folioItems, setFolioItems] = useState<FolioItem[]>([]);
  const [extraLabel, setExtraLabel] = useState("");
  const [extraAmount, setExtraAmount] = useState<number>(0);
  const [payAmount, setPayAmount] = useState<number>(0);
  const [payMethod, setPayMethod] = useState("Tiền mặt");

  // Catalog cua khach san dang chon — nap tu DB cho form tao don
  const [catalog, setCatalog] = useState<{ roomTypes: RoomType[]; ratePlans: RatePlan[]; rooms: Room[] }>({
    roomTypes: [],
    ratePlans: [],
    rooms: [],
  });

  // Ngay hom nay that (tinh o client, sau khi mount) — dung cho kiem tra
  // ngay qua khu va ngay cua khoan dich vu them vao folio.
  const [todayStr, setTodayStr] = useState("");
  useEffect(() => {
    setTodayStr(localToday());
  }, []);

  // Chan phong (OOO tru khoi ton ban duoc) + dong ban theo kenh — phuc vu
  // bo kiem tra dung chung khi sua/gia han/doi trang thai.
  const [roomBlocks, setRoomBlocks] = useState<RoomBlock[]>([]);
  const [invBlocks, setInvBlocks] = useState<InventoryBlock[]>([]);
  // Gia rieng cua goi ke thua (gia luu khac gia tinh theo cong thuc).
  const [priceOverrides, setPriceOverrides] = useState<Record<string, number>>({});

  // Du lieu dung chung cho bo kiem tra: phong + don + chan phong + dong ban.
  const availData: AvailabilityData = useMemo(
    () => ({ rooms: catalog.rooms, reservations, blocks: roomBlocks, invBlocks }),
    [catalog.rooms, reservations, roomBlocks, invBlocks],
  );

  // Ten loai phong that tu catalog (khong dung bang mau).
  const roomTypeName = (id: string) => catalog.roomTypes.find((t) => t.id === id)?.name ?? id;

  const detail = reservations.find((r) => r.id === detailId) ?? null;
  const detailNights = detail ? nightsOf(detail) : 0;
  const detailExtras = detail ? folioItems.filter((f) => f.reservationId === detail.id) : [];
  const extrasTotal = detailExtras.reduce((a, f) => a + f.amount, 0);
  const totalDue = detail ? detail.totalAmount + extrasTotal : 0;
  const balance = detail ? totalDue - detail.paidAmount : 0;
  // Ghi chu cu o cot note cua don (neu co) hien nhu 1 ghi chu dau tien.
  const detailAllNotes: Note[] = detail?.note
    ? [{ id: "legacy", author: "Ghi chú đơn", body: detail.note, createdAt: "" }, ...detailNotes]
    : detailNotes;

  // Mo panel chi tiet kieu Cloudbeds: ten khach -> tab Cho o,
  // icon Ghi chu / Folio o bang -> mo thang tab do.
  function openDetail(id: string, tab: "stay" | "folio" | "notes") {
    setDetailId(id);
    setDetailTab(tab);
    setEditing(false);
    setExtending(false);
  }

  // Ghi chu cua don dang mo trong panel — nap khi doi don.
  useEffect(() => {
    if (!detailId) { setDetailNotes([]); return; }
    (async () => {
      const { data } = await supabase
        .from("reservation_notes")
        .select("id, author, body, created_at")
        .eq("reservation_id", detailId)
        .order("created_at", { ascending: true });
      setDetailNotes((data ?? []).map((n) => ({ id: n.id, author: n.author, body: n.body, createdAt: n.created_at })));
    })();
  }, [detailId]);

  async function addDetailNote() {
    if (!detail || !noteDraft.trim()) return;
    const { data: userData } = await supabase.auth.getUser();
    const author = userData.user?.email ?? "Lễ tân";
    const { data, error } = await supabase
      .from("reservation_notes")
      .insert({ hotel_id: HOTEL_ID, account_id: ACCOUNT_ID, reservation_id: detail.id, author, body: noteDraft.trim() })
      .select("id, author, body, created_at")
      .single();
    if (error || !data) return alert("Lưu ghi chú không thành công: " + (error?.message ?? ""));
    setDetailNotes((prev) => [...prev, { id: data.id, author: data.author, body: data.body, createdAt: data.created_at }]);
    setNoteDraft("");
  }
  // Gia that tung dem cua don dang mo (dung cho folio) — neu goi gia
  // khong con hoac co dem chua co gia thi folio dung cach chia deu cu.
  const detailPlan = detail ? catalog.ratePlans.find((p) => p.id === detail.ratePlanId) : undefined;
  const detailBreakdown =
    detail && detailPlan
      ? priceBreakdown(detailPlan, catalog.ratePlans, detail.checkIn, detail.checkOut, detail.adults ?? detail.guests, detail.children ?? 0, priceOverrides)
      : null;

  // ---------- load everything from Supabase on open ----------
  useEffect(() => {
    (async () => {
      const [res, rr, folio, typesRes, roomsRes, plansRes, blocksRes, invRes] = await Promise.all([
        supabase.from("reservations").select("*").eq("hotel_id", HOTEL_ID).order("booked_at", { ascending: false }),
        supabase.from("reservation_rooms").select("reservation_id, room_number"),
        supabase.from("folio_items").select("*").eq("hotel_id", HOTEL_ID),
        supabase.from("room_types").select("*").eq("hotel_id", HOTEL_ID),
        supabase.from("rooms").select("*").eq("hotel_id", HOTEL_ID),
        supabase.from("rate_plans").select("*").eq("hotel_id", HOTEL_ID),
        supabase.from("room_blocks").select("*").eq("hotel_id", HOTEL_ID),
        supabase.from("inventory_blocks").select("*").eq("hotel_id", HOTEL_ID),
      ]);
      if (res.error || rr.error || folio.error) {
        setLoadError((res.error ?? rr.error ?? folio.error)?.message ?? "Không đọc được dữ liệu");
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
      // Chan phong + dong ban khong lam hong trang neu doc loi — chi mat kiem tra.
      setRoomBlocks((blocksRes.data ?? []).map((b) => ({
        id: b.id, roomNumber: b.room_number, from: b.from_date, to: b.to_date,
        kind: b.kind, reason: b.reason ?? "",
      })));
      setInvBlocks((invRes.data ?? []).map((b) => ({
        id: b.id, scope: b.scope, channelCode: b.channel_code ?? undefined,
        roomTypeId: b.room_type_id, from: b.from_date, to: b.to_date,
        reason: b.reason ?? undefined,
      })));
      // Catalog cho form tao don: loai phong / phong / goi gia + bang gia
      let priceRows: { rate_plan_id: string; date: string; price: number }[] = [];
      if ((plansRes.data ?? []).length > 0) {
        // Supabase tra toi da 1000 dong/lan — phai lay theo trang
        for (let from = 0; ; from += 1000) {
          const { data: page } = await supabase
            .from("rate_prices")
            .select("rate_plan_id, date, price")
            .in("rate_plan_id", (plansRes.data ?? []).map((p) => p.id))
            .range(from, from + 999);
          priceRows = [...priceRows, ...(page ?? [])];
          if (!page || page.length < 1000) break;
        }
      }
      const dbPlans: RatePlan[] = (plansRes.data ?? []).map((p) => {
        const prices: Record<string, number> = {};
        for (const pr of priceRows) if (pr.rate_plan_id === p.id) prices[pr.date] = pr.price;
        return {
          id: p.id, channelCode: p.channel_code, roomTypeId: p.room_type_id,
          name: p.name, publicName: p.public_name ?? undefined,
          mealPlan: p.meal_plan as RatePlan["mealPlan"],
          baseOccupancy: p.base_occupancy,
          extraAdultFee: p.extra_adult_fee, extraChildFee: p.extra_child_fee,
          cancellationPolicy: p.cancellation_policy as RatePlan["cancellationPolicy"],
          derivedFromId: p.derived_from_id ?? undefined,
          formulaId: p.formula_id ?? undefined, prices,
        };
      });
      // Gia rieng cua goi ke thua (gia luu khac gia tinh theo cong thuc).
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
  }, []);

  // Save a change to a reservation: database first, screen after.
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
    // roomNumbers khong co cot trong reservations — phong gan nam o
    // reservation_rooms, ben goi tu lo truoc khi goi ham nay.
    const { error } = await supabase.from("reservations").update(dbPatch).eq("id", id);
    if (error) {
      alert("Lưu xuống cơ sở dữ liệu không thành công: " + error.message);
      return false;
    }
    setReservations((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    // Doi trang thai HOAC doi ngay deu lam ton phong Channex thay doi:
    // day ca khoang ngay cu (duoc tra lai) + khoang ngay moi.
    if (patch.status !== undefined || patch.checkIn !== undefined || patch.checkOut !== undefined) {
      const r = reservations.find((x) => x.id === id);
      if (r) {
        const dates = new Set([...stayDates(r.checkIn, r.checkOut), ...stayDates(patch.checkIn ?? r.checkIn, patch.checkOut ?? r.checkOut)]);
        queueChannexDates([...dates]);
      }
    }
    return true;
  }

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
    // Khong thu qua so con no (kieu Cloudbeds: thanh toan khong vuot balance).
    const check = validatePayment(payAmount, balance);
    if (!check.ok) return alert(check.error);
    patchReservation(detail.id, { paidAmount: detail.paidAmount + payAmount });
    setPayAmount(0);
  }

  // ---------- sua don + gia han (mo trong drawer chi tiet) ----------
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
  }

  // Cac gia tri dan xuat cho form sua (chi co nghia khi drawer dang mo).
  const editType = catalog.roomTypes.find((t) => t.id === eType);
  const editPlans = catalog.ratePlans.filter((p) => p.channelCode === detail?.channelCode && p.roomTypeId === eType);
  const editPlan = editPlans.find((p) => p.id === ePlan) ?? editPlans[0];
  const editNights = Math.max(0, Math.round((toTime(eCheckOut) - toTime(eCheckIn)) / DAY_MS));
  // Tong sau khi sua = gia that tung dem + phu thu them khach (co gia rieng goi ke thua).
  const editBreakdown =
    editPlan && editNights > 0
      ? priceBreakdown(editPlan, catalog.ratePlans, eCheckIn, eCheckOut, eAdults, eChildren, priceOverrides)
      : null;
  const editTotal = editBreakdown ? editBreakdown.grandTotal : 0;

  // Doi trang thai don — chay qua bo kiem tra dung chung truoc khi luu
  // (kieu Cloudbeds: nhan phong bi chan khi chua gan phong / phong hong;
  // tra phong canh bao khi con no; huy chi don cho / da xac nhan).
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

  async function saveEdit() {
    if (!detail) return;
    if (!eName.trim()) return setEditError("Chưa nhập tên khách.");
    // Don da tra phong / da huy / khach khong den thi khong sua duoc.
    const editable = canEdit(detail);
    if (!editable.ok) return setEditError(editable.error ?? "Không sửa được đơn này.");
    // Chay lai toan bo kiem tra nhu tao don moi: ngay + khach + gia du
    // cac dem + tong > 0 + con ton (tru chinh don dang sua ra).
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
  }

  const extNights = detail ? Math.max(0, Math.round((toTime(extCheckOut) - toTime(detail.checkOut)) / DAY_MS)) : 0;
  const extPlan = detail ? catalog.ratePlans.find((p) => p.id === detail.ratePlanId) : undefined;
  // Tong moi = tong cu + tien cac dem them (gia goi theo ngay + phu thu khach them).
  const extAdded =
    detail && extPlan && Number.isFinite(extNights) && extNights > 0
      ? priceBreakdown(extPlan, catalog.ratePlans, detail.checkOut, extCheckOut, detail.adults ?? detail.guests, detail.children ?? 0, priceOverrides).grandTotal
      : 0;
  const extTotal = detail ? detail.totalAmount + extAdded : 0;

  async function saveExtend() {
    if (!detail) return;
    if (!extCheckOut) return setExtError("Chưa chọn ngày đi mới.");
    if (!extPlan) return setExtError("Không tìm thấy gói giá của đơn này — không tính được tiền các đêm thêm.");
    // Chi kiem tra cac dem them (khoang ngay cu don nay dang giu nguyen):
    // ngay di moi + con ton + co gia cac dem them.
    const check = validateExtend(availData, detail, extCheckOut, extPlan, catalog.ratePlans, priceOverrides, detail.channelCode);
    if (!check.ok) return setExtError(check.error ?? "Không gia hạn được.");
    if (check.warnings.length > 0 && !window.confirm(`${check.warnings.join("\n")}\nVẫn gia hạn?`)) return;
    const ok = await patchReservation(detail.id, { checkOut: extCheckOut, totalAmount: extTotal });
    if (ok) setExtending(false);
  }

  // ---------- filtering + sorting ----------
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = reservations.filter((r) => {
      if (q && !`${r.guestName} ${r.guestPhone} ${r.id}`.toLowerCase().includes(q)) return false;
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (channelFilter !== "all" && r.channelCode !== channelFilter) return false;
      if (roomTypeFilter !== "all" && r.roomTypeId !== roomTypeFilter) return false;
      if (checkInFilter && r.checkIn !== checkInFilter) return false;
      return true;
    });
    list.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      const cmp = typeof av === "number" ? av - (bv as number) : String(av).localeCompare(String(bv));
      return sortAsc ? cmp : -cmp;
    });
    return list;
  }, [reservations, query, statusFilter, channelFilter, roomTypeFilter, checkInFilter, sortKey, sortAsc]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pageRows = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortAsc((v) => !v);
    else {
      setSortKey(key);
      setSortAsc(true);
    }
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function resetFilters() {
    setQuery("");
    setStatusFilter("all");
    setChannelFilter("all");
    setRoomTypeFilter("all");
    setCheckInFilter("");
    setPage(1);
  }

  // ---------- CSV export (really downloads a file) ----------
  function exportCsv(rows: Reservation[]) {
    const header = "Reservation,Guest,Phone,Date Booked,Rooms,Room Type,Check-In,Check-Out,Nights,Total,Status,Source";
    const lines = rows.map((r) =>
      [r.id, r.guestName, r.guestPhone, fmtDate(r.createdAt), r.roomNumbers.join(" ") || "-", roomTypeName(r.roomTypeId),
        fmtDate(r.checkIn), fmtDate(r.checkOut), nightsOf(r), r.totalAmount, STATUS_LABELS[r.status], getChannelName(r.channelCode)
      ].join(",")
    );
    const blob = new Blob(["\ufeff" + [header, ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "reservations.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function applyBulk() {
    const rows = reservations.filter((r) => selected.has(r.id));
    if (rows.length === 0) return alert("Chưa tick chọn đơn nào.");
    if (bulkAction === "export") exportCsv(rows);
    else {
      // Chi huy duoc don cho xac nhan / da xac nhan — don dang o / da tra
      // phong duoc bo qua (kieu Cloudbeds: khong huy don dang o).
      const okRows = rows.filter((r) => canCancel(r).ok);
      const skipped = rows.length - okRows.length;
      if (okRows.length === 0)
        return alert("Không huỷ được đơn nào trong các đơn đã chọn (chỉ huỷ được đơn chờ xác nhận / đã xác nhận).");
      if (!window.confirm(`Huỷ ${okRows.length} đơn đã chọn?${skipped > 0 ? ` ${skipped} đơn đang ở / đã trả phòng sẽ được bỏ qua.` : ""}`)) return;
      const { error } = await supabase.from("reservations").update({ status: "cancelled" }).in("id", okRows.map((r) => r.id));
      if (error) return alert("Huỷ đơn trên cơ sở dữ liệu không thành công: " + error.message);
      setReservations((prev) =>
        prev.map((r) => (okRows.some((x) => x.id === r.id) ? { ...r, status: "cancelled" as ReservationStatus } : r))
      );
      queueChannexDates(okRows.flatMap((r) => stayDates(r.checkIn, r.checkOut)));
      setSelected(new Set());
    }
  }

  const filtersActive = statusFilter !== "all" || channelFilter !== "all" || roomTypeFilter !== "all" || checkInFilter !== "";
  const chipCls = "rounded-full border border-[var(--cb-border)] bg-[#f1f5f9] px-3 py-1.5 text-xs font-medium text-[var(--cb-text)]";
  const thCls = "whitespace-nowrap px-3 py-3 text-left text-xs font-semibold text-[var(--cb-muted)] cursor-pointer select-none";

  return (
    <div>
      {/* header row — Cloudbeds: big bold title, square icon actions right.
          Khong co nut Tao dat phong o day — tao don chi bang dau + tren thanh tren
          (giong Cloudbeds), mo trang tao don 5 buoc. */}
      <div className="flex items-center justify-between">
        <h1 className="text-[28px] font-extrabold tracking-tight text-[var(--cb-text)]">Đặt phòng</h1>
        <div className="flex items-center gap-2">
          <button onClick={() => exportCsv(filtered)} className="flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--cb-border)] bg-white text-base text-[var(--cb-text)] shadow-sm hover:bg-[var(--cb-bg)]" title="Xuất toàn bộ danh sách đang lọc ra file CSV"><IconDownload className="h-4 w-4" /></button>
          <button onClick={() => window.print()} className="flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--cb-border)] bg-white text-base text-[var(--cb-text)] shadow-sm hover:bg-[var(--cb-bg)]" title="In danh sách"><IconPrinter className="h-4 w-4" /></button>
        </div>
      </div>

      {loading && <p className="mt-4 text-sm text-[var(--cb-muted)]">Đang tải dữ liệu từ Supabase...</p>}
      {loadError && <p className="mt-4 text-sm text-[#e5484d]">Không đọc được dữ liệu từ Supabase: {loadError}</p>}

      <div className="cb-card mt-5 overflow-hidden border-t-4 border-t-[var(--cb-blue)] p-5">
        {/* search — Cloudbeds: magnifier inside, clear button, filter toggle */}
        <div className="flex items-center gap-2">
          <div className="relative w-full max-w-md">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--cb-muted)]"><IconSearch className="h-4 w-4" /></span>
            <input
              value={query}
              onChange={(e) => { setQuery(e.target.value); setPage(1); }}
              placeholder="Tìm theo tên khách, email, số điện thoại, mã đơn..."
              className="w-full rounded-lg border border-[var(--cb-border)] py-2 pl-9 pr-8 text-sm text-[var(--cb-text)] outline-none focus:border-[var(--cb-blue)]"
            />
            {query && (
              <button onClick={() => { setQuery(""); setPage(1); }} className="absolute right-2 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full text-xs text-[var(--cb-muted)] hover:bg-[var(--cb-bg)]" title="Xoá tìm kiếm">✕</button>
            )}
          </div>
          <button onClick={() => setShowFilters((v) => !v)} className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[var(--cb-border)] bg-white text-base text-[var(--cb-text)] shadow-sm hover:bg-[var(--cb-bg)]" title="Hiện / ẩn bộ lọc">
            <IconSliders className="h-4 w-4" />
            {filtersActive && <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-[var(--cb-blue)]" />}
          </button>
        </div>

        {/* count + bulk action — Cloudbeds: bold count, blue Bulk Action pill */}
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <span className="text-base font-bold text-[var(--cb-text)]">{filtered.length} đặt phòng</span>
          <span className="mx-1 hidden h-5 w-px bg-[var(--cb-border)] sm:block" />
          <select value={bulkAction} onChange={(e) => setBulkAction(e.target.value as typeof bulkAction)} className="rounded-full bg-[var(--cb-blue)] px-4 py-2 text-xs font-semibold text-white outline-none">
            <option value="export">Bulk Action: Xuất file các đơn đã chọn</option>
            <option value="cancel">Bulk Action: Huỷ các đơn đã chọn</option>
          </select>
          <button onClick={applyBulk} className="rounded-full bg-[var(--cb-blue)] px-4 py-2 text-xs font-semibold text-white hover:bg-[#1e4fd8]">Thực hiện ({selected.size})</button>
        </div>

        {/* filter chips — Cloudbeds: one row of grey pills */}
        {showFilters && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className={chipCls}>
              <option value="all">Trạng thái: Tất cả</option>
              {(Object.keys(STATUS_LABELS) as ReservationStatus[]).map((s) => (
                <option key={s} value={s}>{STATUS_LABELS[s]}</option>
              ))}
            </select>
            <select value={channelFilter} onChange={(e) => setChannelFilter(e.target.value)} className={chipCls}>
              <option value="all">Nguồn: Tất cả</option>
              {CHANNELS.map((c) => (<option key={c.code} value={c.code}>{c.name}</option>))}
            </select>
            <select value={roomTypeFilter} onChange={(e) => setRoomTypeFilter(e.target.value)} className={chipCls}>
              <option value="all">Loại phòng: Tất cả</option>
              {catalog.roomTypes.map((t) => (<option key={t.id} value={t.id}>{t.name}</option>))}
            </select>
            <DatePicker value={checkInFilter} onChange={(v) => { setCheckInFilter(v); setPage(1); }} placeholder="Ngày đến" clearable variant="chip" />
            <button onClick={resetFilters} className="rounded-full bg-[var(--cb-bg)] px-3 py-1.5 text-xs font-medium text-[var(--cb-text)] hover:bg-[#e8edf3]">Reset Filters</button>
          </div>
        )}

        {/* table — Cloudbeds: clean white header, grey semibold labels */}
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[1050px] text-sm text-[var(--cb-text)]">
            <thead className="border-b-2 border-[var(--cb-border)] bg-white">
              <tr>
                <th className="px-3 py-3"><input type="checkbox" className="accent-[var(--cb-blue)]" checked={pageRows.length > 0 && pageRows.every((r) => selected.has(r.id))} onChange={(e) => {
                  setSelected((prev) => {
                    const next = new Set(prev);
                    pageRows.forEach((r) => (e.target.checked ? next.add(r.id) : next.delete(r.id)));
                    return next;
                  });
                }} /></th>
                <th className={thCls}>Reservation</th>
                <th className={thCls} onClick={() => toggleSort("guestName")}>Tên khách ⇅</th>
                <th className={thCls} onClick={() => toggleSort("createdAt")}>Ngày đặt ⇅</th>
                <th className={thCls}>Số phòng</th>
                <th className={thCls}>Loại phòng</th>
                <th className={thCls} onClick={() => toggleSort("checkIn")}>Check-In ⇅</th>
                <th className={thCls}>Check-Out</th>
                <th className={thCls}>Đêm</th>
                <th className={thCls} onClick={() => toggleSort("totalAmount")}>Tổng tiền ⇅</th>
                <th className={thCls}>Trạng thái</th>
                <th className={thCls}>Nguồn</th>
                <th className={thCls}>Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((r) => (
                <tr key={r.id} className="border-t border-[var(--cb-bg)] hover:bg-[var(--cb-blue-soft)]">
                  <td className="px-3 py-3"><input type="checkbox" className="accent-[var(--cb-blue)]" checked={selected.has(r.id)} onChange={() => toggleSelect(r.id)} /></td>
                  <td className="px-3 py-3 font-medium">
                    <span className={query.trim() && r.id.toLowerCase().includes(query.trim().toLowerCase()) ? "rounded bg-[#fef3c7] px-1 py-0.5" : ""}>{r.id}</span>
                  </td>
                  <td className="px-3 py-3 font-medium text-[var(--cb-blue)] cursor-pointer hover:underline" title="Bấm để mở bảng chi tiết" onClick={() => openDetail(r.id, "stay")}>{r.guestName}</td>
                  <td className="px-3 py-3">{fmtDate(r.createdAt)}</td>
                  <td className="px-3 py-3">{r.roomNumbers.join(", ") || "—"}</td>
                  <td className="px-3 py-3">{roomTypeName(r.roomTypeId)}</td>
                  <td className="px-3 py-3">{fmtDate(r.checkIn)}</td>
                  <td className="px-3 py-3">{fmtDate(r.checkOut)}</td>
                  <td className="px-3 py-3">{nightsOf(r)}</td>
                  <td className="px-3 py-3">
                    ₫{fmt(r.totalAmount)}
                    {r.totalAmount === 0 && nightsOf(r) > 0 && !["cancelled", "no_show"].includes(r.status) && (
                      <span className="ml-1.5 whitespace-nowrap rounded-full bg-[#fdf3e3] px-2 py-0.5 text-xs font-semibold text-[#9a6a12]" title="Tổng 0₫ — có thể do chưa nhập giá cho các đêm này ở Lịch giá. Kiểm tra giá theo kênh rồi sửa đơn.">⚠ chưa có giá</span>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    <span className={`mr-1.5 inline-block h-2.5 w-2.5 rounded-full ${STATUS_STYLES[r.status].split(" ")[0]}`} />
                    {STATUS_LABELS[r.status]}
                  </td>
                  <td className="px-3 py-3 text-[var(--cb-muted)]">
                    {getChannelName(r.channelCode)}
                    {["booking_com", "agoda", "expedia", "airbnb"].includes(r.channelCode) && (
                      <span className="text-[var(--cb-muted)]"> ({r.paymentCollector === "channel_collect" ? "Channel Collect" : "Hotel Collect"})</span>
                    )}
                    {r.channelCode === "frontdesk" && <span className="text-[var(--cb-muted)]"> (Walk-In)</span>}
                    {r.channelCode === "website" && <span className="text-[var(--cb-muted)]"> (Booking Engine)</span>}
                  </td>
                  <td className="px-3 py-3">
                    <span className="flex gap-1">
                      <button onClick={() => openDetail(r.id, "notes")} className="flex h-7 w-7 items-center justify-center rounded-md border border-[var(--cb-border)] bg-white text-sm hover:bg-[var(--cb-bg)]" title="Ghi chú — mở bảng chi tiết ở tab Ghi chú"><IconFileText className="h-4 w-4" /></button>
                      <button onClick={() => openDetail(r.id, "folio")} className="flex h-7 w-7 items-center justify-center rounded-md border border-[var(--cb-border)] bg-white text-sm hover:bg-[var(--cb-bg)]" title="Folio — mở bảng chi tiết ở tab Folio"><IconReceipt className="h-4 w-4" /></button>
                    </span>
                  </td>
                </tr>
              ))}
              {pageRows.length === 0 && (
                <tr><td colSpan={13} className="px-3 py-10 text-center text-[var(--cb-muted)]">Không có đơn nào khớp bộ lọc.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* pagination — Cloudbeds: "Showing X to Y of Z entries • View up to N" */}
        <div className="mt-4 flex flex-wrap items-center justify-end gap-2 border-t border-[var(--cb-bg)] pt-3 text-xs text-[var(--cb-muted)]">
          <span>
            Hiển thị {filtered.length === 0 ? 0 : (currentPage - 1) * pageSize + 1}–{Math.min(currentPage * pageSize, filtered.length)} trong {filtered.length} đơn • Mỗi trang
          </span>
          <select value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }} className="rounded-md border border-[var(--cb-border)] bg-white px-1.5 py-1 font-medium text-[var(--cb-text)]">
            {[5, 10, 20].map((n) => (<option key={n} value={n}>{n}</option>))}
          </select>
          <span className="flex h-7 w-7 items-center justify-center rounded-md border border-[var(--cb-border)] bg-white font-semibold text-[var(--cb-blue)]">{currentPage}</span>
          <button disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)} className="flex h-7 w-7 items-center justify-center rounded-md border border-[var(--cb-border)] bg-white disabled:opacity-40">‹</button>
          <button disabled={currentPage >= pageCount} onClick={() => setPage(currentPage + 1)} className="flex h-7 w-7 items-center justify-center rounded-md border border-[var(--cb-border)] bg-white disabled:opacity-40">›</button>
        </div>
      </div>

      {/* ---------- reservation detail drawer + folio ---------- */}
      {detail && (
        <>
          <div className="fixed inset-0 z-20 bg-[var(--cb-text)]/30" onClick={() => { setDetailId(null); setEditing(false); setExtending(false); }} />
          <div className="fixed inset-y-0 right-0 z-30 flex w-[26rem] max-w-[92vw] flex-col bg-white shadow-2xl">
            <div className="flex items-start justify-between border-b border-[var(--cb-bg)] p-5">
              <div>
                <div className="text-lg font-bold text-[var(--cb-text)]">{detail.guestName}</div>
                <div className="text-sm text-[var(--cb-muted)]">
                  Đơn {detail.id} · {getChannelName(detail.channelCode)} · {STATUS_LABELS[detail.status]}
                </div>
                <Link href={`/${HOTEL_ID}/reservations/${detail.id}`} className="mt-1 inline-block text-sm font-medium text-[var(--cb-blue)] hover:underline">Mở trang chi tiết ↗</Link>
              </div>
              <button onClick={() => { setDetailId(null); setEditing(false); setExtending(false); }} className="cb-btn-ghost flex h-8 w-8 items-center justify-center rounded-full text-sm">✕</button>
            </div>

            {editing && (
              <div className="absolute inset-0 z-10 overflow-y-auto bg-white p-5 text-sm">
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
                    <input className="w-full rounded-lg border border-[var(--cb-border)] px-3 py-2 text-sm outline-none focus:border-[var(--cb-blue)]" value={eName} onChange={(e) => setEName(e.target.value)} />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-[var(--cb-muted)]">Số điện thoại</label>
                    <input className="w-full rounded-lg border border-[var(--cb-border)] px-3 py-2 text-sm outline-none focus:border-[var(--cb-blue)]" value={ePhone} onChange={(e) => setEPhone(e.target.value)} />
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
                    <select className="w-full rounded-lg border border-[var(--cb-border)] px-3 py-2 text-sm outline-none focus:border-[var(--cb-blue)]" value={eType} onChange={(e) => {
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
                    <select className="w-full rounded-lg border border-[var(--cb-border)] px-3 py-2 text-sm outline-none focus:border-[var(--cb-blue)]" value={ePlan} onChange={(e) => setEPlan(e.target.value)}>
                      {editPlans.map((p) => (<option key={p.id} value={p.id}>{p.name}{p.derivedFromId ? " (kế thừa)" : ""}</option>))}
                      {editPlans.length === 0 && <option value="">— chưa có gói giá —</option>}
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="mb-1 block text-xs font-medium text-[var(--cb-muted)]">Người lớn</label>
                      <input type="number" min={1} className="w-full rounded-lg border border-[var(--cb-border)] px-3 py-2 text-sm outline-none focus:border-[var(--cb-blue)]" value={eAdults} onChange={(e) => setEAdults(Number(e.target.value))} />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-[var(--cb-muted)]">Trẻ em</label>
                      <input type="number" min={0} className="w-full rounded-lg border border-[var(--cb-border)] px-3 py-2 text-sm outline-none focus:border-[var(--cb-blue)]" value={eChildren} onChange={(e) => setEChildren(Number(e.target.value))} />
                    </div>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-[var(--cb-muted)]">Ghi chú</label>
                    <input className="w-full rounded-lg border border-[var(--cb-border)] px-3 py-2 text-sm outline-none focus:border-[var(--cb-blue)]" value={eNote} onChange={(e) => setENote(e.target.value)} placeholder="Yêu cầu đặc biệt..." />
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
                  <p className="text-xs text-[var(--cb-muted)]">Không sửa được ở đây: nguồn đơn, hình thức thu tiền, trạng thái (dùng nút Nhận/Trả/Huỷ bên ngoài) và tiền đã thu (sửa trong folio).</p>
                </div>
              </div>
            )}

            {/* tab bar — Cloudbeds: panel chi tiet co tab, icon o bang mo thang tab */}
            <div className="flex gap-4 border-b border-[var(--cb-bg)] px-5 pt-3 text-sm">
              {(["stay", "folio", "notes"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setDetailTab(t)}
                  className={`pb-2 font-semibold ${detailTab === t ? "border-b-2 border-[var(--cb-blue)] text-[var(--cb-blue)]" : "text-[var(--cb-muted)]"}`}
                >
                  {t === "stay" ? "Chỗ ở" : t === "folio" ? "Folio" : `Ghi chú (${detailAllNotes.length})`}
                </button>
              ))}
            </div>

            <div className="flex-1 space-y-4 overflow-y-auto p-5 text-sm">
              {detailTab === "stay" && (
                <>
              <div className="space-y-2">
                <DetailRow label="Số điện thoại" value={detail.guestPhone || "—"} />
                <DetailRow label="Ngày đến → đi" value={`${fmtDate(detail.checkIn)} → ${fmtDate(detail.checkOut)} (${detailNights} đêm)`} />
                <DetailRow label="Phòng" value={detail.roomNumbers.length ? detail.roomNumbers.join(", ") : "Chưa gán"} />
                <DetailRow label="Loại phòng" value={roomTypeName(detail.roomTypeId)} />
                <DetailRow label="Gói giá" value={catalog.ratePlans.find((p) => p.id === detail.ratePlanId)?.name ?? detail.ratePlanId} />
                <DetailRow label="Số khách" value={`${detail.adults ?? detail.guests} người lớn${(detail.children ?? 0) > 0 ? `, ${detail.children} trẻ em` : ""}`} />
                <DetailRow label="Thu tiền bởi" value={detail.paymentCollector === "channel_collect" ? "Kênh thu hộ" : "Khách sạn tự thu"} />
                <DetailRow label="Ngày đặt" value={fmtDate(detail.createdAt)} />
                {detail.note && <DetailRow label="Ghi chú" value={detail.note} />}
              </div>

              <div className="flex flex-wrap gap-2">
                {detail.status === "confirmed" && (
                  <button onClick={() => changeStatus(detail.id, "in_house")} className="cb-btn-primary px-3 py-2 text-sm">Nhận phòng</button>
                )}
                {detail.status === "in_house" && (
                  <button onClick={() => changeStatus(detail.id, "checked_out")} className="cb-btn-primary px-3 py-2 text-sm">Trả phòng</button>
                )}
                {detail.status === "confirmed" && (
                  <button onClick={() => changeStatus(detail.id, "no_show")} className="cb-btn-ghost px-3 py-2 text-sm">Khách không đến (no-show)</button>
                )}
                {["pending", "confirmed"].includes(detail.status) && (
                  <button onClick={() => changeStatus(detail.id, "cancelled")} className="rounded-lg border border-[#e5484d] px-3 py-2 text-sm font-semibold text-[#e5484d] hover:bg-red-50">Huỷ đơn</button>
                )}
                {!["cancelled", "no_show", "checked_out"].includes(detail.status) && (
                  <button onClick={openEdit} className="cb-btn-ghost px-3 py-2 text-sm">Sửa đơn</button>
                )}
                {["pending", "confirmed", "in_house"].includes(detail.status) && (
                  <button onClick={openExtend} className="cb-btn-ghost px-3 py-2 text-sm">Gia hạn</button>
                )}
              </div>

              {["pending", "confirmed", "in_house"].includes(detail.status) && extending && (
                <div className="rounded-xl border border-[var(--cb-border)] p-4">
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

                </>
              )}
              {detailTab === "folio" && (
              <div>
                <div className="text-sm font-bold text-[var(--cb-text)]">Folio — hoá đơn chi tiết</div>
                <div className="mt-2 space-y-1.5">
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
              {detailTab === "notes" && (
                <div>
                  <div className="text-sm font-bold text-[var(--cb-text)]">Ghi chú ({detailAllNotes.length})</div>
                  {detailAllNotes.length === 0 ? (
                    <p className="mt-3 rounded-lg bg-[var(--cb-bg)] px-3 py-3 text-[var(--cb-muted)]">Chưa có ghi chú nào cho đơn này.</p>
                  ) : (
                    <div className="mt-3 space-y-3">
                      {detailAllNotes.map((n) => (
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
                      value={noteDraft}
                      onChange={(e) => setNoteDraft(e.target.value)}
                      placeholder="Ghi chú cho ca sau: khách đến muộn, cần thêm khăn..."
                      rows={3}
                      className="w-full rounded-lg border border-[var(--cb-border)] px-3 py-2 text-sm outline-none focus:border-[var(--cb-blue)]"
                    />
                    <button onClick={addDetailNote} className="cb-btn-primary mt-2 px-4 py-2 text-sm">+ Thêm ghi chú</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </>
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
