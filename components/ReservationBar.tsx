// ============================================================
// FILE 7a — components/ReservationBar.tsx (Cloudbeds style)
// ONE booking bar on the staff calendar.
// It only knows how to DRAW itself (color by status, guest name,
// channel). All drag & drop logic lives in StaffCalendar —
// this component just reports events upward via callbacks.
// ============================================================

import type { Reservation, ReservationStatus } from "@/lib/mock-data";
import { getChannelName } from "@/lib/mock-data";

// Bar color per status — Cloudbeds palette. Full class names
// (Tailwind needs them written out in full, it cannot build
// class names dynamically).
export const STATUS_STYLES: Record<ReservationStatus, string> = {
  pending: "bg-[#f59e0b]",
  confirmed: "bg-[#2563eb]",
  in_house: "bg-[#1db584]",
  checked_out: "bg-[#9aa7b4]",
  cancelled: "bg-[#e5484d] line-through opacity-80",
  no_show: "bg-[#68707a]",
};

// Status labels shown to users (Vietnamese UI text for now —
// these move to language files when the i18n switcher is added)
export const STATUS_LABELS: Record<ReservationStatus, string> = {
  pending: "Chờ xác nhận",
  confirmed: "Đã xác nhận",
  in_house: "Đang ở",
  checked_out: "Đã trả phòng",
  cancelled: "Đã huỷ",
  no_show: "Khách không đến",
};

type Props = {
  reservation: Reservation;
  /** how many day-cells the bar spans visually */
  span: number;
  onDragStart: () => void;
  onClick: () => void;
};

export default function ReservationBar({ reservation, span, onDragStart, onClick }: Props) {
  const balance = reservation.totalAmount - reservation.paidAmount;

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onClick={onClick}
      title={`${reservation.guestName} — ${STATUS_LABELS[reservation.status]}`}
      className={`absolute bottom-1 left-1 top-1 z-10 cursor-grab overflow-hidden whitespace-nowrap rounded-lg px-2 py-1 text-[11px] leading-tight text-white shadow-sm active:cursor-grabbing ${STATUS_STYLES[reservation.status]}`}
      style={{ width: `calc(${span * 100}% - 8px)` }}
    >
      <div className="font-semibold">
        {reservation.guestName}
        <span className="ml-1 font-normal opacity-80">
          · {getChannelName(reservation.channelCode)}
        </span>
      </div>
      <div className="opacity-90">
        {reservation.guests} khách
        {balance > 0 && <> · còn nợ {balance.toLocaleString("vi-VN")}₫</>}
      </div>
    </div>
  );
}
