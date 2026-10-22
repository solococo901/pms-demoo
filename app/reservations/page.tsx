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
  getChannelName,
  getRoomTypeName,
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

// Round B: this page reads/writes the REAL database. Until the
// Auth step (Buoc 5), the app works as the demo account on the
// pilot hotel; after Auth these two constants come from the
// signed-in user instead.
const HOTEL_ID = currentHotelId();
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

  const detail = reservations.find((r) => r.id === detailId) ?? null;
  const detailNights = detail ? nightsOf(detail) : 0;
  const detailExtras = detail ? folioItems.filter((f) => f.reservationId === detail.id) : [];
  const extrasTotal = detailExtras.reduce((a, f) => a + f.amount, 0);
  const totalDue = detail ? detail.totalAmount + extrasTotal : 0;
  const balance = detail ? totalDue - detail.paidAmount : 0;

  // ---------- load everything from Supabase on open ----------
  useEffect(() => {
    (async () => {
      const [res, rr, folio, typesRes, roomsRes, plansRes] = await Promise.all([
        supabase.from("reservations").select("*").eq("hotel_id", HOTEL_ID).order("booked_at", { ascending: false }),
        supabase.from("reservation_rooms").select("reservation_id, room_number"),
        supabase.from("folio_items").select("*").eq("hotel_id", HOTEL_ID),
        supabase.from("room_types").select("*").eq("hotel_id", HOTEL_ID),
        supabase.from("rooms").select("*").eq("hotel_id", HOTEL_ID),
        supabase.from("rate_plans").select("*").eq("hotel_id", HOTEL_ID),
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
  async function patchReservation(id: string, patch: Partial<Reservation>) {
    const dbPatch: Record<string, unknown> = {};
    if (patch.status !== undefined) dbPatch.status = patch.status;
    if (patch.paidAmount !== undefined) dbPatch.paid_amount = patch.paidAmount;
    const { error } = await supabase.from("reservations").update(dbPatch).eq("id", id);
    if (error) return alert("Lưu xuống cơ sở dữ liệu không thành công: " + error.message);
    setReservations((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    if (patch.status !== undefined) {
      const r = reservations.find((x) => x.id === id);
      if (r) queueChannexDates(stayDates(r.checkIn, r.checkOut));
    }
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
                  <td className="px-3 py-3">₫{fmt(r.totalAmount)}</td>
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
          <div className="fixed inset-0 z-20 bg-[#17293e]/30" onClick={() => setDetailId(null)} />
          <div className="fixed inset-y-0 right-0 z-30 flex w-[26rem] max-w-[92vw] flex-col bg-white shadow-2xl">
            <div className="flex items-start justify-between border-b border-[#eef1f5] p-5">
              <div>
                <div className="text-lg font-bold text-[#17293e]">{detail.guestName}</div>
                <div className="text-sm text-[#68707a]">
                  Đơn {detail.id} · {getChannelName(detail.channelCode)} · {STATUS_LABELS[detail.status]}
                </div>
              </div>
              <button onClick={() => setDetailId(null)} className="cb-btn-ghost flex h-8 w-8 items-center justify-center rounded-full text-sm">✕</button>
            </div>

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
              </div>

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
