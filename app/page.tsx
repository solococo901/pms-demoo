"use client";

// ============================================================
// FILE 3 — app/page.tsx (Cloudbeds-style Dashboard)
// The first screen staff see, modeled on the Cloudbeds home:
//  - left column: date card + occupancy donut card
//  - Activity card: 7 clickable stat boxes + guest table
//    (the Check-in / Check-out buttons really work)
//  - Forecast card: occupancy / room nights / ADR / RevPAR /
//    revenue for the next 14 days + a line chart
// ADR    = average price of one SOLD room-night.
// RevPAR = revenue per AVAILABLE room (sold or not) — the
//          standard "business health" number of the industry.
// This page has buttons and tabs, so it needs "use client".
// All numbers are computed from lib/mock-data.ts.
// ============================================================

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { currentHotelId } from "@/lib/current-hotel";
import {
  RESERVATIONS,
  ROOMS,
  TODAY,
  getRoomTypeName,
  type Reservation,
  type Room,
} from "@/lib/mock-data";

const HOTEL_ID = currentHotelId();
import { STATUS_LABELS } from "@/components/ReservationBar";

// ---------- small date/money helpers ----------
const DAY_MS = 24 * 60 * 60 * 1000;
const toDate = (iso: string) => new Date(iso + "T12:00:00");
const toISO = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (iso: string, n: number) =>
  toISO(new Date(toDate(iso).getTime() + n * DAY_MS));
const nightsBetween = (a: string, b: string) =>
  Math.round((toDate(b).getTime() - toDate(a).getTime()) / DAY_MS);
const fmtDate = (iso: string) => {
  const d = toDate(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
};
const fmtMoney = (n: number) => `${Math.round(n).toLocaleString("vi-VN")}₫`;

const WEEKDAYS = [
  "Chủ Nhật", "Thứ Hai", "Thứ Ba", "Thứ Tư", "Thứ Năm", "Thứ Sáu", "Thứ Bảy",
];

const HK_CHIP: Record<string, { label: string; cls: string }> = {
  dirty: { label: "Chưa dọn", cls: "bg-red-50 text-red-600" },
  in_progress: { label: "Đang dọn", cls: "bg-amber-50 text-amber-600" },
  out_of_order: { label: "Ngừng bán", cls: "bg-gray-100 text-gray-500" },
};

type TabKey =
  | "arrivals" | "departures" | "inhouse" | "stayovers"
  | "bookings" | "cancelations" | "overbookings";

export default function DashboardPage() {
  const [reservations, setReservations] =
    useState<Reservation[]>(RESERVATIONS);
  const [rooms, setRooms] = useState<Room[]>(ROOMS);
  const [hotelName, setHotelName] = useState("CityHouse MARK El Pino Realm");
  const [dbError, setDbError] = useState("");
  const [tab, setTab] = useState<TabKey>("arrivals");
  const [showAllArrivals, setShowAllArrivals] = useState(false);
  const [chartMode, setChartMode] = useState<"booked" | "available">("booked");

  const totalRooms = rooms.length;
  const outOfService = rooms.filter(
    (r) => r.housekeepingStatus === "out_of_order"
  ).length;

  // ----- LOAD this hotel's rooms + reservations from Supabase -----
  useEffect(() => {
    (async () => {
      const [hotelRes, roomsRes, resRes] = await Promise.all([
        supabase.from("hotels").select("name").eq("id", HOTEL_ID).single(),
        supabase.from("rooms").select("*").eq("hotel_id", HOTEL_ID),
        supabase.from("reservations").select("*").eq("hotel_id", HOTEL_ID),
      ]);
      const err = hotelRes.error ?? roomsRes.error ?? resRes.error;
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
  }, []);

  // Does this booking occupy rooms on the given night?
  const covers = (r: Reservation, day: string) =>
    (r.status === "confirmed" || r.status === "in_house") &&
    r.checkIn <= day &&
    day < r.checkOut;

  // ---------- tonight's occupancy (donut card) ----------
  const occupiedTonight = useMemo(() => {
    const set = new Set<string>();
    reservations
      .filter((r) => covers(r, TODAY))
      .forEach((r) => r.roomNumbers.forEach((n) => set.add(n)));
    return set.size;
  }, [reservations]);
  const occupancyPct = Math.round((occupiedTonight / totalRooms) * 100);
  const availableTonight = totalRooms - occupiedTonight - outOfService;

  // ---------- Activity lists ----------
  const arrivals = reservations.filter(
    (r) => r.status === "confirmed" && r.checkIn === TODAY
  );
  const arrivalsPlus = reservations.filter(
    (r) =>
      r.status === "confirmed" &&
      (r.checkIn === TODAY || r.checkIn === addDays(TODAY, 1))
  );
  const departures = reservations.filter(
    (r) =>
      (r.status === "in_house" || r.status === "confirmed") &&
      r.checkOut === TODAY
  );
  const inHouse = reservations.filter((r) => r.status === "in_house");
  const stayovers = inHouse.filter(
    (r) => r.checkIn < TODAY && r.checkOut > TODAY
  );
  const bookingsToday = reservations.filter(
    (r) => r.createdAt === TODAY && r.status !== "cancelled"
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
  const unassigned = reservations.filter(
    (r) => r.status === "confirmed" && r.roomNumbers.length === 0
  );

  const TABS: { key: TabKey; label: string; value: number }[] = [
    { key: "arrivals", label: "Khách đến", value: arrivals.length },
    { key: "departures", label: "Khách đi", value: departures.length },
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

  // ---------- Forecast: next 14 nights ----------
  const DAYS = 14;
  const forecast = useMemo(() => {
    const series: number[] = []; // occupied rooms per night
    let roomNights = 0;
    let revenue = 0;
    for (let i = 0; i < DAYS; i++) {
      const day = addDays(TODAY, i);
      let occupied = 0;
      reservations
        .filter((r) => covers(r, day))
        .forEach((r) => {
          const roomsCount = Math.max(r.roomNumbers.length, 1);
          occupied += roomsCount;
          roomNights += roomsCount;
          revenue += r.totalAmount / nightsBetween(r.checkIn, r.checkOut);
        });
      series.push(occupied);
    }
    const availableNights = totalRooms * DAYS;
    return {
      series,
      roomNights,
      revenue,
      occupancy: (roomNights / availableNights) * 100,
      adr: roomNights > 0 ? revenue / roomNights : 0,
      revpar: revenue / availableNights,
    };
  }, [reservations]);

  // Line chart geometry (SVG)
  const chartValues =
    chartMode === "booked"
      ? forecast.series.map((n) => (n / totalRooms) * 100)
      : forecast.series.map((n) => totalRooms - n);
  const chartMax = chartMode === "booked" ? 100 : totalRooms;
  const CW = 560, CH = 150, CP = 8;
  const points = chartValues
    .map((v, i) => {
      const x = CP + (i * (CW - 2 * CP)) / (DAYS - 1);
      const y = CH - CP - (v / chartMax) * (CH - 2 * CP);
      return `${x},${y}`;
    })
    .join(" ");

  const today = toDate(TODAY);

  return (
    <div>
      {dbError && <p className="mb-4 rounded-lg bg-[#fdecec] px-3 py-2 text-sm text-[#e5484d]">Lỗi cơ sở dữ liệu: {dbError}</p>}
      {/* ===== Header ===== */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-[#17293e]">Tổng quan</h1>
        <div className="flex items-center gap-2">
          <button className="cb-btn-ghost px-3 py-1.5 text-sm">‹</button>
          <button className="cb-btn-ghost px-4 py-1.5 text-sm">Hôm nay</button>
          <button className="cb-btn-ghost px-3 py-1.5 text-sm">›</button>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-5 xl:grid-cols-[280px_1fr]">
        {/* ===== Left column: date + occupancy ===== */}
        <div className="space-y-5">
          <div className="cb-card p-5">
            <div className="text-sm text-[#68707a]">
              {WEEKDAYS[today.getDay()]}
            </div>
            <div className="text-6xl font-bold leading-none text-[#17293e]">
              {today.getDate()}
            </div>
            <div className="mt-1 text-sm text-[#68707a]">
              Tháng {today.getMonth() + 1} / {today.getFullYear()}
            </div>
          </div>

          <div className="cb-card p-5">
            {/* Occupancy donut (SVG ring) */}
            <div className="relative mx-auto h-36 w-36">
              <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90">
                <circle cx="60" cy="60" r="52" fill="none" stroke="#e6ebf0" strokeWidth="13" />
                <circle
                  cx="60" cy="60" r="52" fill="none"
                  stroke="#1db584" strokeWidth="13" strokeLinecap="round"
                  strokeDasharray={`${(occupancyPct / 100) * 326.7} 326.7`}
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <div className="text-3xl font-bold text-[#17293e]">
                  {occupancyPct}%
                </div>
                <div className="text-xs text-[#68707a]">Công suất phòng</div>
              </div>
            </div>
            <div className="mt-4 space-y-1.5 border-t border-[#eef1f5] pt-4 text-sm">
              <div className="flex justify-between">
                <span className="text-[#68707a]">Phòng còn trống</span>
                <b>{availableTonight}</b>
              </div>
              <div className="flex justify-between">
                <span className="text-[#68707a]">Phòng đã bán</span>
                <b>{occupiedTonight}</b>
              </div>
              <div className="flex justify-between">
                <span className="text-[#68707a]">Ngừng phục vụ</span>
                <b>{outOfService}</b>
              </div>
              <div className="flex justify-between">
                <span className="text-[#68707a]">Ngày bị khoá</span>
                <b>0</b>
              </div>
            </div>
          </div>
        </div>

        {/* ===== Activity card ===== */}
        <div className="cb-card p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-[#17293e]">Hoạt động</h2>
            <span className="text-xs text-[#68707a]">{hotelName}</span>
          </div>

          {unassigned.length > 0 && (
            <div className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-[13px] text-amber-700">
              ⚠ {unassigned.length} đơn đã xác nhận chưa gán phòng:{" "}
              {unassigned
                .map((r) => `${r.guestName} — đến ${fmtDate(r.checkIn)}`)
                .join("; ")}
            </div>
          )}

          {/* Stat boxes = tabs */}
          <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4 2xl:grid-cols-7">
            {TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={
                  tab === t.key
                    ? "rounded-[10px] border-2 border-[#2563eb] bg-[#e8effe] px-3 py-2.5 text-left"
                    : "rounded-[10px] border border-[#dde3ea] bg-white px-3 py-2.5 text-left hover:bg-[#f4f7fb]"
                }
              >
                <div className="text-[22px] font-bold leading-none text-[#17293e]">
                  {t.value}
                </div>
                <div className="mt-1 text-xs text-[#68707a]">{t.label}</div>
              </button>
            ))}
          </div>

          {/* Guest table */}
          <table className="mt-4 w-full text-sm">
            <thead>
              <tr className="border-y border-[#eef1f5] text-left text-xs uppercase tracking-wide text-[#68707a]">
                <th className="py-2 pr-3 font-semibold">Khách</th>
                <th className="py-2 pr-3 font-semibold">Phòng</th>
                <th className="py-2 pr-3 font-semibold">Thời gian ở</th>
                <th className="py-2 text-right font-semibold">Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const firstRoom = rooms.find(
                  (room) => room.number === r.roomNumbers[0]
                );
                const hk = firstRoom ? HK_CHIP[firstRoom.housekeepingStatus] : undefined;
                return (
                  <tr key={r.id} className="border-b border-[#eef1f5]">
                    <td className="py-3 pr-3">
                      <div className="font-semibold text-[#17293e]">{r.guestName}</div>
                      <div className="text-xs text-[#68707a]">{hotelName}</div>
                      <div className="text-xs text-[#68707a]">{r.id}</div>
                    </td>
                    <td className="py-3 pr-3">
                      {r.roomNumbers.length > 0 ? (
                        <div>
                          {r.roomNumbers.join(", ")} – {getRoomTypeName(r.roomTypeId)}
                          {hk && (
                            <span className={`ml-2 rounded-full px-2 py-0.5 text-[11px] font-medium ${hk.cls}`}>
                              {hk.label}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                          Chưa xếp phòng
                        </span>
                      )}
                    </td>
                    <td className="py-3 pr-3">
                      <div>{fmtDate(r.checkIn)} – {fmtDate(r.checkOut)}</div>
                      <div className="mt-0.5 text-xs text-[#68707a]">
                        🌙 {nightsBetween(r.checkIn, r.checkOut)} đêm · 👤 {r.guests} khách
                      </div>
                    </td>
                    <td className="py-3 text-right">
                      {tab === "arrivals" && (
                        <button
                          onClick={() => setStatus(r.id, "in_house")}
                          className="cb-btn-primary px-4 py-1.5 text-sm"
                        >
                          Nhận phòng
                        </button>
                      )}
                      {(tab === "inhouse" || tab === "departures") && (
                        <button
                          onClick={() => setStatus(r.id, "checked_out")}
                          className="cb-btn-ghost px-4 py-1.5 text-sm"
                        >
                          Trả phòng
                        </button>
                      )}
                      {tab === "stayovers" && (
                        <span className="text-xs font-medium text-[#1db584]">Đang ở</span>
                      )}
                      {tab === "bookings" && (
                        <span className="text-xs font-medium text-[#68707a]">
                          {STATUS_LABELS[r.status]}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-8 text-center text-[#68707a]">
                    Không có dữ liệu
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          {/* Bottom bar of the Activity card */}
          <div className="mt-4 flex items-center justify-between rounded-lg bg-[#f7f9fb] px-3 py-2.5 text-sm">
            <label className="flex cursor-pointer items-center gap-2.5">
              <button
                onClick={() => setShowAllArrivals((v) => !v)}
                className={`relative h-5 w-9 rounded-full transition ${showAllArrivals ? "bg-[#2563eb]" : "bg-gray-300"}`}
                aria-label="Xem tất cả khách đến"
              >
                <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${showAllArrivals ? "left-[18px]" : "left-0.5"}`} />
              </button>
              Xem tất cả khách đến (cả ngày mai)
            </label>
            <span className="text-[#68707a]">
              Khách đến hôm nay: <b className="text-[#17293e]">{arrivals.length}</b>
            </span>
          </div>
        </div>
      </div>

      {/* ===== Forecast card ===== */}
      <div className="cb-card mt-5 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-bold text-[#17293e]">Dự báo</h2>
          <div className="flex items-center gap-2 text-sm">
            <button className="cb-btn-ghost px-3 py-1.5">‹</button>
            <span className="rounded-lg bg-[#f7f9fb] px-3 py-1.5 text-[#68707a]">
              📅 {fmtDate(TODAY)} – {fmtDate(addDays(TODAY, DAYS - 1))}
            </span>
            <button className="cb-btn-ghost px-3 py-1.5">›</button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2.5">
          {[
            { label: "Công suất", value: `${forecast.occupancy.toFixed(2)}%` },
            { label: "Đêm phòng", value: String(forecast.roomNights) },
            { label: "ADR", value: fmtMoney(forecast.adr) },
            { label: "RevPAR", value: fmtMoney(forecast.revpar) },
            { label: "Doanh thu", value: fmtMoney(forecast.revenue) },
          ].map((kpi) => (
            <div key={kpi.label} className="rounded-[10px] border border-[#dde3ea] px-4 py-2.5">
              <div className="text-lg font-bold leading-none text-[#17293e]">{kpi.value}</div>
              <div className="mt-1 text-xs text-[#68707a]">{kpi.label}</div>
            </div>
          ))}
        </div>

        <div className="mt-4 flex gap-5 border-b border-[#eef1f5] text-sm">
          <button
            onClick={() => setChartMode("booked")}
            className={chartMode === "booked" ? "border-b-2 border-[#2563eb] pb-2 font-semibold text-[#2563eb]" : "pb-2 text-[#68707a]"}
          >
            Đã đặt & bị khoá
          </button>
          <button
            onClick={() => setChartMode("available")}
            className={chartMode === "available" ? "border-b-2 border-[#2563eb] pb-2 font-semibold text-[#2563eb]" : "pb-2 text-[#68707a]"}
          >
            Còn trống
          </button>
        </div>

        <svg viewBox={`0 0 ${CW} ${CH}`} className="mt-3 w-full">
          {[0.25, 0.5, 0.75, 1].map((f) => (
            <line key={f} x1={CP} x2={CW - CP} y1={CH - CP - f * (CH - 2 * CP)} y2={CH - CP - f * (CH - 2 * CP)} stroke="#e6ebf0" strokeDasharray="4 4" />
          ))}
          <polyline points={points} fill="none" stroke="#2563eb" strokeWidth="2" />
        </svg>
        <div className="flex justify-between text-xs text-[#68707a]">
          <span>{fmtDate(TODAY)}</span>
          <span>{chartMode === "booked" ? "% công suất theo ngày" : "Số phòng còn trống theo ngày"}</span>
          <span>{fmtDate(addDays(TODAY, DAYS - 1))}</span>
        </div>
      </div>
    </div>
  );
}
