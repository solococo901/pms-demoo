"use client";
// ============================================================
// FILE B4 — app/reports/page.tsx — DOC DU LIEU TU SUPABASE
// Same report as before (KPI + by channel + by day), but the
// numbers now come from the real database instead of the
// sample data in code:
//   - On open, the page fetches reservations, their assigned
//     rooms and the hotel's physical rooms from Supabase.
//   - Change a number in Supabase's Table Editor, reload this
//     page, and the report changes — that proves the link.
// Data is filtered by hotel_id: the database holds ALL hotels
// of the account; each page asks only for its own hotel.
// Rules unchanged: cancelled / no-show excluded; a booking's
// money is spread evenly over its nights.
// ============================================================

import { useEffect, useMemo, useState } from "react";
import { CHANNELS, getChannelName } from "@/lib/mock-data";
import { supabase } from "@/lib/supabase";
import { currentHotelId } from "@/lib/current-hotel";

const HOTEL_ID = currentHotelId();

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
  const [reservations, setReservations] = useState<DbReservation[] | null>(null);
  const [roomsByReservation, setRoomsByReservation] = useState<Record<string, number>>({});
  const [roomCount, setRoomCount] = useState(0);
  const [error, setError] = useState("");

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
      setReservations((res.data ?? []) as DbReservation[]);
    })();
  }, []);

  const valid = useMemo(
    () => (reservations ?? []).filter((r) => !["cancelled", "no_show"].includes(r.status)),
    [reservations]
  );
  const nightsOfRes = (r: DbReservation) => Math.max(1, Math.round((toTime(r.check_out) - toTime(r.check_in)) / DAY_MS));
  const roomsOfRes = (r: DbReservation) => Math.max(1, roomsByReservation[r.id] ?? 0);

  const kpi = useMemo(() => {
    const revenue = valid.reduce((a, r) => a + r.total_amount, 0);
    const roomNights = valid.reduce((a, r) => a + nightsOfRes(r) * roomsOfRes(r), 0);
    const collected = valid.reduce((a, r) => a + r.paid_amount, 0);
    return {
      revenue,
      orders: valid.length,
      roomNights,
      adr: roomNights > 0 ? Math.round(revenue / roomNights) : 0,
      collected,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valid, roomsByReservation]);

  const byChannel = useMemo(
    () =>
      CHANNELS.map((c) => {
        const rows = valid.filter((r) => r.channel_code === c.code);
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
      }).sort((a, b) => b.revenue - a.revenue),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [valid, kpi.revenue, roomsByReservation]
  );

  const byDay = useMemo(() => {
    if (valid.length === 0 || roomCount === 0) return [];
    const first = valid.reduce((a, r) => (r.check_in < a ? r.check_in : a), valid[0].check_in);
    const lastCheckout = valid.reduce((a, r) => (r.check_out > a ? r.check_out : a), valid[0].check_out);
    const days: { date: string; roomNights: number; revenue: number; occupancy: number }[] = [];
    for (let d = first; d < lastCheckout; d = addDays(d, 1)) {
      let roomNights = 0;
      let revenue = 0;
      for (const r of valid) {
        if (r.check_in <= d && d < r.check_out) {
          roomNights += roomsOfRes(r);
          revenue += r.total_amount / nightsOfRes(r);
        }
      }
      days.push({ date: d, roomNights, revenue: Math.round(revenue), occupancy: (roomNights / roomCount) * 100 });
    }
    return days;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valid, roomCount, roomsByReservation]);

  const totalCommission = byChannel.reduce((a, c) => a + c.commission, 0);

  const cardCls = "cb-card p-4";
  const thCls = "px-3 py-3 text-left text-xs font-semibold text-[#68707a]";
  const tdCls = "px-3 py-3";

  if (error) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-[#17293e]">Báo cáo doanh thu</h1>
        <div className="cb-card mt-5 border-[#e5484d] p-4 text-sm text-[#e5484d]">
          Không đọc được dữ liệu từ Supabase: {error}
          <div className="mt-1 text-[#68707a]">Kiểm tra lại file .env.local (URL + anon key) và nhớ khởi động lại npm run dev sau khi sửa .env.local.</div>
        </div>
      </div>
    );
  }

  if (reservations === null) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-[#17293e]">Báo cáo doanh thu</h1>
        <p className="mt-5 text-sm text-[#68707a]">Đang tải dữ liệu từ Supabase...</p>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-[#17293e]">Báo cáo doanh thu</h1>
      <p className="mt-1 text-sm text-[#68707a]">
        Số liệu đọc trực tiếp từ cơ sở dữ liệu Supabase (không tính đơn đã huỷ / khách không đến). Tiền của mỗi đơn được chia đều cho các
        đêm lưu trú. Số hoa hồng lấy theo % đang khai ở trang Kênh bán.
      </p>

      {/* KPI cards */}
      <div className="mt-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className={cardCls}>
          <div className="text-xs text-[#68707a]">Tổng doanh thu</div>
          <div className="mt-1 text-xl font-bold text-[#17293e]">{fmt(kpi.revenue)}₫</div>
          <div className="text-xs text-[#68707a]">{kpi.orders} đơn · hoa hồng kênh −{fmt(totalCommission)}₫</div>
        </div>
        <div className={cardCls}>
          <div className="text-xs text-[#68707a]">Đêm phòng đã bán</div>
          <div className="mt-1 text-xl font-bold text-[#17293e]">{kpi.roomNights}</div>
          <div className="text-xs text-[#68707a]">đêm × số phòng trong đơn</div>
        </div>
        <div className={cardCls}>
          <div className="text-xs text-[#68707a]">Giá phòng trung bình (ADR)</div>
          <div className="mt-1 text-xl font-bold text-[#17293e]">{fmt(kpi.adr)}₫</div>
          <div className="text-xs text-[#68707a]">doanh thu ÷ đêm phòng</div>
        </div>
        <div className={cardCls}>
          <div className="text-xs text-[#68707a]">Đã thu thực tế</div>
          <div className="mt-1 text-xl font-bold text-[#17293e]">{fmt(kpi.collected)}₫</div>
          <div className="text-xs text-[#68707a]">còn phải thu {fmt(kpi.revenue - kpi.collected)}₫</div>
        </div>
      </div>

      {/* by channel */}
      <div className="cb-card mt-4 p-4">
        <h2 className="font-bold text-[#17293e]">Doanh thu theo kênh bán</h2>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm text-[#17293e]">
            <thead className="bg-[#f7f9fb]">
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
                <tr key={c.code} className="border-t border-[#eef1f5]">
                  <td className={`${tdCls} font-medium`}>{c.name}</td>
                  <td className={tdCls}>{c.orders}</td>
                  <td className={tdCls}>{c.roomNights}</td>
                  <td className={`${tdCls} font-semibold`}>{fmt(c.revenue)}₫</td>
                  <td className={tdCls}>
                    <div className="flex items-center gap-2">
                      <div className="h-2 w-24 overflow-hidden rounded-full bg-[#eef1f5]">
                        <div className="h-full rounded-full bg-[#2563eb]" style={{ width: `${c.share}%` }} />
                      </div>
                      <span className="text-[#68707a]">{c.share.toLocaleString("vi-VN", { maximumFractionDigits: 1 })}%</span>
                    </div>
                  </td>
                  <td className={tdCls}>{c.commissionPct > 0 ? `${fmt(c.commission)}₫ (${c.commissionPct}%)` : "—"}</td>
                  <td className={`${tdCls} font-semibold text-[#0e7a56]`}>{fmt(c.net)}₫</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-[#68707a]">
          Kênh trực tiếp (Website + Lễ tân) không mất hoa hồng — mỗi đơn chuyển từ OTA về kênh trực tiếp là khách sạn giữ lại thêm 14–18% doanh thu.
        </p>
      </div>

      {/* by day */}
      <div className="cb-card mt-4 p-4">
        <h2 className="font-bold text-[#17293e]">Doanh thu theo ngày</h2>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm text-[#17293e]">
            <thead className="bg-[#f7f9fb]">
              <tr>
                <th className={thCls}>Ngày</th>
                <th className={thCls}>Phòng bán được</th>
                <th className={thCls}>Công suất</th>
                <th className={thCls}>Doanh thu đêm</th>
              </tr>
            </thead>
            <tbody>
              {byDay.map((d) => (
                <tr key={d.date} className="border-t border-[#eef1f5]">
                  <td className={`${tdCls} font-medium`}>{fmtDate(d.date)}</td>
                  <td className={tdCls}>{d.roomNights} / {roomCount}</td>
                  <td className={tdCls}>
                    <div className="flex items-center gap-2">
                      <div className="h-2 w-24 overflow-hidden rounded-full bg-[#eef1f5]">
                        <div className="h-full rounded-full bg-[#1db584]" style={{ width: `${d.occupancy}%` }} />
                      </div>
                      <span className="text-[#68707a]">{d.occupancy.toLocaleString("vi-VN", { maximumFractionDigits: 1 })}%</span>
                    </div>
                  </td>
                  <td className={`${tdCls} font-semibold`}>{fmt(d.revenue)}₫</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <p className="mt-3 text-xs text-[#9aa7b4]">{getChannelName("website")} là kênh rẻ nhất cho khách vì không qua trung gian — báo cáo này giúp thấy rõ khách sạn đang phụ thuộc vào kênh nào.</p>
    </div>
  );
}
