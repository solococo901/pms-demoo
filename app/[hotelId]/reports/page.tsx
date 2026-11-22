"use client";
// REPORTS4 — app/[hotelId]/reports/page.tsx (Bao cao, gon lai)
// Loc ngay dung DateRangePicker cua app (hien dd/MM/yyyy) + cac nut chon nhanh: Hom nay, Hom qua, 7/30 ngay qua, Thang nay, Tat ca.

import { useEffect, useMemo, useState } from "react";
import { CHANNELS } from "@/lib/mock-data";
import { supabase } from "@/lib/supabase";
import { currentHotelId } from "@/lib/current-hotel";
import { useParams } from "next/navigation";
import { DateRangePicker } from "@/components/DatePicker";


// Commission % per channel — mirrors the Channels page.
const COMMISSION: Record<string, number> = {
  website: 0,
  frontdesk: 0,
  booking_com: 15,
  expedia: 18,
  airbnb: 14,
  agoda: 16,
};

const DAY_MS = 86_400_000;
const toTime = (d: string) => new Date(d + "T00:00:00Z").getTime();
const toISO = (t: number) => new Date(t).toISOString().slice(0, 10);
const addDays = (d: string, n: number) => toISO(toTime(d) + n * DAY_MS);
const fmt = (n: number) => n.toLocaleString("vi-VN");
const fmtDate = (d: string) => d.split("-").reverse().join("/");

// Nut chon nhanh khoang ngay (to la ngay tra phong, khong tinh dem do).
const PRESETS = [
  { key: "today", label: "Hôm nay" },
  { key: "yesterday", label: "Hôm qua" },
  { key: "7d", label: "7 ngày qua" },
  { key: "30d", label: "30 ngày qua" },
  { key: "month", label: "Tháng này" },
  { key: "all", label: "Tất cả" },
];

const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

type DbReservation = {
  id: string;
  channel_code: string;
  check_in: string;
  check_out: string;
  total_amount: number;
  paid_amount: number;
  status: string;
};

export default function ReportsPage() {
  // Khach san lay tu URL khi co, khong thi dung khach san da luu theo tab.
  const params = useParams();
  const HOTEL_ID = typeof params.hotelId === "string" ? params.hotelId : currentHotelId();
  const [reservations, setReservations] = useState<DbReservation[] | null>(null);
  const [roomsByReservation, setRoomsByReservation] = useState<Record<string, number>>({});
  const [roomCount, setRoomCount] = useState(0);
  const [error, setError] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  useEffect(() => {
    (async () => {
      const [res, rr, rooms] = await Promise.all([
        supabase.from("reservations").select("id, channel_code, check_in, check_out, total_amount, paid_amount, status").eq("hotel_id", HOTEL_ID),
        supabase.from("reservation_rooms").select("reservation_id, room_number"),
        supabase.from("rooms").select("id").eq("hotel_id", HOTEL_ID),
      ]);
      if (res.error || rr.error || rooms.error) {
        setError((res.error ?? rr.error ?? rooms.error)?.message ?? "Không đọc được dữ liệu");
        return;
      }
      const counts: Record<string, number> = {};
      for (const row of rr.data ?? []) counts[row.reservation_id] = (counts[row.reservation_id] ?? 0) + 1;
      setRoomsByReservation(counts);
      setRoomCount(rooms.data?.length ?? 0);
      const list = (res.data ?? []) as DbReservation[];
      setReservations(list);
      // Mac dinh: khoang ngay = toan bo du lieu (don hop le dau tien -> don cuoi cung).
      const vv = list.filter((r) => !["cancelled", "no_show"].includes(r.status));
      if (vv.length > 0) {
        setFrom(vv.reduce((a, r) => (r.check_in < a ? r.check_in : a), vv[0].check_in));
        setTo(vv.reduce((a, r) => (r.check_out > a ? r.check_out : a), vv[0].check_out));
      }
    })();
  }, []);

  const valid = useMemo(
    () => (reservations ?? []).filter((r) => !["cancelled", "no_show"].includes(r.status)),
    [reservations]
  );
  const nightsOfRes = (r: DbReservation) => Math.max(1, Math.round((toTime(r.check_out) - toTime(r.check_in)) / DAY_MS));
  const roomsOfRes = (r: DbReservation) => Math.max(1, roomsByReservation[r.id] ?? 0);

  // Khoang ngay hieu luc (o trong = toan bo du lieu).
  const rangeFrom = from || (valid.length > 0 ? valid.reduce((a, r) => (r.check_in < a ? r.check_in : a), valid[0].check_in) : "");
  const rangeTo = to || (valid.length > 0 ? valid.reduce((a, r) => (r.check_out > a ? r.check_out : a), valid[0].check_out) : "");
  const rangeValid = useMemo(
    () => valid.filter((r) => r.check_in < rangeTo && rangeFrom < r.check_out),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [valid, rangeFrom, rangeTo]
  );

  const resetRange = () => {
    if (valid.length === 0) {
      setFrom("");
      setTo("");
      return;
    }
    setFrom(valid.reduce((a, r) => (r.check_in < a ? r.check_in : a), valid[0].check_in));
    setTo(valid.reduce((a, r) => (r.check_out > a ? r.check_out : a), valid[0].check_out));
  };

  const applyPreset = (key: string) => {
    const today = localToday();
    if (key === "today") {
      setFrom(today);
      setTo(addDays(today, 1));
    } else if (key === "yesterday") {
      setFrom(addDays(today, -1));
      setTo(today);
    } else if (key === "7d") {
      setFrom(addDays(today, -6));
      setTo(addDays(today, 1));
    } else if (key === "30d") {
      setFrom(addDays(today, -29));
      setTo(addDays(today, 1));
    } else if (key === "month") {
      const [y, m] = today.split("-").map(Number);
      setFrom(today.slice(0, 8) + "01");
      setTo(toISO(Date.UTC(y, m, 1)));
    } else {
      resetRange();
    }
  };

  const kpi = useMemo(() => {
    const revenue = rangeValid.reduce((a, r) => a + r.total_amount, 0);
    const roomNights = rangeValid.reduce((a, r) => a + nightsOfRes(r) * roomsOfRes(r), 0);
    const collected = rangeValid.reduce((a, r) => a + r.paid_amount, 0);
    return {
      revenue,
      orders: rangeValid.length,
      roomNights,
      adr: roomNights > 0 ? Math.round(revenue / roomNights) : 0,
      collected,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeValid, roomsByReservation]);

  const byChannel = useMemo(
    () =>
      CHANNELS.map((c) => {
        const rows = rangeValid.filter((r) => r.channel_code === c.code);
        const revenue = rows.reduce((a, r) => a + r.total_amount, 0);
        const roomNights = rows.reduce((a, r) => a + nightsOfRes(r) * roomsOfRes(r), 0);
        const commission = Math.round((revenue * (COMMISSION[c.code] ?? 0)) / 100);
        return {
          code: c.code,
          name: c.name,
          orders: rows.length,
          roomNights,
          revenue,
          share: kpi.revenue > 0 ? (revenue / kpi.revenue) * 100 : 0,
          commissionPct: COMMISSION[c.code] ?? 0,
          commission,
          net: revenue - commission,
        };
      })
        .filter((c) => c.orders > 0)
        .sort((a, b) => b.revenue - a.revenue),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rangeValid, kpi.revenue, roomsByReservation]
  );

  const byDay = useMemo(() => {
    if (rangeValid.length === 0 || roomCount === 0 || !rangeFrom || !rangeTo) return [];
    const first = rangeValid.reduce((a, r) => (r.check_in < a ? r.check_in : a), rangeValid[0].check_in);
    const lastCheckout = rangeValid.reduce((a, r) => (r.check_out > a ? r.check_out : a), rangeValid[0].check_out);
    const start = first < rangeFrom ? rangeFrom : first;
    const end = lastCheckout < rangeTo ? lastCheckout : rangeTo;
    const days: { date: string; roomNights: number; revenue: number; occupancy: number }[] = [];
    for (let d = start; d < end; d = addDays(d, 1)) {
      let roomNights = 0;
      let revenue = 0;
      for (const r of rangeValid) {
        if (r.check_in <= d && d < r.check_out) {
          roomNights += roomsOfRes(r);
          revenue += r.total_amount / nightsOfRes(r);
        }
      }
      days.push({ date: d, roomNights, revenue: Math.round(revenue), occupancy: (roomNights / roomCount) * 100 });
    }
    return days;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeValid, roomCount, roomsByReservation, rangeFrom, rangeTo]);

  const totalCommission = byChannel.reduce((a, c) => a + c.commission, 0);
  const chTotal = byChannel.reduce(
    (a, c) => ({ orders: a.orders + c.orders, roomNights: a.roomNights + c.roomNights, revenue: a.revenue + c.revenue, net: a.net + c.net }),
    { orders: 0, roomNights: 0, revenue: 0, net: 0 }
  );
  const dayTotal = byDay.reduce(
    (a, d) => ({ roomNights: a.roomNights + d.roomNights, revenue: a.revenue + d.revenue }),
    { roomNights: 0, revenue: 0 }
  );
  const dayAvgOcc = byDay.length > 0 && roomCount > 0 ? (dayTotal.roomNights / (byDay.length * roomCount)) * 100 : 0;

  const cardCls = "cb-card p-4";
  const thCls = "px-3 py-3 text-left text-xs font-semibold text-muted";
  const tdCls = "px-3 py-3";

  if (error) {
    return (
      <div>
        <h1 className="text-xl font-bold text-ink">Báo cáo</h1>
        <div className="cb-card mt-5 border-danger p-4 text-sm text-danger">
          Không đọc được dữ liệu từ Supabase: {error}
          <div className="mt-1 text-muted">Kiểm tra lại file .env.local (URL + anon key) và nhớ khởi động lại npm run dev sau khi sửa .env.local.</div>
        </div>
      </div>
    );
  }

  if (reservations === null) {
    return (
      <div>
        <h1 className="text-xl font-bold text-ink">Báo cáo</h1>
        <p className="mt-5 text-sm text-muted">Đang tải dữ liệu từ Supabase...</p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-ink">Báo cáo</h1>
          <p className="text-sm text-muted">Doanh thu theo kênh và theo ngày. Không tính đơn đã huỷ / khách không đến.</p>
        </div>
        <DateRangePicker from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} fromLabel="ngày bắt đầu" toLabel="ngày kết thúc" />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted">Nhanh:</span>
        {PRESETS.map((p) => (
          <button key={p.key} type="button" onClick={() => applyPreset(p.key)} className="cb-btn-ghost px-3 py-1.5 text-sm">
            {p.label}
          </button>
        ))}
      </div>

      {/* KPI cards */}
      <div className="mt-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className={cardCls}>
          <div className="text-xs text-muted">Tổng doanh thu</div>
          <div className="mt-1 text-xl font-bold text-ink">{fmt(kpi.revenue)}₫</div>
          <div className="text-xs text-muted">{kpi.orders} đơn · hoa hồng kênh −{fmt(totalCommission)}₫</div>
        </div>
        <div className={cardCls}>
          <div className="text-xs text-muted">Đêm phòng đã bán</div>
          <div className="mt-1 text-xl font-bold text-ink">{kpi.roomNights}</div>
          <div className="text-xs text-muted">đêm × số phòng trong đơn</div>
        </div>
        <div className={cardCls}>
          <div className="text-xs text-muted">Giá phòng trung bình (ADR)</div>
          <div className="mt-1 text-xl font-bold text-ink">{fmt(kpi.adr)}₫</div>
          <div className="text-xs text-muted">doanh thu ÷ đêm phòng</div>
        </div>
        <div className={cardCls}>
          <div className="text-xs text-muted">Đã thu thực tế</div>
          <div className="mt-1 text-xl font-bold text-ink">{fmt(kpi.collected)}₫</div>
          <div className="text-xs text-muted">còn phải thu {fmt(kpi.revenue - kpi.collected)}₫</div>
        </div>
      </div>

      {/* by channel */}
      <div className="cb-card mt-4 p-4">
        <h2 className="font-bold text-ink">Doanh thu theo kênh bán</h2>
        {byChannel.length === 0 ? (
          <p className="mt-2 text-sm text-muted">Chưa có đơn nào trong khoảng ngày này.</p>
        ) : (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm text-ink">
              <thead className="bg-primary-soft">
                <tr>
                  <th className={thCls}>Kênh</th>
                  <th className={thCls}>Số đơn</th>
                  <th className={thCls}>Đêm phòng</th>
                  <th className={thCls}>Doanh thu</th>
                  <th className={thCls}>Tỷ trọng</th>
                  <th className={thCls}>Hoa hồng</th>
                  <th className={thCls}>Thực nhận</th>
                </tr>
              </thead>
              <tbody>
                {byChannel.map((c) => (
                  <tr key={c.code} className="border-t border-[var(--nui-bg)]">
                    <td className={`${tdCls} font-medium`}>{c.name}</td>
                    <td className={tdCls}>{c.orders}</td>
                    <td className={tdCls}>{c.roomNights}</td>
                    <td className={`${tdCls} font-semibold`}>{fmt(c.revenue)}₫</td>
                    <td className={tdCls}>
                      <div className="flex items-center gap-2">
                        <div className="h-2 w-24 overflow-hidden rounded-full bg-[var(--nui-bg)]">
                          <div className="h-full rounded-full bg-primary" style={{ width: `${c.share}%` }} />
                        </div>
                        <span className="text-muted">{c.share.toLocaleString("vi-VN", { maximumFractionDigits: 1 })}%</span>
                      </div>
                    </td>
                    <td className={tdCls}>{c.commissionPct > 0 ? `${fmt(c.commission)}₫ (${c.commissionPct}%)` : "—"}</td>
                    <td className={`${tdCls} font-semibold text-success`}>{fmt(c.net)}₫</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-line bg-primary-soft font-semibold">
                  <td className={tdCls}>Tổng cộng</td>
                  <td className={tdCls}>{chTotal.orders}</td>
                  <td className={tdCls}>{chTotal.roomNights}</td>
                  <td className={tdCls}>{fmt(chTotal.revenue)}₫</td>
                  <td className={tdCls}>100%</td>
                  <td className={tdCls}>{fmt(totalCommission)}₫</td>
                  <td className={tdCls}>{fmt(chTotal.net)}₫</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {/* by day */}
      <div className="cb-card mt-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-bold text-ink">Doanh thu theo ngày</h2>
          {byDay.length > 0 && (
            <span className="text-sm text-muted">
              Tổng {dayTotal.roomNights} đêm · {dayAvgOcc.toLocaleString("vi-VN", { maximumFractionDigits: 1 })}% · {fmt(dayTotal.revenue)}₫
            </span>
          )}
        </div>
        {byDay.length === 0 ? (
          <p className="mt-2 text-sm text-muted">Chưa có đêm nào trong khoảng ngày này.</p>
        ) : (
          <div className="mt-2 max-h-[400px] overflow-auto">
            <table className="w-full min-w-[560px] text-sm text-ink">
              <thead className="sticky top-0 bg-primary-soft">
                <tr>
                  <th className={`${thCls} bg-primary-soft`}>Ngày</th>
                  <th className={`${thCls} bg-primary-soft`}>Phòng bán được</th>
                  <th className={`${thCls} bg-primary-soft`}>Công suất</th>
                  <th className={`${thCls} bg-primary-soft`}>Doanh thu đêm</th>
                </tr>
              </thead>
              <tbody>
                {byDay.map((d) => (
                  <tr key={d.date} className="border-t border-[var(--nui-bg)]">
                    <td className={`${tdCls} font-medium`}>{fmtDate(d.date)}</td>
                    <td className={tdCls}>{d.roomNights} / {roomCount}</td>
                    <td className={tdCls}>
                      <div className="flex items-center gap-2">
                        <div className="h-2 w-24 overflow-hidden rounded-full bg-[var(--nui-bg)]">
                          <div className="h-full rounded-full bg-success" style={{ width: `${d.occupancy}%` }} />
                        </div>
                        <span className="text-muted">{d.occupancy.toLocaleString("vi-VN", { maximumFractionDigits: 1 })}%</span>
                      </div>
                    </td>
                    <td className={`${tdCls} font-semibold`}>{fmt(d.revenue)}₫</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
