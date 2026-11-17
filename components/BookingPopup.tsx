"use client";

// ============================================================
// components/BookingPopup.tsx — Popup thong tin booking kieu
// Cloudbeds cho Lich phong: bam vao thanh booking thi bat len
// ngay canh thanh (khong phai panel phai).
//  - Header xanh: ten khach – trang thai, ma don – kenh.
//  - Cot trai: ngay den/di, so khach, tong tien, con no
//    (do neu > 0).
//  - Tab Reservation: chi tiet don + nut Nhan phong /
//    Tra phong / Huy don (goi ve ham setStatus cua lich) +
//    link "Mo trang chi tiet" sang trang day du (RESFLOW1,
//    giong Cloudbeds: panel -> "View reservation" -> trang day du).
//  - Tab Notes (n): danh sach ghi chu + O CHAT ben duoi —
//    go xong bam Gui (hoac Enter) la luu ngay vao bang
//    reservation_notes. Ghi chu cu o cot note cua don (neu co)
//    hien dau danh sach.
// ============================================================

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import {
  getChannelName,
  getRoomTypeName,
  type Reservation,
} from "@/lib/mock-data";
import { STATUS_LABELS } from "./ReservationBar";

type Note = { id: string; author: string; body: string; createdAt: string };

const fmtDate = (iso: string) => {
  const d = new Date(iso + "T12:00:00");
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
};
const fmtTime = (ts: string) => {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

// Mau header popup theo dung mau thanh booking cua don do
// (cung ma mau voi STATUS_STYLES trong ReservationBar):
// dang o = xanh la dam, da xac nhan = xanh duong nhat,
// cho xac nhan = xanh ngoc nhat (chu dam cho de doc),
// tra phong = xam dam, huy = do, khong den = xam.
const HEADER_STYLES: Record<Reservation["status"], string> = {
  pending: "bg-[#8fd0c5] text-[#134e4a]",
  confirmed: "bg-[#4aa8de] text-white",
  in_house: "bg-[#2aa76d] text-white",
  checked_out: "bg-[#757c85] text-white",
  cancelled: "bg-[#e5484d] text-white",
  no_show: "bg-[var(--cb-muted)] text-white",
};

export default function BookingPopup({
  reservation: r,
  currency,
  hotelId,
  accountId,
  anchor,
  onClose,
  onSetStatus,
  onEnterAssignMode,
}: {
  reservation: Reservation;
  currency: string;
  hotelId: string;
  accountId: string;
  anchor: { x: number; y: number } | null;
  onClose: () => void;
  onSetStatus: (id: string, status: Reservation["status"]) => void;
  onEnterAssignMode?: (id: string) => void;
}) {
  const [tab, setTab] = useState<"info" | "notes">("info");
  const [notes, setNotes] = useState<Note[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [notesError, setNotesError] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  const money = (n: number) =>
    currency === "USD"
      ? `$${Math.round(n).toLocaleString("en-US")}`
      : `${Math.round(n).toLocaleString("vi-VN")}₫`;
  const balance = r.totalAmount - r.paidAmount;

  const loadNotes = async () => {
    const { data, error } = await supabase
      .from("reservation_notes")
      .select("id, author, body, created_at")
      .eq("reservation_id", r.id)
      .order("created_at", { ascending: true });
    if (error) { setNotesError(error.message); return; }
    setNotes((data ?? []).map((n) => ({
      id: n.id, author: n.author, body: n.body, createdAt: n.created_at,
    })));
  };
  useEffect(() => { loadNotes(); }, [r.id]);
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [notes, tab]);

  const allNotes: Note[] = [
    ...(r.note
      ? [{ id: "legacy", author: "Ghi chú đơn", body: r.note, createdAt: "" }]
      : []),
    ...notes,
  ];

  const sendNote = async () => {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    setNotesError("");
    const { data: userData } = await supabase.auth.getUser();
    const author = userData.user?.email ?? "Lễ tân";
    const { data, error } = await supabase
      .from("reservation_notes")
      .insert({
        hotel_id: hotelId, account_id: accountId,
        reservation_id: r.id, author, body,
      })
      .select("id, author, body, created_at")
      .single();
    setSending(false);
    if (error) { setNotesError(error.message); return; }
    if (data) {
      setNotes((prev) => [
        ...prev,
        { id: data.id, author: data.author, body: data.body, createdAt: data.created_at },
      ]);
    }
    setDraft("");
  };

  // Vi tri popup: canh thanh vua bam, kep trong man hinh.
  // Khong co vi tri bam (mo tu ban phim...) thi dat giua man hinh.
  const W = 580, H = 480;
  const vw = typeof window !== "undefined" ? window.innerWidth : 1200;
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;
  const left = anchor
    ? Math.min(Math.max(anchor.x - 80, 8), Math.max(vw - W - 8, 8))
    : Math.max((vw - W) / 2, 8);
  const top = anchor
    ? anchor.y + H + 16 > vh
      ? Math.max(anchor.y - H - 16, 8)
      : anchor.y + 16
    : 80;

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div
        className="fixed z-50 flex flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
        style={{ width: W, maxWidth: "94vw", left, top }}
      >
        {/* header doi mau theo trang thai cua don (giong mau thanh booking) */}
        <div className={`flex items-start justify-between px-4 py-3 ${HEADER_STYLES[r.status]}`}>
          <div>
            <div className="text-base font-bold leading-tight">
              {r.guestName} – {STATUS_LABELS[r.status] ?? r.status}
            </div>
            <div className="text-xs opacity-90">
              {r.id} – {getChannelName(r.channelCode)}
            </div>
          </div>
          <button onClick={onClose} className="rounded-full px-2 py-0.5 text-lg leading-none hover:bg-white/20">✕</button>
        </div>

        <div className="grid grid-cols-[170px_1fr]">
          {/* cot trai: tom tat */}
          <div className="space-y-3 border-r border-[var(--cb-bg)] p-4 text-sm">
            <div>
              <div className="text-xs text-[var(--cb-muted)]">Check-in / Out</div>
              <div className="font-medium text-[var(--cb-text)]">{fmtDate(r.checkIn)} – {fmtDate(r.checkOut)}</div>
            </div>
            <div>
              <div className="text-xs text-[var(--cb-muted)]">Khách</div>
              <div className="font-medium text-[var(--cb-text)]">{r.guests || 1}</div>
            </div>
            <div>
              <div className="text-xs text-[var(--cb-muted)]">Tổng tiền</div>
              <div className="font-medium text-[var(--cb-text)]">{money(r.totalAmount)}</div>
            </div>
            <div>
              <div className="text-xs text-[var(--cb-muted)]">Còn nợ</div>
              <div className={`font-bold ${balance > 0 ? "text-[#e5484d]" : "text-[var(--cb-text)]"}`}>{money(balance)}</div>
            </div>
          </div>

          {/* cot phai: tabs */}
          <div className="flex min-h-[300px] flex-col">
            <div className="flex gap-4 border-b border-[var(--cb-bg)] px-4 pt-3 text-sm">
              <button
                className={`pb-2 font-semibold ${tab === "info" ? "border-b-2 border-[var(--cb-blue)] text-[var(--cb-blue)]" : "text-[var(--cb-muted)]"}`}
                onClick={() => setTab("info")}
              >Reservation</button>
              <button
                className={`pb-2 font-semibold ${tab === "notes" ? "border-b-2 border-[var(--cb-blue)] text-[var(--cb-blue)]" : "text-[var(--cb-muted)]"}`}
                onClick={() => setTab("notes")}
              >
                Notes ({allNotes.length})
              </button>
            </div>

            {tab === "info" ? (
              <div className="flex-1 space-y-2 overflow-y-auto p-4 text-sm">
                <InfoRow label="Số điện thoại" value={r.guestPhone || "—"} />
                <InfoRow label="Ngày đến → đi" value={`${fmtDate(r.checkIn)} → ${fmtDate(r.checkOut)}`} />
                <InfoRow label="Phòng" value={r.roomNumbers.length ? r.roomNumbers.join(", ") : "Chưa gán"} />
                <InfoRow label="Loại phòng" value={getRoomTypeName(r.roomTypeId)} />
                <InfoRow label="Số khách" value={String(r.guests || 1)} />
                <InfoRow label="Thu tiền bởi" value={r.paymentCollector === "channel_collect" ? "Kênh thu hộ" : "Khách sạn tự thu"} />
                <InfoRow label="Tổng tiền" value={money(r.totalAmount)} />
                <InfoRow label="Đã trả" value={money(r.paidAmount)} />
                <div className="flex justify-between gap-4">
                  <span className="text-[var(--cb-muted)]">Còn nợ</span>
                  <span className={`font-medium ${balance > 0 ? "text-[#e5484d]" : "text-[var(--cb-text)]"}`}>{money(balance)}</span>
                </div>
                <div className="flex gap-2 pt-3">
                  {r.roomNumbers.length === 0 && onEnterAssignMode && (
                    <button onClick={() => onEnterAssignMode(r.id)} className="cb-btn-primary flex-1 py-2 text-sm">Chọn phòng trên lịch</button>
                  )}
                  {r.status === "confirmed" && (
                    <button onClick={() => onSetStatus(r.id, "in_house")} className="cb-btn-primary flex-1 py-2 text-sm">Nhận phòng</button>
                  )}
                  {r.status === "in_house" && (
                    <button onClick={() => onSetStatus(r.id, "checked_out")} className="cb-btn-primary flex-1 py-2 text-sm">Trả phòng</button>
                  )}
                  {["pending", "confirmed"].includes(r.status) && (
                    <button onClick={() => onSetStatus(r.id, "cancelled")} className="rounded-lg border border-[#e5484d] px-4 py-2 text-sm font-semibold text-[#e5484d] hover:bg-red-50">Huỷ đơn</button>
                  )}
                </div>
                <div className="border-t border-[var(--cb-bg)] pt-3">
                  <Link href={`/${hotelId}/reservations/${r.id}`} className="text-sm font-medium text-[var(--cb-blue)] hover:underline">Mở trang chi tiết ↗</Link>
                </div>
              </div>
            ) : (
              <div className="flex flex-1 flex-col overflow-hidden">
                <div ref={listRef} className="max-h-[320px] flex-1 space-y-3 overflow-y-auto p-4">
                  {allNotes.length === 0 && (
                    <p className="text-sm text-[var(--cb-muted)]">Chưa có ghi chú nào cho đơn này. Gõ vào ô bên dưới để ghi chú ngay.</p>
                  )}
                  {allNotes.map((n) => (
                    <div key={n.id} className="rounded-lg bg-[#f4f6f9] px-3 py-2">
                      <div className="text-xs font-semibold text-[var(--cb-text)]">
                        {n.author}
                        {n.createdAt && <span className="ml-2 font-normal text-[var(--cb-muted)]">{fmtTime(n.createdAt)}</span>}
                      </div>
                      <div className="mt-0.5 whitespace-pre-wrap text-sm text-[var(--cb-text)]">{n.body}</div>
                    </div>
                  ))}
                  {notesError && <p className="text-sm text-[#e5484d]">{notesError}</p>}
                </div>
                <div className="flex gap-2 border-t border-[var(--cb-bg)] p-3">
                  <input
                    className="cb-input-pill flex-1 px-3 py-2 text-sm"
                    placeholder="Ghi chú gì đó cho đơn này… (Enter để gửi)"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") sendNote(); }}
                  />
                  <button onClick={sendNote} disabled={sending || !draft.trim()} className="cb-btn-primary px-4 py-2 text-sm disabled:opacity-40">
                    Gửi
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-[var(--cb-muted)]">{label}</span>
      <span className="text-right font-medium text-[var(--cb-text)]">{value}</span>
    </div>
  );
}
