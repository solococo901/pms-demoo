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
// ============================================================

import { useEffect, useMemo, useState } from "react";
import {
  CHANNELS,
  RATE_PLANS,
  ROOM_TYPES,
  TODAY,
  extraFeesPerNight,
  getChannelName,
  getRoomTypeName,
  resolvePlanPrice,
  type FolioItem,
  type RatePlan,
  type Reservation,
  type ReservationStatus,
  type Room,
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
import { STATUS_LABELS, STATUS_STYLES } from "@/components/ReservationBar";
import ReservationForm from "@/components/ReservationForm";

const DAY_MS = 86_400_000;
const toTime = (d: string) => new Date(d + "T00:00:00Z").getTime();
const toISO = (t: number) => new Date(t).toISOString().slice(0, 10);
const addDays = (d: string, n: number) => toISO(toTime(d) + n * DAY_MS);
const nightsOf = (r: Reservation) =>
  Math.round((new Date(r.checkOut + "T00:00:00Z").getTime() - new Date(r.checkIn + "T00:00:00Z").getTime()) / DAY_MS);
const fmt = (n: number) => n.toLocaleString("vi-VN");
const fmtDate = (d: string) => d.split("-").reverse().join("/");

type SortKey = "guestName" | "checkIn" | "totalAmount" | "createdAt";

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
  const [showForm, setShowForm] = useState(false);
  const [bulkAction, setBulkAction] = useState<"export" | "cancel">("export");

  // ---------- reservation detail + folio ----------
  const [detailId, setDetailId] = useState<string | null>(null);
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

  // Chan phong (OOO tru khoi ton ban duoc) — phuc vu kiem tra khi sua/gia han.
  const [roomBlocks, setRoomBlocks] = useState<{ roomNumber: string; fromDate: string; toDate: string; kind: string; reason?: string }[]>([]);

  const detail = reservations.find((r) => r.id === detailId) ?? null;
  const detailNights = detail ? nightsOf(detail) : 0;
  const detailExtras = detail ? folioItems.filter((f) => f.reservationId === detail.id) : [];
  const extrasTotal = detailExtras.reduce((a, f) => a + f.amount, 0);
  const totalDue = detail ? detail.totalAmount + extrasTotal : 0;
  const balance = detail ? totalDue - detail.paidAmount : 0;

  // ---------- load everything from Supabase on open ----------
  useEffect(() => {
    (async () => {
      const [res, rr, folio, typesRes, roomsRes, plansRes, blocksRes] = await Promise.all([
        supabase.from("reservations").select("*").eq("hotel_id", HOTEL_ID).order("booked_at", { ascending: false }),
        supabase.from("reservation_rooms").select("reservation_id, room_number"),
        supabase.from("folio_items").select("*").eq("hotel_id", HOTEL_ID),
        supabase.from("room_types").select("*").eq("hotel_id", HOTEL_ID),
        supabase.from("rooms").select("*").eq("hotel_id", HOTEL_ID),
        supabase.from("rate_plans").select("*").eq("hotel_id", HOTEL_ID),
        supabase.from("room_blocks").select("*").eq("hotel_id", HOTEL_ID),
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
      // Chan phong khong lam hong trang neu doc loi — chi mat kiem tra OOO.
      setRoomBlocks((blocksRes.data ?? []).map((b) => ({
        roomNumber: b.room_number, fromDate: b.from_date, toDate: b.to_date,
        kind: b.kind, reason: b.reason ?? undefined,
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
        ratePlans: (plansRes.data ?? []).map((p) => {
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
        }),
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
    const item: FolioItem = { id: `fi-${Date.now()}`, reservationId: detail.id, date: TODAY, label: extraLabel.trim(), amount: extraAmount };
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
  const editRoomTotal = (() => {
    if (!editPlan || editNights === 0) return 0;
    let sum = 0;
    for (let i = 0; i < editNights; i++) sum += resolvePlanPrice(editPlan, addDays(eCheckIn, i), catalog.ratePlans) ?? 0;
    return sum;
  })();
  const editTotal = editRoomTotal + (editPlan ? extraFeesPerNight(editPlan, eAdults, eChildren).total * editNights : 0);

  // Tra ve cau bao loi neu khoang ngay moi khong con cho o duoc (null = ok).
  // Don da gan phong: kiem tra tung phong da gan. Don chua gan: kiem tra
  // ton loai phong theo ngay. Bo qua chinh don nay va cac don da huy /
  // khong den / da tra phong. Chi khoi OOO tru ton; OOS thi khong.
  function availabilityError(excludeId: string, roomNumbers: string[], typeId: string, newCheckIn: string, newCheckOut: string): string | null {
    const active = (x: Reservation) =>
      x.id !== excludeId && x.status !== "cancelled" && x.status !== "no_show" && x.status !== "checked_out";
    if (roomNumbers.length > 0) {
      for (const num of roomNumbers) {
        for (let t = toTime(newCheckIn); t < toTime(newCheckOut); t += DAY_MS) {
          const d = toISO(t);
          const ooo = roomBlocks.find((b) => b.roomNumber === num && b.kind === "out_of_order" && b.fromDate <= d && d <= b.toDate);
          if (ooo) return `Phòng ${num} đang hỏng (ngừng bán) đêm ${fmtDate(d)}${ooo.reason ? `: ${ooo.reason}` : ""}.`;
          const clash = reservations.find((x) => active(x) && x.roomNumbers.includes(num) && x.checkIn <= d && d < x.checkOut);
          if (clash) return `Phòng ${num} đã có đơn ${clash.id} (${clash.guestName}) đêm ${fmtDate(d)}.`;
        }
      }
      return null;
    }
    const typeRooms = catalog.rooms.filter((rm) => rm.roomTypeId === typeId);
    const typeName = catalog.roomTypes.find((t) => t.id === typeId)?.name ?? typeId;
    for (let t = toTime(newCheckIn); t < toTime(newCheckOut); t += DAY_MS) {
      const d = toISO(t);
      const oooCount = typeRooms.filter((rm) =>
        roomBlocks.some((b) => b.roomNumber === rm.number && b.kind === "out_of_order" && b.fromDate <= d && d <= b.toDate)
      ).length;
      const sellable = typeRooms.length - oooCount;
      const busy = new Set<string>();
      for (const x of reservations) {
        if (!active(x) || !(x.checkIn <= d && d < x.checkOut)) continue;
        for (const num of x.roomNumbers) {
          if (catalog.rooms.find((rm) => rm.number === num)?.roomTypeId === typeId) busy.add(num);
        }
        if (x.roomNumbers.length === 0 && x.roomTypeId === typeId) busy.add(`unassigned:${x.id}`);
      }
      if (busy.size + 1 > sellable)
        return `Hết phòng loại ${typeName} đêm ${fmtDate(d)} (còn ${Math.max(0, sellable - busy.size)} phòng trống).`;
    }
    return null;
  }

  async function saveEdit() {
    if (!detail) return;
    if (!eName.trim()) return setEditError("Chưa nhập tên khách.");
    if (!eCheckIn || !eCheckOut) return setEditError("Chưa chọn đủ ngày đến / ngày đi.");
    if (!Number.isFinite(editNights) || editNights <= 0) return setEditError("Ngày đi phải sau ngày đến.");
    if (eAdults < 1) return setEditError("Phải có ít nhất 1 người lớn.");
    if (editType && eAdults + eChildren > editType.maxOccupancy)
      return setEditError(`Loại phòng này ở tối đa ${editType.maxOccupancy} khách — đang nhập ${eAdults + eChildren} khách.`);
    if (!editPlan) return setEditError("Kênh này chưa có gói giá cho loại phòng đã chọn.");
    const typeChanged = eType !== detail.roomTypeId;
    const assigned = detail.roomNumbers.length > 0;
    if (typeChanged && assigned && !window.confirm("Đổi loại phòng sẽ huỷ các phòng đã gán cho đơn này — cần gán lại trên Lịch phòng. Vẫn đổi?")) return;
    const err = availabilityError(detail.id, typeChanged ? [] : detail.roomNumbers, eType, eCheckIn, eCheckOut);
    if (err) return setEditError(err);
    if (typeChanged && assigned) {
      const { error } = await supabase.from("reservation_rooms").delete().eq("reservation_id", detail.id);
      if (error) return setEditError("Huỷ phòng đã gán không thành công: " + error.message);
    }
    const ok = await patchReservation(detail.id, {
      guestName: eName.trim(), guestPhone: ePhone,
      checkIn: eCheckIn, checkOut: eCheckOut,
      adults: eAdults, children: eChildren, guests: eAdults + eChildren,
      roomTypeId: eType, ratePlanId: editPlan.id,
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
  const extTotal = (() => {
    if (!detail) return 0;
    if (!extPlan || !Number.isFinite(extNights) || extNights <= 0) return detail.totalAmount;
    // Tong moi = tong cu + tien cac dem them (gia goi theo ngay + phu thu khach them).
    let add = 0;
    for (let i = 0; i < extNights; i++) add += resolvePlanPrice(extPlan, addDays(detail.checkOut, i), catalog.ratePlans) ?? 0;
    add += extraFeesPerNight(extPlan, detail.adults ?? detail.guests, detail.children ?? 0).total * extNights;
    return detail.totalAmount + add;
  })();

  async function saveExtend() {
    if (!detail) return;
    if (!extCheckOut) return setExtError("Chưa chọn ngày đi mới.");
    if (!Number.isFinite(extNights) || extNights <= 0) return setExtError("Ngày đi mới phải sau ngày đi hiện tại.");
    if (!extPlan) return setExtError("Không tìm thấy gói giá của đơn này — không tính được tiền các đêm thêm.");
    // Chi kiem tra cac dem them (khoang ngay cu don nay dang giu nguyen).
    const err = availabilityError(detail.id, detail.roomNumbers, detail.roomTypeId, detail.checkOut, extCheckOut);
    if (err) return setExtError(err);
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
      [r.id, r.guestName, r.guestPhone, fmtDate(r.createdAt), r.roomNumbers.join(" ") || "-", getRoomTypeName(r.roomTypeId),
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
      const { error } = await supabase.from("reservations").update({ status: "cancelled" }).in("id", rows.map((r) => r.id));
      if (error) return alert("Huỷ đơn trên cơ sở dữ liệu không thành công: " + error.message);
      setReservations((prev) =>
        prev.map((r) => (selected.has(r.id) ? { ...r, status: "cancelled" as ReservationStatus } : r))
      );
      queueChannexDates(rows.flatMap((r) => stayDates(r.checkIn, r.checkOut)));
      setSelected(new Set());
    }
  }

  const chipCls = "rounded-full border border-[#dde3ea] bg-white px-3 py-1.5 text-xs text-[#17293e]";
  const thCls = "px-3 py-3 text-left text-xs font-semibold text-[#68707a] cursor-pointer select-none";

  return (
    <div>
      {/* header row — like Cloudbeds: title left, actions right */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-[#17293e]">Đặt phòng</h1>
        <div className="flex gap-2">
          <button onClick={() => exportCsv(filtered)} className="cb-btn-ghost px-3 py-2 text-sm" title="Xuất toàn bộ danh sách đang lọc ra file CSV">⬇ Xuất file</button>
          <button onClick={() => window.print()} className="cb-btn-ghost px-3 py-2 text-sm" title="In danh sách">🖨 In</button>
          <button onClick={() => setShowForm(true)} className="cb-btn-primary px-4 py-2 text-sm shadow-sm">+ Tạo đặt phòng</button>
        </div>
      </div>

      {loading && <p className="mt-4 text-sm text-[#68707a]">Đang tải dữ liệu từ Supabase...</p>}
      {loadError && <p className="mt-4 text-sm text-[#e5484d]">Không đọc được dữ liệu từ Supabase: {loadError}</p>}

      <div className="cb-card mt-5 p-4">
        {/* search */}
        <input
          value={query}
          onChange={(e) => { setQuery(e.target.value); setPage(1); }}
          placeholder="Tìm theo tên khách, email, số điện thoại, mã đơn..."
          className="w-full max-w-md rounded-lg border border-[#dde3ea] px-3 py-2 text-sm text-[#17293e] outline-none focus:border-[#2563eb]"
        />

        {/* count + bulk + filter chips */}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-[#17293e]">{filtered.length} đặt phòng</span>
          <span className="mx-1 h-5 w-px bg-[#dde3ea]" />
          <select value={bulkAction} onChange={(e) => setBulkAction(e.target.value as typeof bulkAction)} className="rounded-full bg-[#e8effe] px-3 py-1.5 text-xs font-medium text-[#2563eb]">
            <option value="export">Bulk: Xuất file các đơn đã chọn</option>
            <option value="cancel">Bulk: Huỷ các đơn đã chọn</option>
          </select>
          <button onClick={applyBulk} className="rounded-full bg-[#2563eb] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#1e4fd8]">Thực hiện ({selected.size})</button>

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
            {ROOM_TYPES.map((t) => (<option key={t.id} value={t.id}>{t.name}</option>))}
          </select>
          <label className={`${chipCls} flex items-center gap-1`}>
            Ngày đến:
            <input type="date" value={checkInFilter} onChange={(e) => setCheckInFilter(e.target.value)} className="outline-none" />
          </label>
          <button onClick={resetFilters} className="rounded-full px-3 py-1.5 text-xs text-[#68707a] underline">Reset Filters</button>
        </div>

        {/* table */}
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[1050px] border-t border-[#eef1f5] text-sm text-[#17293e]">
            <thead className="bg-[#f7f9fb]">
              <tr>
                <th className="px-3 py-3"><input type="checkbox" className="accent-[#2563eb]" checked={pageRows.length > 0 && pageRows.every((r) => selected.has(r.id))} onChange={(e) => {
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
              </tr>
            </thead>
            <tbody>
              {pageRows.map((r) => (
                <tr key={r.id} className="border-t border-[#eef1f5] hover:bg-[#f7f9fb]">
                  <td className="px-3 py-3"><input type="checkbox" className="accent-[#2563eb]" checked={selected.has(r.id)} onChange={() => toggleSelect(r.id)} /></td>
                  <td className="px-3 py-3 font-medium">{r.id}</td>
                  <td className="px-3 py-3 font-medium text-[#2563eb] cursor-pointer hover:underline" title="Bấm để mở chi tiết đơn + folio" onClick={() => setDetailId(r.id)}>{r.guestName}</td>
                  <td className="px-3 py-3">{fmtDate(r.createdAt)}</td>
                  <td className="px-3 py-3">{r.roomNumbers.join(", ") || "—"}</td>
                  <td className="px-3 py-3">{getRoomTypeName(r.roomTypeId)}</td>
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
                  <td className="px-3 py-3 text-[#68707a]">
                    {getChannelName(r.channelCode)}
                    {["booking_com", "agoda", "expedia", "airbnb"].includes(r.channelCode) && (
                      <span className="text-[#9aa7b4]"> ({r.paymentCollector === "channel_collect" ? "Channel Collect" : "Hotel Collect"})</span>
                    )}
                    {r.channelCode === "frontdesk" && <span className="text-[#9aa7b4]"> (Walk-In)</span>}
                    {r.channelCode === "website" && <span className="text-[#9aa7b4]"> (Booking Engine)</span>}
                  </td>
                </tr>
              ))}
              {pageRows.length === 0 && (
                <tr><td colSpan={12} className="px-3 py-10 text-center text-[#9aa7b4]">Không có đơn nào khớp bộ lọc.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* pagination */}
        <div className="mt-3 flex items-center justify-end gap-3 text-xs text-[#68707a]">
          <span>
            Đang xem {filtered.length === 0 ? 0 : (currentPage - 1) * pageSize + 1}–{Math.min(currentPage * pageSize, filtered.length)} trong {filtered.length} đơn · Mỗi trang
          </span>
          <select value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }} className="rounded border border-[#dde3ea] px-1.5 py-1">
            {[5, 10, 20].map((n) => (<option key={n} value={n}>{n}</option>))}
          </select>
          <button disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)} className="rounded border border-[#dde3ea] px-2.5 py-1 disabled:opacity-40">‹</button>
          <span className="rounded border border-[#dde3ea] px-2.5 py-1 font-medium text-[#17293e]">{currentPage} / {pageCount}</span>
          <button disabled={currentPage >= pageCount} onClick={() => setPage(currentPage + 1)} className="rounded border border-[#dde3ea] px-2.5 py-1 disabled:opacity-40">›</button>
        </div>
      </div>

      {/* ---------- reservation detail drawer + folio ---------- */}
      {detail && (
        <>
          <div className="fixed inset-0 z-20 bg-[#17293e]/30" onClick={() => { setDetailId(null); setEditing(false); setExtending(false); }} />
          <div className="fixed inset-y-0 right-0 z-30 flex w-[26rem] max-w-[92vw] flex-col bg-white shadow-2xl">
            <div className="flex items-start justify-between border-b border-[#eef1f5] p-5">
              <div>
                <div className="text-lg font-bold text-[#17293e]">{detail.guestName}</div>
                <div className="text-sm text-[#68707a]">
                  Đơn {detail.id} · {getChannelName(detail.channelCode)} · {STATUS_LABELS[detail.status]}
                </div>
              </div>
              <button onClick={() => { setDetailId(null); setEditing(false); setExtending(false); }} className="cb-btn-ghost flex h-8 w-8 items-center justify-center rounded-full text-sm">✕</button>
            </div>

            {editing && (
              <div className="absolute inset-0 z-10 overflow-y-auto bg-white p-5 text-sm">
                <div className="mb-4 flex items-start justify-between">
                  <div>
                    <div className="text-lg font-bold text-[#17293e]">Sửa đơn {detail.id}</div>
                    <div className="text-sm text-[#68707a]">{detail.guestName} · {getChannelName(detail.channelCode)}</div>
                  </div>
                  <button onClick={() => setEditing(false)} className="cb-btn-ghost flex h-8 w-8 items-center justify-center rounded-full text-sm">✕</button>
                </div>
                <div className="space-y-3">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-[#68707a]">Tên khách *</label>
                    <input className="w-full rounded-lg border border-[#dde3ea] px-3 py-2 text-sm outline-none focus:border-[#2563eb]" value={eName} onChange={(e) => setEName(e.target.value)} />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-[#68707a]">Số điện thoại</label>
                    <input className="w-full rounded-lg border border-[#dde3ea] px-3 py-2 text-sm outline-none focus:border-[#2563eb]" value={ePhone} onChange={(e) => setEPhone(e.target.value)} />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="mb-1 block text-xs font-medium text-[#68707a]">Ngày đến</label>
                      <input type="date" className="w-full rounded-lg border border-[#dde3ea] px-3 py-2 text-sm outline-none focus:border-[#2563eb]" value={eCheckIn} onChange={(e) => setECheckIn(e.target.value)} />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-[#68707a]">Ngày đi</label>
                      <input type="date" className="w-full rounded-lg border border-[#dde3ea] px-3 py-2 text-sm outline-none focus:border-[#2563eb]" value={eCheckOut} onChange={(e) => setECheckOut(e.target.value)} />
                    </div>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-[#68707a]">Loại phòng</label>
                    <select className="w-full rounded-lg border border-[#dde3ea] px-3 py-2 text-sm outline-none focus:border-[#2563eb]" value={eType} onChange={(e) => {
                      const nt = e.target.value;
                      setEType(nt);
                      const first = catalog.ratePlans.find((p) => p.channelCode === detail.channelCode && p.roomTypeId === nt);
                      setEPlan(first?.id ?? "");
                    }}>
                      {catalog.roomTypes.map((t) => (<option key={t.id} value={t.id}>{t.name} (tối đa {t.maxOccupancy} khách)</option>))}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-[#68707a]">Gói giá (của kênh {getChannelName(detail.channelCode)})</label>
                    <select className="w-full rounded-lg border border-[#dde3ea] px-3 py-2 text-sm outline-none focus:border-[#2563eb]" value={ePlan} onChange={(e) => setEPlan(e.target.value)}>
                      {editPlans.map((p) => (<option key={p.id} value={p.id}>{p.name}{p.derivedFromId ? " (kế thừa)" : ""}</option>))}
                      {editPlans.length === 0 && <option value="">— chưa có gói giá —</option>}
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="mb-1 block text-xs font-medium text-[#68707a]">Người lớn</label>
                      <input type="number" min={1} className="w-full rounded-lg border border-[#dde3ea] px-3 py-2 text-sm outline-none focus:border-[#2563eb]" value={eAdults} onChange={(e) => setEAdults(Number(e.target.value))} />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-[#68707a]">Trẻ em</label>
                      <input type="number" min={0} className="w-full rounded-lg border border-[#dde3ea] px-3 py-2 text-sm outline-none focus:border-[#2563eb]" value={eChildren} onChange={(e) => setEChildren(Number(e.target.value))} />
                    </div>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-[#68707a]">Ghi chú</label>
                    <input className="w-full rounded-lg border border-[#dde3ea] px-3 py-2 text-sm outline-none focus:border-[#2563eb]" value={eNote} onChange={(e) => setENote(e.target.value)} placeholder="Yêu cầu đặc biệt..." />
                  </div>
                  {eType !== detail.roomTypeId && detail.roomNumbers.length > 0 && (
                    <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-[#e5484d]">Đổi loại phòng sẽ huỷ các phòng đã gán ({detail.roomNumbers.join(", ")}) — cần gán lại trên Lịch phòng.</p>
                  )}
                  <div className="space-y-1 rounded-xl bg-[#f2f6fe] px-4 py-3">
                    <div className="flex justify-between"><span>Tiền phòng + phụ thu — {editNights} đêm</span><span className="font-semibold">{fmt(editTotal)}₫</span></div>
                    <div className="flex justify-between text-[#68707a]"><span>Tổng hiện tại</span><span>{fmt(detail.totalAmount)}₫</span></div>
                  </div>
                  {editError && <p className="text-sm text-[#e5484d]">{editError}</p>}
                  <div className="flex gap-2">
                    <button onClick={saveEdit} className="cb-btn-primary flex-1 py-2.5 text-sm">Lưu thay đổi</button>
                    <button onClick={() => setEditing(false)} className="cb-btn-ghost px-5 py-2.5 text-sm">Huỷ</button>
                  </div>
                  <p className="text-xs text-[#68707a]">Không sửa được ở đây: nguồn đơn, hình thức thu tiền, trạng thái (dùng nút Nhận/Trả/Huỷ bên ngoài) và tiền đã thu (sửa trong folio).</p>
                </div>
              </div>
            )}

            <div className="flex-1 space-y-4 overflow-y-auto p-5 text-sm">
              <div className="space-y-2">
                <DetailRow label="Số điện thoại" value={detail.guestPhone || "—"} />
                <DetailRow label="Ngày đến → đi" value={`${fmtDate(detail.checkIn)} → ${fmtDate(detail.checkOut)} (${detailNights} đêm)`} />
                <DetailRow label="Phòng" value={detail.roomNumbers.length ? detail.roomNumbers.join(", ") : "Chưa gán"} />
                <DetailRow label="Loại phòng" value={getRoomTypeName(detail.roomTypeId)} />
                <DetailRow label="Gói giá" value={RATE_PLANS.find((p) => p.id === detail.ratePlanId)?.name ?? detail.ratePlanId} />
                <DetailRow label="Số khách" value={`${detail.adults ?? detail.guests} người lớn${(detail.children ?? 0) > 0 ? `, ${detail.children} trẻ em` : ""}`} />
                <DetailRow label="Thu tiền bởi" value={detail.paymentCollector === "channel_collect" ? "Kênh thu hộ" : "Khách sạn tự thu"} />
                <DetailRow label="Ngày đặt" value={fmtDate(detail.createdAt)} />
                {detail.note && <DetailRow label="Ghi chú" value={detail.note} />}
              </div>

              <div className="flex flex-wrap gap-2">
                {detail.status === "confirmed" && (
                  <button onClick={() => patchReservation(detail.id, { status: "in_house" })} className="cb-btn-primary px-3 py-2 text-sm">Nhận phòng</button>
                )}
                {detail.status === "in_house" && (
                  <button onClick={() => patchReservation(detail.id, { status: "checked_out" })} className="cb-btn-primary px-3 py-2 text-sm">Trả phòng</button>
                )}
                {detail.status === "confirmed" && (
                  <button onClick={() => patchReservation(detail.id, { status: "no_show" })} className="cb-btn-ghost px-3 py-2 text-sm">Khách không đến (no-show)</button>
                )}
                {["pending", "confirmed"].includes(detail.status) && (
                  <button onClick={() => patchReservation(detail.id, { status: "cancelled" })} className="rounded-lg border border-[#e5484d] px-3 py-2 text-sm font-semibold text-[#e5484d] hover:bg-red-50">Huỷ đơn</button>
                )}
                {!["cancelled", "no_show"].includes(detail.status) && (
                  <button onClick={openEdit} className="cb-btn-ghost px-3 py-2 text-sm">Sửa đơn</button>
                )}
                {["pending", "confirmed", "in_house"].includes(detail.status) && (
                  <button onClick={openExtend} className="cb-btn-ghost px-3 py-2 text-sm">Gia hạn</button>
                )}
              </div>

              {["pending", "confirmed", "in_house"].includes(detail.status) && extending && (
                <div className="rounded-xl border border-[#dde3ea] p-4">
                  <div className="font-semibold text-[#17293e]">Gia hạn — ngày đi hiện tại {fmtDate(detail.checkOut)}</div>
                  <div className="mt-3 flex flex-wrap items-end gap-2">
                    <label className="text-xs text-[#68707a]">Ngày đi mới
                      <input type="date" min={addDays(detail.checkOut, 1)} value={extCheckOut} onChange={(e) => setExtCheckOut(e.target.value)} className="mt-0.5 block rounded-lg border border-[#dde3ea] px-2 py-2 text-sm outline-none focus:border-[#2563eb]" />
                    </label>
                    <span className="pb-2 text-sm">Thêm {extNights} đêm · Tổng mới {fmt(extTotal)}₫ (hiện tại {fmt(detail.totalAmount)}₫)</span>
                  </div>
                  {detail.roomNumbers.length > 0 && (
                    <p className="mt-2 text-xs text-[#68707a]">Trước khi lưu sẽ kiểm tra phòng {detail.roomNumbers.join(", ")} còn trống các đêm thêm.</p>
                  )}
                  {detail.roomNumbers.length === 0 && (
                    <p className="mt-2 text-xs text-[#68707a]">Đơn chưa gán phòng — trước khi lưu sẽ kiểm tra còn phòng trống loại {getRoomTypeName(detail.roomTypeId)} các đêm thêm.</p>
                  )}
                  {extError && <p className="mt-2 text-sm text-[#e5484d]">{extError}</p>}
                  <div className="mt-3 flex gap-2">
                    <button onClick={saveExtend} className="cb-btn-primary px-3 py-2 text-sm">Xác nhận gia hạn</button>
                    <button onClick={() => setExtending(false)} className="cb-btn-ghost px-3 py-2 text-sm">Huỷ</button>
                  </div>
                </div>
              )}

              {/* FOLIO */}
              <div className="border-t border-[#eef1f5] pt-4">
                <div className="text-sm font-bold text-[#17293e]">Folio — hoá đơn chi tiết</div>
                <div className="mt-2 space-y-1.5">
                  {Array.from({ length: detailNights }, (_, i) => {
                    const base = Math.floor(detail.totalAmount / Math.max(1, detailNights));
                    const amount = i === detailNights - 1 ? detail.totalAmount - base * (detailNights - 1) : base;
                    return (
                      <div key={i} className="flex justify-between gap-3">
                        <span className="text-[#68707a]">Tiền phòng — đêm {fmtDate(addDays(detail.checkIn, i))}{detail.roomNumbers.length > 1 ? ` (${detail.roomNumbers.length} phòng)` : ""}</span>
                        <span className="font-medium text-[#17293e]">{fmt(amount)}₫</span>
                      </div>
                    );
                  })}
                  {detailExtras.map((f) => (
                    <div key={f.id} className="flex items-center justify-between gap-3">
                      <span className="text-[#68707a]">{f.label} — {fmtDate(f.date)}</span>
                      <span className="flex items-center gap-2">
                        <span className="font-medium text-[#17293e]">{fmt(f.amount)}₫</span>
                        <button onClick={() => deleteExtra(f.id)} className="text-[#e5484d]" title="Xoá khoản này">✕</button>
                      </span>
                    </div>
                  ))}
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <input value={extraLabel} onChange={(e) => setExtraLabel(e.target.value)} placeholder="Dịch vụ thêm: giặt ủi, minibar..." className="min-w-0 flex-1 rounded-lg border border-[#dde3ea] px-2 py-2 text-sm outline-none focus:border-[#2563eb]" />
                  <input type="number" value={extraAmount || ""} onChange={(e) => setExtraAmount(Number(e.target.value))} placeholder="Số tiền" className="w-28 rounded-lg border border-[#dde3ea] px-2 py-2 text-sm outline-none focus:border-[#2563eb]" />
                  <button onClick={addExtra} className="cb-btn-ghost px-3 py-2 text-sm">+ Thêm</button>
                </div>

                <div className="mt-3 space-y-1.5 border-t border-[#eef1f5] pt-3">
                  <div className="flex justify-between"><span className="text-[#68707a]">Tổng phải thu (phòng + dịch vụ)</span><span className="font-semibold text-[#17293e]">{fmt(totalDue)}₫</span></div>
                  <div className="flex justify-between"><span className="text-[#68707a]">Đã thanh toán{detail.paymentCollector === "channel_collect" ? " (kênh thu hộ)" : ""}</span><span className="font-semibold text-[#17293e]">{fmt(detail.paidAmount)}₫</span></div>
                  <div className="flex justify-between"><span className="font-semibold text-[#17293e]">Còn nợ</span><span className={`font-bold ${balance > 0 ? "text-[#e5484d]" : "text-[#1db584]"}`}>{balance > 0 ? fmt(balance) + "₫" : "Đã thanh toán đủ"}</span></div>
                  {detail.totalAmount === 0 && detailNights > 0 && !["cancelled", "no_show"].includes(detail.status) && (
                    <p className="rounded-lg bg-[#fdf3e3] px-3 py-2 text-xs text-[#9a6a12]">⚠ Tổng đơn đang là 0₫ — có thể do chưa nhập giá cho các đêm này ở Lịch giá. Kiểm tra giá theo kênh rồi sửa đơn.</p>
                  )}
                </div>

                {balance > 0 && detail.paymentCollector === "hotel_collect" && (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <input type="number" value={payAmount || ""} onChange={(e) => setPayAmount(Number(e.target.value))} placeholder="Số tiền khách trả" className="w-36 rounded-lg border border-[#dde3ea] px-2 py-2 text-sm outline-none focus:border-[#2563eb]" />
                    <select value={payMethod} onChange={(e) => setPayMethod(e.target.value)} className="rounded-lg border border-[#dde3ea] px-2 py-2 text-sm outline-none">
                      <option>Tiền mặt</option>
                      <option>Chuyển khoản</option>
                      <option>Thẻ</option>
                    </select>
                    <button onClick={recordPayment} className="cb-btn-primary px-3 py-2 text-sm">Ghi nhận thanh toán ({payMethod})</button>
                  </div>
                )}
                {detail.paymentCollector === "channel_collect" && (
                  <p className="mt-2 text-xs text-[#68707a]">Đơn này do kênh thu hộ tiền của khách — khách sạn nhận tiền từ kênh sau, không thu thêm tại quầy.</p>
                )}
              </div>
            </div>
          </div>
        </>
      )}

      {showForm && (
        <ReservationForm
          roomTypes={catalog.roomTypes}
          ratePlans={catalog.ratePlans}
          rooms={catalog.rooms}
          onClose={() => setShowForm(false)}
          onCreate={async (r) => {
            const { error } = await supabase.from("reservations").insert({
              id: r.id, hotel_id: HOTEL_ID, account_id: ACCOUNT_ID,
              guest_name: r.guestName, guest_phone: r.guestPhone,
              channel_code: r.channelCode, payment_collector: r.paymentCollector,
              room_type_id: r.roomTypeId, rate_plan_id: r.ratePlanId,
              check_in: r.checkIn, check_out: r.checkOut,
              adults: r.adults ?? r.guests, children: r.children ?? 0,
              total_amount: r.totalAmount, paid_amount: r.paidAmount,
              status: r.status, note: r.note ?? null, booked_at: r.createdAt,
            });
            if (error) return alert("Lưu đơn mới xuống cơ sở dữ liệu không thành công: " + error.message);
            if (r.roomNumbers.length > 0) {
              await supabase.from("reservation_rooms").insert(
                r.roomNumbers.map((n) => ({ reservation_id: r.id, room_number: n }))
              );
            }
            setReservations((prev) => [r, ...prev]);
            queueChannexDates(stayDates(r.checkIn, r.checkOut));
            setShowForm(false);
            resetFilters();
          }}
        />
      )}
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-[#68707a]">{label}</span>
      <span className="text-right font-medium text-[#17293e]">{value}</span>
    </div>
  );
}
