"use client";

// ============================================================
// File-DASH2-dashboard.tsx — Dashboard tong the kieu Cloudbeds
// (thay the app/page.tsx cu)
//  - Chon duoc NGAY cho khoi Activity: nut ‹ ›, o chon ngay,
//    nut "Hom nay" — moi so lieu ben duoi chay theo ngay do.
//  - Cot trai: the ngay + vong cong suat + so phong
//    (tong phong ban duoc / da dat / ngung ban / ngay bi chan).
//  - Activity: 7 o so (den / di / dang o / o tiep / don moi /
//    huy / ban lo) — bam vao o nao thi bang khach ben duoi
//    hien danh sach do; nut Check-in / Check-out chay that.
//  - Forecast: chon duoc KHOANG NGAY (tu-den + nut ‹ › dich
//    ca khoang), 5 chi so (cong suat / dem phong / ADR /
//    RevPAR / doanh thu) + 2 tab:
//      + "Da dat & bi chan": bieu do duong cong suat theo ngay.
//      + "Phong trong": luoi tung loai phong x tung ngay,
//        o = 0 to hong (het phong), co nut Prev/Next lat trang.
// ADR    = gia trung binh 1 dem phong DA BAN.
// RevPAR = doanh thu / phong SAN CO (ban hay khong) —
//          con so "suc khoe kinh doanh" cua nganh.
// So lieu tinh tu Supabase (reservations, rooms, room_blocks)
// cua khach san dang chon; du lieu mau chi de hien tam.
// ============================================================

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { supabase } from "@/lib/supabase";
import { currentHotelId } from "@/lib/current-hotel";
import { useParams } from "next/navigation";
import {
  RESERVATIONS,
  ROOMS,
  getChannelName,
  getRoomTypeName,
  type Reservation,
  type Room,
} from "@/lib/mock-data";

import { STATUS_LABELS } from "@/components/ReservationBar";

// ---------- small date/money helpers ----------
const DAY_MS = 24 * 60 * 60 * 1000;
const toDate = (iso: string) => new Date(iso + "T12:00:00");
const localISO = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const addDays = (iso: string, n: number) =>
  localISO(new Date(toDate(iso).getTime() + n * DAY_MS));
const nightsBetween = (a: string, b: string) =>
  Math.round((toDate(b).getTime() - toDate(a).getTime()) / DAY_MS);
const fmtDate = (iso: string) => {
  const d = toDate(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
};
const WEEKDAYS = [
  "Chủ Nhật", "Thứ Hai", "Thứ Ba", "Thứ Tư", "Thứ Năm", "Thứ Sáu", "Thứ Bảy",
];
const MONTHS = [
  "Tháng 1", "Tháng 2", "Tháng 3", "Tháng 4", "Tháng 5", "Tháng 6",
  "Tháng 7", "Tháng 8", "Tháng 9", "Tháng 10", "Tháng 11", "Tháng 12",
];
const WEEKDAYS_SHORT = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];


const HK_CHIP: Record<string, { label: string; cls: string }> = {
  dirty: { label: "Chưa dọn", cls: "bg-red-50 text-red-600" },
  in_progress: { label: "Đang dọn", cls: "bg-amber-50 text-amber-600" },
  out_of_order: { label: "Ngừng bán", cls: "bg-gray-100 text-gray-500" },
};

// Mau huy hieu theo kenh (nhin la biet don ve tu dau)
const CHANNEL_CHIP: Record<string, string> = {
  booking_com: "bg-[#e8f0fe] text-[#1a56db]",
  expedia: "bg-[#fef3c7] text-[#92400e]",
  airbnb: "bg-[#ffe4e0] text-[#c2410c]",
  agoda: "bg-[#ede9fe] text-[#5b21b6]",
  website: "bg-[#dcfce7] text-[#15803d]",
  frontdesk: "bg-[#f1f5f9] text-[#475569]",
};

// ---------- Lich chon ngay kieu Cloudbeds (khong dung o date mac dinh) ----------
// O date mac dinh cua trinh duyet xau va moi trinh duyet hien mot kieu,
// nen tu ve lich: nut dang vien thuoc (pill) + bang lich bat len khi bam,
// giong bang lich trong anh Cloudbeds (chon thang/nam, ngay hom nay
// vien xanh, ngay dang chon nen xanh dam).
type CalView = { y: number; m: number };

function monthCells(year: number, month: number) {
  const offset = (new Date(year, month, 1).getDay() + 6) % 7; // tuan bat dau tu Thu 2
  const days = new Date(year, month + 1, 0).getDate();
  const cells: (string | null)[] = [];
  for (let i = 0; i < offset; i++) cells.push(null);
  const p = (n: number) => String(n).padStart(2, "0");
  for (let d = 1; d <= days; d++) cells.push(`${year}-${p(month + 1)}-${p(d)}`);
  return cells;
}

function CalendarPopup({ view, setView, dayClass, onDay, footer }: {
  view: CalView;
  setView: (v: CalView) => void;
  dayClass: (day: string) => string;
  onDay: (day: string) => void;
  footer?: ReactNode;
}) {
  const cells = monthCells(view.y, view.m);
  const todayISO = localISO(new Date());
  const shiftMonth = (d: number) => {
    const dt = new Date(view.y, view.m + d, 1);
    setView({ y: dt.getFullYear(), m: dt.getMonth() });
  };
  return (
    <div className="absolute right-0 z-50 mt-2 w-[304px] rounded-xl border border-[#dde3ea] bg-white p-3 shadow-xl">
      <div className="flex items-center justify-between gap-2">
        <button className="cb-btn-ghost px-2 py-1 text-sm" onClick={() => shiftMonth(-1)}>‹</button>
        <div className="flex gap-1">
          <select
            className="cb-input-pill px-2 py-1 text-sm" value={view.m}
            onChange={(e) => setView({ ...view, m: Number(e.target.value) })}
          >
            {MONTHS.map((label, i) => (<option key={label} value={i}>{label}</option>))}
          </select>
          <select
            className="cb-input-pill px-2 py-1 text-sm" value={view.y}
            onChange={(e) => setView({ ...view, y: Number(e.target.value) })}
          >
            {Array.from({ length: 9 }, (_, i) => 2024 + i).map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>
        <button className="cb-btn-ghost px-2 py-1 text-sm" onClick={() => shiftMonth(1)}>›</button>
      </div>
      <div className="mt-3 grid grid-cols-7 gap-1 text-center text-[11px] font-medium text-[#68707a]">
        {["T2", "T3", "T4", "T5", "T6", "T7", "CN"].map((d) => (<div key={d}>{d}</div>))}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-1">
        {cells.map((day, i) =>
          day === null ? (
            <div key={`b-${i}`} />
          ) : (
            <button
              key={day}
              onClick={() => onDay(day)}
              className={`rounded-lg py-1.5 text-sm ${dayClass(day)} ${day === todayISO ? "ring-1 ring-[#2563eb]" : ""}`}
            >
              {toDate(day).getDate()}
            </button>
          )
        )}
      </div>
      {footer && <div className="mt-3 border-t border-[#eef1f5] pt-2">{footer}</div>}
    </div>
  );
}

// Chon 1 ngay (dung cho ngay xem Activity)
function DatePicker({ value, onChange }: { value: string; onChange: (iso: string) => void }) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<CalView>(() => ({ y: toDate(value).getFullYear(), m: toDate(value).getMonth() }));
  const openPicker = () => {
    setView({ y: toDate(value).getFullYear(), m: toDate(value).getMonth() });
    setOpen(true);
  };
  return (
    <div className="relative">
      <button className="cb-input-pill px-4 py-1.5 text-sm font-medium" onClick={() => (open ? setOpen(false) : openPicker())}>
        📅 {fmtDate(value)}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <CalendarPopup
            view={view} setView={setView}
            dayClass={(day) => (day === value ? "bg-[#2563eb] font-bold text-white" : "hover:bg-[#eef1f5]")}
            onDay={(day) => { onChange(day); setOpen(false); }}
            footer={
              <button className="cb-btn-ghost w-full py-1.5 text-sm" onClick={() => { onChange(localISO(new Date())); setOpen(false); }}>
                Hôm nay
              </button>
            }
          />
        </>
      )}
    </div>
  );
}

// Chon 1 khoang ngay (dung cho Forecast): bam ngay bat dau, roi ngay
// ket thuc — khoang giua to xanh nhat, 2 dau to xanh dam. Bam nguoc
// (ngay ket thuc truoc ngay bat dau) thi tu dao lai cho dung.
function DateRangePicker({ from, to, onChange }: { from: string; to: string; onChange: (f: string, t: string) => void }) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<CalView>(() => ({ y: toDate(from).getFullYear(), m: toDate(from).getMonth() }));
  const [start, setStart] = useState<string | null>(null);
  const openPicker = () => {
    setView({ y: toDate(from).getFullYear(), m: toDate(from).getMonth() });
    setStart(null);
    setOpen(true);
  };
  const pick = (day: string) => {
    if (!start) { setStart(day); return; }
    const f = day < start ? day : start;
    const t = day < start ? start : day;
    onChange(f, t === f ? addDays(f, 1) : t);
    setStart(null);
    setOpen(false);
  };
  const dayClass = (day: string) => {
    if (start && day === start) return "bg-[#2563eb] font-bold text-white";
    if (!start && (day === from || day === to)) return "bg-[#2563eb] font-bold text-white";
    if (!start && day > from && day < to) return "bg-[#dbeafe]";
    if (start && day > start) return "bg-[#dbeafe]";
    return "hover:bg-[#eef1f5]";
  };
  return (
    <div className="relative">
      <button className="cb-input-pill px-4 py-1.5 text-sm font-medium" onClick={() => (open ? setOpen(false) : openPicker())}>
        📅 {fmtDate(from)} – {fmtDate(to)}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <CalendarPopup
            view={view} setView={setView}
            dayClass={dayClass}
            onDay={pick}
            footer={
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-[#68707a]">
                  {start ? `Đã chọn bắt đầu ${fmtDate(start)} — bấm tiếp ngày kết thúc` : "Bấm ngày bắt đầu, rồi ngày kết thúc"}
                </span>
                {start && (
                  <button className="cb-btn-ghost shrink-0 px-3 py-1 text-xs" onClick={() => setStart(null)}>Đặt lại</button>
                )}
              </div>
            }
          />
        </>
      )}
    </div>
  );
}

type TabKey =
  | "arrivals" | "departures" | "inhouse" | "stayovers"
  | "bookings" | "cancelations" | "overbookings";

type Block = { roomNumber: string; fromDate: string; toDate: string; kind: string };

const PAGE_DAYS = 14; // luoi Phong trong: 14 ngay / trang

function DashboardPage() {
  // Khach san lay tu URL /h/[hotelId] khi co; neu khong thi dung khach san da luu theo tab.
  const params = useParams();
  const HOTEL_ID = typeof params.hotelId === "string" ? params.hotelId : currentHotelId();
  const IS_USD = HOTEL_ID === "test-property";
  const fmtMoney = (n: number) =>
    IS_USD
      ? `$${Math.round(n).toLocaleString("en-US")}`
      : `${Math.round(n).toLocaleString("vi-VN")}₫`;
  const [reservations, setReservations] =
    useState<Reservation[]>(RESERVATIONS);
  const [rooms, setRooms] = useState<Room[]>(ROOMS);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [hotelName, setHotelName] = useState("CityHouse MARK El Pino Realm");
  const [dbError, setDbError] = useState("");
  const [tab, setTab] = useState<TabKey>("arrivals");
  const [showAllArrivals, setShowAllArrivals] = useState(false);

  // Ngay xem Activity (mac dinh: hom nay that, khong phai ngay mau)
  const [selectedDate, setSelectedDate] = useState(() => localISO(new Date()));
  // Khoang ngay Forecast (mac dinh: 28 dem tu hom nay, nhu anh mau)
  const [fcFrom, setFcFrom] = useState(() => localISO(new Date()));
  const [fcTo, setFcTo] = useState(() => addDays(localISO(new Date()), 28));
  const [chartMode, setChartMode] = useState<"booked" | "available">("booked");
  const [availPage, setAvailPage] = useState(0);
  const [refreshKey, setRefreshKey] = useState(0);

  const totalRooms = rooms.length;
  const outOfService = rooms.filter(
    (r) => r.housekeepingStatus === "out_of_order"
  ).length;
  const sellableUnits = Math.max(totalRooms - outOfService, 0);
  const roomTypeOf = useMemo(() => {
    const m = new Map<string, string>();
    rooms.forEach((r) => m.set(r.number, r.roomTypeId));
    return m;
  }, [rooms]);
  const roomStatusOf = useMemo(() => {
    const m = new Map<string, string>();
    rooms.forEach((r) => m.set(r.number, r.housekeepingStatus));
    return m;
  }, [rooms]);

  // ----- LOAD this hotel's rooms + reservations + blocks -----
  useEffect(() => {
    (async () => {
      const [hotelRes, roomsRes, resRes, blocksRes] = await Promise.all([
        supabase.from("hotels").select("name").eq("id", HOTEL_ID).single(),
        supabase.from("rooms").select("*").eq("hotel_id", HOTEL_ID),
        supabase.from("reservations").select("*").eq("hotel_id", HOTEL_ID),
        supabase.from("room_blocks").select("*").eq("hotel_id", HOTEL_ID),
      ]);
      const err =
        hotelRes.error ?? roomsRes.error ?? resRes.error ?? blocksRes.error;
      if (err) { setDbError(err.message); return; }
      // reservation_rooms has no hotel_id column — fetch the room
      // assignments BY the reservation ids of this hotel instead.
      const resIds = (resRes.data ?? []).map((r) => r.id);
      const { data: rrData } = resIds.length > 0
        ? await supabase.from("reservation_rooms").select("reservation_id, room_number").in("reservation_id", resIds)
        : { data: [] as { reservation_id: string; room_number: string }[] };
      if (hotelRes.data) setHotelName(hotelRes.data.name);
      setRooms((roomsRes.data ?? []).map((r) => ({
        number: r.number, roomTypeId: r.room_type_id,
        housekeepingStatus: (r.housekeeping_status ?? "clean") as Room["housekeepingStatus"],
      })));
      setBlocks((blocksRes.data ?? []).map((b) => ({
        roomNumber: b.room_number, fromDate: b.from_date,
        toDate: b.to_date, kind: b.kind,
      })));
      const roomsByRes = new Map<string, string[]>();
      for (const rr of rrData ?? []) {
        const list = roomsByRes.get(rr.reservation_id) ?? [];
        list.push(rr.room_number);
        roomsByRes.set(rr.reservation_id, list);
      }
      setReservations((resRes.data ?? []).map((row) => ({
        id: row.id, guestName: row.guest_name, guestPhone: row.guest_phone ?? "", channelCode: row.channel_code,
        paymentCollector: (row.payment_collector ?? "hotel_collect") as Reservation["paymentCollector"],
        roomTypeId: row.room_type_id, ratePlanId: row.rate_plan_id ?? "",
        roomNumbers: roomsByRes.get(row.id) ?? [],
        checkIn: row.check_in, checkOut: row.check_out,
        guests: (row.adults ?? 1) + (row.children ?? 0),
        adults: row.adults ?? undefined, children: row.children ?? undefined,
        totalAmount: row.total_amount, paidAmount: row.paid_amount,
        status: row.status as Reservation["status"],
        createdAt: (row.booked_at ?? "").slice(0, 10),
        note: row.note ?? undefined,
      })));
    })();
  }, [refreshKey]);

  // Does this booking occupy rooms on the given night?
  const covers = (r: Reservation, day: string) =>
    (r.status === "confirmed" || r.status === "in_house") &&
    r.checkIn <= day &&
    day < r.checkOut;

  // Rooms blocked OUT OF ORDER (subtracted from sellable) on a night
  const oooRoomsOn = (day: string) => {
    const set = new Set<string>();
    blocks
      .filter((b) => b.kind === "out_of_order" && b.fromDate <= day && day <= b.toDate)
      .forEach((b) => set.add(b.roomNumber));
    return set;
  };
  // Rooms left to sell for one night, optionally for one room type.
  // Rule (goi Ton phong): OOO tru khoi ton, OOS khong tru.
  const roomsLeftOn = (day: string, typeId?: string) => {
    const ooo = oooRoomsOn(day);
    const typeRooms = rooms.filter((rm) => !typeId || rm.roomTypeId === typeId);
    const sellable = typeRooms.filter((rm) => !ooo.has(rm.number)).length;
    let occupied = 0;
    reservations
      .filter((r) => covers(r, day) && (!typeId || r.roomTypeId === typeId))
      .forEach((r) => {
        const assigned = r.roomNumbers.filter(
          (n) => !typeId || roomTypeOf.get(n) === typeId
        ).length;
        occupied += Math.max(assigned, r.roomNumbers.length === 0 ? 1 : 0);
      });
    return Math.max(sellable - occupied, 0);
  };

  // ---------- occupancy donut (selected date) ----------
  const occupiedUnits = useMemo(() => {
    let n = 0;
    reservations
      .filter((r) => covers(r, selectedDate))
      .forEach((r) => { n += Math.max(r.roomNumbers.length, 1); });
    return Math.min(n, sellableUnits);
  }, [reservations, selectedDate, sellableUnits]);
  const occupancyPct =
    sellableUnits > 0 ? Math.round((occupiedUnits / sellableUnits) * 10000) / 100 : 0;
  const blockedDates = blocks.filter(
    (b) => b.fromDate <= selectedDate && selectedDate <= b.toDate
  ).length;
  const selDate = toDate(selectedDate);

  // ---------- Activity lists (selected date) ----------
  const arrivals = reservations.filter(
    (r) => r.status === "confirmed" && r.checkIn === selectedDate
  );
  const arrivalsPlus = reservations.filter(
    (r) =>
      r.status === "confirmed" &&
      (r.checkIn === selectedDate || r.checkIn === addDays(selectedDate, 1))
  );
  const departures = reservations.filter(
    (r) =>
      (r.status === "in_house" || r.status === "confirmed") &&
      r.checkOut === selectedDate
  );
  const inHouse = reservations.filter((r) => r.status === "in_house");
  const stayovers = inHouse.filter(
    (r) => r.checkIn < selectedDate && r.checkOut > selectedDate
  );
  const bookingsToday = reservations.filter(
    (r) => r.createdAt === selectedDate && r.status !== "cancelled"
  );
  const cancelations = reservations.filter((r) => r.status === "cancelled");

  // An unassigned booking is an OVERBOOKING only when no room of
  // its type is free for the whole stay.
  const canFit = (b: Reservation) => {
    const nights = Array.from({ length: nightsBetween(b.checkIn, b.checkOut) },
      (_, i) => addDays(b.checkIn, i));
    return rooms.filter(
      (room) => room.roomTypeId === b.roomTypeId &&
        room.housekeepingStatus !== "out_of_order"
    ).some((room) =>
      nights.every(
        (night) =>
          !reservations.some(
            (other) =>
              other.id !== b.id &&
              covers(other, night) &&
              other.roomNumbers.includes(room.number)
          )
      )
    );
  };
  const overbookings = reservations.filter(
    (r) => r.status === "confirmed" && r.roomNumbers.length === 0 && !canFit(r)
  );

  const sumGuests = (list: Reservation[]) =>
    list.reduce((s, r) => s + (r.guests || 1), 0);
  const TABS: { key: TabKey; label: string; value: number; badge?: number }[] = [
    { key: "arrivals", label: "Khách đến", value: arrivals.length, badge: sumGuests(arrivals) },
    { key: "departures", label: "Khách đi", value: departures.length, badge: sumGuests(departures) },
    { key: "inhouse", label: "Đang ở", value: inHouse.length },
    { key: "stayovers", label: "Ở tiếp", value: stayovers.length },
    { key: "bookings", label: "Đơn mới", value: bookingsToday.length },
    { key: "cancelations", label: "Huỷ", value: cancelations.length },
    { key: "overbookings", label: "Bán lố", value: overbookings.length },
  ];
  const listForTab: Record<TabKey, Reservation[]> = {
    arrivals: showAllArrivals ? arrivalsPlus : arrivals,
    departures,
    inhouse: inHouse,
    stayovers,
    bookings: bookingsToday,
    cancelations,
    overbookings,
  };
  const rows = listForTab[tab];

  const setStatus = async (id: string, status: Reservation["status"]) => {
    setReservations((prev) =>
      prev.map((r) => (r.id === id ? { ...r, status } : r))
    );
    const { error } = await supabase.from("reservations").update({ status }).eq("id", id);
    if (error) setDbError(error.message);
  };

  // ---------- Forecast (selected range) ----------
  const fcNights = Math.max(nightsBetween(fcFrom, fcTo), 1);
  const fcDays = useMemo(
    () => Array.from({ length: fcNights }, (_, i) => addDays(fcFrom, i)),
    [fcFrom, fcNights]
  );
  const forecast = useMemo(() => {
    let roomNights = 0;
    let revenue = 0;
    const pctSeries: number[] = [];
    const availSeries: number[] = [];
    for (const day of fcDays) {
      const ooo = oooRoomsOn(day);
      const sellableDay = Math.max(
        rooms.filter((rm) => !ooo.has(rm.number)).length - outOfService, 0
      );
      let occupied = 0;
      reservations
        .filter((r) => covers(r, day))
        .forEach((r) => {
          const roomsCount = Math.max(r.roomNumbers.length, 1);
          occupied += roomsCount;
          roomNights += roomsCount;
          revenue += r.totalAmount / Math.max(nightsBetween(r.checkIn, r.checkOut), 1);
        });
      pctSeries.push(sellableDay > 0 ? (Math.min(occupied, sellableDay) / sellableDay) * 100 : 0);
      availSeries.push(Math.max(sellableDay - occupied, 0));
    }
    const availableNights = Math.max(
      rooms.filter((rm) => true).length - outOfService, 0
    ) * fcNights;
    return {
      pctSeries, availSeries, roomNights, revenue,
      occupancy: availableNights > 0 ? (roomNights / availableNights) * 100 : 0,
      adr: roomNights > 0 ? revenue / roomNights : 0,
      revpar: availableNights > 0 ? revenue / availableNights : 0,
    };
  }, [reservations, fcDays, fcNights, rooms, outOfService, blocks]);

  // Line chart geometry (SVG, dynamic length)
  const chartValues =
    chartMode === "booked" ? forecast.pctSeries : forecast.availSeries;
  const chartMax =
    chartMode === "booked" ? 100 : Math.max(...forecast.availSeries, 1);
  // Vach chia truc dung: che do % thi 0-100%, che do phong trong
  // thi dem theo so phong (toi da 12 vach, khong thi thua mau).
  const gridSteps =
    chartMode === "booked"
      ? [0, 25, 50, 75, 100]
      : chartMax <= 12
        ? Array.from({ length: chartMax + 1 }, (_, i) => i)
        : [0, Math.round(chartMax / 4), Math.round(chartMax / 2), Math.round((chartMax * 3) / 4), chartMax];
  // Bieu do full chieu rong cua the: ban cu dung width co dinh 720px
  // nen trong the rong bieu do chi chiem 1 ben trai. Ban moi dung
  // viewBox lon + w-full de SVG tu gian theo khung.
  const CW = 1200, CH = 160, ML = 44, MR = 16, MT = 10, MB = 24;
  const plotW = CW - ML - MR;
  const plotH = CH - MT - MB;
  const chartX = (i: number) =>
    fcNights <= 1 ? ML + plotW / 2 : ML + (i * plotW) / (fcNights - 1);
  const chartY = (v: number) => MT + plotH - (v / chartMax) * plotH;
  const points = chartValues.map((v, i) => `${chartX(i)},${chartY(v)}`).join(" ");
  const areaPoints =
    `${ML},${MT + plotH} ${points} ${chartX(chartValues.length - 1)},${MT + plotH}`;
  // Nhan truc ngay: khoang dai thi hien cach ngay de khoi chong chu
  const labelStep = fcNights > 14 ? Math.ceil(fcNights / 14) : 1;

  // Availability grid: one page of PAGE_DAYS inside the range
  const totalAvailPages = Math.max(Math.ceil(fcNights / PAGE_DAYS), 1);
  const safeAvailPage = Math.min(availPage, totalAvailPages - 1);
  const availDays = fcDays.slice(
    safeAvailPage * PAGE_DAYS, safeAvailPage * PAGE_DAYS + PAGE_DAYS
  );
  const typeIds = useMemo(() => {
    const seen = new Set<string>();
    rooms.forEach((r) => seen.add(r.roomTypeId));
    return [...seen];
  }, [rooms]);
  const shiftRange = (dir: 1 | -1) => {
    setFcFrom(addDays(fcFrom, dir * fcNights));
    setFcTo(addDays(fcTo, dir * fcNights));
    setAvailPage(0);
  };
  const applyRange = (from: string, to: string) => {
    setFcFrom(from);
    setFcTo(to <= from ? addDays(from, 1) : to);
    setAvailPage(0);
  };

  // Donut geometry
  const CIRC = 2 * Math.PI * 54;
  const donutDash = `${(occupancyPct / 100) * CIRC} ${CIRC}`;

  return (
    <div>
      {dbError && <p className="mb-4 rounded-lg bg-[#fdecec] px-3 py-2 text-sm text-[#e5484d]">Lỗi cơ sở dữ liệu: {dbError}</p>}
      {/* ===== Header: date navigation ===== */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-[#17293e]">Tổng quan</h1>
        <div className="flex items-center gap-2">
          <button
            className="cb-btn-ghost px-3 py-1.5 text-sm"
            onClick={() => setRefreshKey((k) => k + 1)}
            title="Tải lại số liệu"
          >↻</button>
          <button className="cb-btn-ghost px-3 py-1.5 text-sm" onClick={() => setSelectedDate(addDays(selectedDate, -1))}>‹</button>
          <DatePicker value={selectedDate} onChange={setSelectedDate} />
          <button className="cb-btn-ghost px-4 py-1.5 text-sm" onClick={() => setSelectedDate(localISO(new Date()))}>Hôm nay</button>
          <button className="cb-btn-ghost px-3 py-1.5 text-sm" onClick={() => setSelectedDate(addDays(selectedDate, 1))}>›</button>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-5 xl:grid-cols-[280px_1fr]">
        {/* ===== Left column: date + occupancy ===== */}
        <div className="space-y-5">
          <div className="cb-card p-5">
            <div className="text-sm text-[#68707a]">{WEEKDAYS[selDate.getDay()]}</div>
            <div className="text-6xl font-bold leading-tight text-[#68707a]">{selDate.getDate()}</div>
            <div className="text-sm text-[#68707a]">{MONTHS[selDate.getMonth()]} {selDate.getFullYear()}</div>
            <div className="mt-3 text-xs text-[#68707a]">{hotelName}</div>
          </div>

          <div className="cb-card p-5">
            <div className="flex justify-center">
              <svg width="150" height="150" viewBox="0 0 150 150">
                <circle cx="75" cy="75" r="54" fill="none" stroke="#e5e9ef" strokeWidth="14" />
                <circle
                  cx="75" cy="75" r="54" fill="none" stroke="#1db584" strokeWidth="14"
                  strokeDasharray={donutDash} strokeLinecap="round"
                  transform="rotate(-90 75 75)"
                />
                <text x="75" y="72" textAnchor="middle" fontSize="24" fontWeight="bold" fill="#17293e">
                  {occupancyPct.toFixed(2)}%
                </text>
                <text x="75" y="92" textAnchor="middle" fontSize="11" fill="#68707a">Công suất</text>
              </svg>
            </div>
            <div className="mt-4 space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-[#68707a]">Phòng bán được</span><b>{sellableUnits}</b></div>
              <div className="flex justify-between"><span className="text-[#68707a]">Phòng đã đặt</span><b>{occupiedUnits}</b></div>
              <div className="flex justify-between"><span className="text-[#68707a]">Phòng còn trống</span><b>{Math.max(sellableUnits - occupiedUnits, 0)}</b></div>
              <div className="flex justify-between"><span className="text-[#68707a]">Ngừng bán</span><b>{outOfService}</b></div>
              <div className="flex justify-between"><span className="text-[#68707a]">Ngày bị chặn</span><b>{blockedDates}</b></div>
            </div>
          </div>
        </div>

        {/* ===== Activity ===== */}
        <div className="cb-card p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-[#17293e]">Hoạt động ngày {fmtDate(selectedDate)}</h2>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
            {TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`rounded-xl border p-3 text-left ${tab === t.key ? "border-[#2563eb] ring-1 ring-[#2563eb]" : "border-[#dde3ea]"}`}
              >
                <div className="flex items-baseline gap-1.5">
                  <span className="text-xl font-bold text-[#17293e]">{t.value}</span>
                  {t.badge !== undefined && (
                    <span className="rounded-full bg-[#2563eb] px-1.5 py-0.5 text-[11px] font-bold text-white">{t.badge}</span>
                  )}
                </div>
                <div className="text-xs text-[#68707a]">{t.label}</div>
              </button>
            ))}
          </div>

          <div className="overflow-x-auto">
          <table className="mt-4 w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-[#dde3ea] text-left text-[#68707a]">
                <th className="py-2 pr-2 font-medium">Khách</th>
                <th className="py-2 pr-2 font-medium">Phòng</th>
                <th className="py-2 pr-2 font-medium">Lưu trú</th>
                <th className="py-2 pr-2 font-medium">Nguồn</th>
                <th className="py-2 font-medium">Trạng thái</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const firstRoom = r.roomNumbers[0];
                const hk = firstRoom ? roomStatusOf.get(firstRoom) : undefined;
                const chip = hk && hk !== "clean" ? HK_CHIP[hk] : undefined;
                return (
                  <tr key={r.id} className="border-b border-[#eef1f5] align-top">
                    <td className="py-3 pr-2">
                      <div className="font-semibold text-[#17293e]">{r.guestName}</div>
                      <div className="text-xs text-[#68707a]">{hotelName} – {r.id}</div>
                      {chip && <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[11px] ${chip.cls}`}>{chip.label}</span>}
                    </td>
                    <td className="py-3 pr-2">
                      {r.roomNumbers.length > 0 ? (
                        <span>{r.roomNumbers.join(", ")} – {getRoomTypeName(r.roomTypeId)}</span>
                      ) : (
                        <span>{getRoomTypeName(r.roomTypeId)} <span className="text-[#68707a]">(chưa xếp phòng)</span></span>
                      )}
                    </td>
                    <td className="py-3 pr-2">
                      <div>{fmtDate(r.checkIn)} – {fmtDate(r.checkOut)}</div>
                      <div className="text-xs text-[#68707a]">
                        {nightsBetween(r.checkIn, r.checkOut)} đêm · {r.guests || 1} khách
                      </div>
                    </td>
                    <td className="py-3 pr-2">
                      <span
                        className={`inline-block whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ${CHANNEL_CHIP[r.channelCode] ?? "bg-[#f1f5f9] text-[#475569]"}`}
                        title={r.paymentCollector === "channel_collect" ? "Kênh thu hộ tiền" : "Khách sạn thu tiền"}
                      >
                        {getChannelName(r.channelCode)}
                      </span>
                    </td>
                    <td className="py-3">
                      {tab === "arrivals" && (
                        <button className="cb-btn-primary rounded-full px-4 py-1.5 text-xs" onClick={() => setStatus(r.id, "in_house")}>Check-in</button>
                      )}
                      {tab === "departures" && (
                        <button className="cb-btn-primary rounded-full px-4 py-1.5 text-xs" onClick={() => setStatus(r.id, "checked_out")}>Check-out</button>
                      )}
                      {tab !== "arrivals" && tab !== "departures" && (
                        <span className="text-xs text-[#68707a]">{STATUS_LABELS[r.status] ?? r.status}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr><td colSpan={5} className="py-6 text-center text-sm text-[#68707a]">Không có dữ liệu cho mục này trong ngày đã chọn.</td></tr>
              )}
            </tbody>
          </table>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-[#f4f6f9] px-3 py-2">
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={showAllArrivals}
                onChange={(e) => setShowAllArrivals(e.target.checked)}
              />
              Xem cả khách đến ngày mai
            </label>
            <span className="text-sm text-[#68707a]">Khách đến trong ngày: <b className="text-[#17293e]">{sumGuests(arrivals)}</b></span>
          </div>
        </div>
      </div>

      {/* ===== Forecast ===== */}
      <div className="cb-card mt-5 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-bold text-[#17293e]">Dự báo</h2>
          <div className="flex flex-wrap items-center gap-2">
            <button className="cb-btn-ghost px-3 py-1.5 text-sm" onClick={() => shiftRange(-1)}>‹</button>
            <DateRangePicker from={fcFrom} to={fcTo} onChange={(f, t) => applyRange(f, t)} />
            <button className="cb-btn-ghost px-3 py-1.5 text-sm" onClick={() => shiftRange(1)}>›</button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {[
            { label: "Công suất", value: `${forecast.occupancy.toFixed(2)}%` },
            { label: "Đêm phòng", value: String(forecast.roomNights) },
            { label: "ADR", value: fmtMoney(forecast.adr) },
            { label: "RevPAR", value: fmtMoney(forecast.revpar) },
            { label: "Doanh thu", value: fmtMoney(forecast.revenue) },
          ].map((k) => (
            <div key={k.label} className="rounded-xl border border-[#dde3ea] px-4 py-2">
              <div className="text-base font-bold text-[#17293e]">{k.value}</div>
              <div className="text-xs text-[#68707a]">{k.label}</div>
            </div>
          ))}
        </div>

        <div className="mt-5 flex gap-5 border-b border-[#dde3ea] text-sm">
          <button
            className={`pb-2 font-semibold ${chartMode === "booked" ? "border-b-2 border-[#2563eb] text-[#2563eb]" : "text-[#68707a]"}`}
            onClick={() => setChartMode("booked")}
          >Đã đặt & bị chặn</button>
          <button
            className={`pb-2 font-semibold ${chartMode === "available" ? "border-b-2 border-[#2563eb] text-[#2563eb]" : "text-[#68707a]"}`}
            onClick={() => setChartMode("available")}
          >Phòng trống</button>
        </div>

        {chartMode === "booked" ? (
          <div className="mt-4">
            <svg viewBox={`0 0 ${CW} ${CH}`} className="h-auto w-full">
              {gridSteps.map((g) => (
                <g key={g}>
                  <line x1={ML} x2={CW - MR} y1={chartY(g)} y2={chartY(g)} stroke="#e5e9ef" strokeDasharray="4 4" />
                  <text x={ML - 8} y={chartY(g) + 4} textAnchor="end" fontSize="12" fill="#68707a">{chartMode === "booked" ? `${g}%` : g}</text>
                </g>
              ))}
              <polygon points={areaPoints} fill="#2563eb" opacity="0.08" />
              <polyline points={points} fill="none" stroke="#2563eb" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
              {chartValues.map((v, i) => (
                <circle key={i} cx={chartX(i)} cy={chartY(v)} r="3.5" fill="#2563eb" stroke="#fff" strokeWidth="1.5">
                  <title>{fmtDate(fcDays[i])}: {chartMode === "booked" ? `${v.toFixed(1)}%` : `${v} phòng trống`}</title>
                </circle>
              ))}
              {fcDays.map((d, i) =>
                i % labelStep === 0 || i === fcNights - 1 ? (
                  <text key={d} x={chartX(i)} y={CH - 8} textAnchor="middle" fontSize="11" fill="#68707a">
                    {toDate(d).getDate()}/{toDate(d).getMonth() + 1}
                  </text>
                ) : null
              )}
            </svg>
            <p className="mt-1 text-xs text-[#68707a]">Di chuột lên chấm để xem công suất từng ngày (chấm = % phòng bán được đã có khách đêm đó).</p>
          </div>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="text-[#68707a]">
                  <th className="py-2 pr-2 text-left font-medium">Loại phòng</th>
                  {availDays.map((d) => (
                    <th key={d} className="px-1 py-2 text-center font-medium">
                      <div className="text-[11px]">{WEEKDAYS_SHORT[toDate(d).getDay()]}</div>
                      <div>{toDate(d).getDate()}</div>
                    </th>
                  ))}
                </tr>
                <tr className="text-[#68707a]">
                  <td className="py-1 pr-2 text-xs">Tổng còn trống</td>
                  {availDays.map((d) => (
                    <td key={d} className="px-1 py-1 text-center">
                      <span className="rounded-full border border-[#dde3ea] px-2 py-0.5 text-xs">
                        {roomsLeftOn(d)}
                      </span>
                    </td>
                  ))}
                </tr>
              </thead>
              <tbody>
                {typeIds.map((t) => (
                  <tr key={t} className="border-t border-[#eef1f5]">
                    <td className="py-2 pr-2 font-medium text-[#17293e]">{getRoomTypeName(t)}</td>
                    {availDays.map((d) => {
                      const left = roomsLeftOn(d, t);
                      return (
                        <td key={d} className="px-1 py-2 text-center">
                          <span className={`inline-block min-w-[28px] rounded-full px-2 py-0.5 text-xs ${left === 0 ? "bg-[#fdecec] text-[#e5484d]" : "text-[#17293e]"}`}>
                            {left}
                          </span>
                        </td>
                      );
                    })}
                  </tr>
                ))}
                {typeIds.length === 0 && (
                  <tr><td colSpan={availDays.length + 1} className="py-6 text-center text-sm text-[#68707a]">Chưa có phòng nào cho khách sạn này.</td></tr>
                )}
              </tbody>
            </table>
            <div className="mt-3 flex items-center gap-2">
              <button className="cb-btn-ghost px-4 py-1.5 text-sm disabled:opacity-40" disabled={safeAvailPage === 0} onClick={() => setAvailPage(safeAvailPage - 1)}>Prev</button>
              <span className="text-sm text-[#68707a]">Trang {safeAvailPage + 1}/{totalAvailPages} · {fmtDate(fcFrom)} – {fmtDate(fcTo)}</span>
              <button className="cb-btn-ghost px-4 py-1.5 text-sm disabled:opacity-40" disabled={safeAvailPage >= totalAvailPages - 1} onClick={() => setAvailPage(safeAvailPage + 1)}>Next</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Wrapper: dashboard chi render sau khi mount (client-only). Ly do:
// dashboard khoi tao state bang new Date() ("hom nay that") — neu
// render o server, Next 16 bao loi "unstable value" va ngay co the
// lech do mui gio server/client. Gate o day sua mot lan cho moi
// cho dung new Date() trong file (state ngay + todayISO), khong
// can doi tung cho, va du lieu chi nap 1 lan voi ngay that.
export default function DashboardPageWrapper() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);
  if (!mounted) {
    return <p className="p-6 text-sm text-[#68707a]">Đang tải dashboard...</p>;
  }
  return <DashboardPage />;
}
