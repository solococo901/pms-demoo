"use client";
// AUDIT8 — app/[hotelId]/audit/page.tsx (Nhat ky thao tac)
// Them nhan "Kéo đơn từ kênh" cho action booking_pulled (keo don Channex ve).
// Xem toan bo nhat ky thao tac cua khach san, loc theo nguoi lam / loai viec / ngay.
// Bang cuon trong khung cao co dinh, tieu de cot dinh lai khi cuon (giong bang ngay o Bao cao).

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { currentHotelId } from "@/lib/current-hotel";
import { useParams } from "next/navigation";

type AuditLog = { id: string; actorName: string; action: string; summary: string; createdAt: string };

const ACTION_LABELS: Record<string, string> = {
  booking_created: "Tạo đơn",
  booking_cancelled: "Huỷ đơn",
  booking_checked_in: "Nhận phòng",
  booking_checked_out: "Trả phòng",
  booking_updated: "Đổi trạng thái",
  booking_pulled: "Kéo đơn từ kênh",
  price_updated: "Đổi giá",
  room_blocked: "Chặn phòng",
  room_unblocked: "Mở phòng",
  payment_added: "Thu tiền",
};

const p2 = (n: number) => String(n).padStart(2, "0");
const fmtDateTime = (iso: string) => {
  const d = new Date(iso);
  return `${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
};
const localDate = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
};

export default function AuditLogPage() {
  const params = useParams();
  const HOTEL_ID = typeof params.hotelId === "string" ? params.hotelId : currentHotelId();
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [actorFilter, setActorFilter] = useState("all");
  const [actionFilter, setActionFilter] = useState("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  useEffect(() => {
    loadLogs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [HOTEL_ID]);

  async function loadLogs() {
    setLoading(true);
    // Supabase chi tra toi da 1000 dong/lan — lay theo trang den khi het.
    let all: AuditLog[] = [];
    let from = 0;
    for (;;) {
      const { data } = await supabase
        .from("audit_logs")
        .select("id, actor_name, action, summary, created_at")
        .eq("hotel_id", HOTEL_ID)
        .order("created_at", { ascending: false })
        .range(from, from + 999);
      const rows = (data ?? []).map((l) => ({
        id: l.id,
        actorName: l.actor_name ?? "—",
        action: l.action,
        summary: l.summary,
        createdAt: l.created_at,
      }));
      all = all.concat(rows);
      if (rows.length < 1000) break;
      from += 1000;
    }
    setLogs(all);
    setLoading(false);
  }

  const actors = useMemo(() => Array.from(new Set(logs.map((l) => l.actorName))).sort(), [logs]);
  const actions = useMemo(() => Array.from(new Set(logs.map((l) => l.action))).sort(), [logs]);
  const filtered = useMemo(
    () =>
      logs.filter((l) => {
        if (actorFilter !== "all" && l.actorName !== actorFilter) return false;
        if (actionFilter !== "all" && l.action !== actionFilter) return false;
        const d = localDate(l.createdAt);
        if (fromDate && d < fromDate) return false;
        if (toDate && d > toDate) return false;
        return true;
      }),
    [logs, actorFilter, actionFilter, fromDate, toDate],
  );

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-ink">Nhật ký thao tác</h1>
          <p className="mt-1 text-sm text-muted">
            Toàn bộ hoạt động trong khách sạn này — ai làm, làm gì, lúc nào. Dùng để đối chiếu khi có sai lệch (ví dụ ngày đơn bị kênh đè về).
          </p>
        </div>
        <button onClick={loadLogs} className="cb-btn-ghost px-3 py-2 text-sm">Tải lại</button>
      </div>

      <div className="cb-card mt-4 flex flex-wrap items-end gap-3 p-4">
        <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
          Người làm
          <select value={actorFilter} onChange={(e) => setActorFilter(e.target.value)} className="rounded-lg border border-line bg-surface px-3 py-2 text-sm font-normal text-ink">
            <option value="all">Tất cả</option>
            {actors.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
          Loại việc
          <select value={actionFilter} onChange={(e) => setActionFilter(e.target.value)} className="rounded-lg border border-line bg-surface px-3 py-2 text-sm font-normal text-ink">
            <option value="all">Tất cả</option>
            {actions.map((a) => (
              <option key={a} value={a}>{ACTION_LABELS[a] ?? a}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
          Từ ngày
          <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="rounded-lg border border-line bg-surface px-3 py-2 text-sm font-normal text-ink" />
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
          Đến ngày
          <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="rounded-lg border border-line bg-surface px-3 py-2 text-sm font-normal text-ink" />
        </label>
        <button
          onClick={() => { setActorFilter("all"); setActionFilter("all"); setFromDate(""); setToDate(""); }}
          className="cb-btn-ghost px-3 py-2 text-sm"
        >
          Đặt lại
        </button>
        <span className="ml-auto text-sm text-muted">
          Hiển thị {filtered.length} / {logs.length} dòng
        </span>
      </div>

      <div className="cb-card mt-4 overflow-hidden">
        {loading ? (
          <p className="p-5 text-sm text-muted">Đang tải nhật ký...</p>
        ) : filtered.length === 0 ? (
          <p className="p-5 text-sm text-muted">
            {logs.length === 0 ? "Chưa có hoạt động nào được ghi." : "Không có dòng nào khớp bộ lọc."}
          </p>
        ) : (
          <div className="max-h-[600px] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-[var(--nui-bg)]">
                <tr className="text-left text-xs font-semibold text-muted">
                  <th className="w-40 px-4 py-2.5">Thời gian</th>
                  <th className="w-36 px-4 py-2.5">Người làm</th>
                  <th className="w-32 px-4 py-2.5">Việc</th>
                  <th className="px-4 py-2.5">Nội dung</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((l) => (
                  <tr key={l.id} className="border-t border-line align-top">
                    <td className="whitespace-nowrap px-4 py-2.5 text-muted">{fmtDateTime(l.createdAt)}</td>
                    <td className="px-4 py-2.5 font-medium text-ink">{l.actorName}</td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-ink">{ACTION_LABELS[l.action] ?? l.action}</td>
                    <td className="px-4 py-2.5 text-ink">{l.summary}</td>
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
