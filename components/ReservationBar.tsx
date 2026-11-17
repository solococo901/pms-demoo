// ============================================================
// FILE 7a — components/ReservationBar.tsx (Cloudbeds style)
// ONE booking bar on the staff calendar.
// It only knows how to DRAW itself (color by status, guest name,
// channel). All drag & drop logic lives in StaffCalendar —
// this component just reports events upward via callbacks.
// ============================================================

import type { Reservation, ReservationStatus } from "@/lib/mock-data";
import { getChannelName } from "@/lib/mock-data";

// Bar color per status — theo dung legend chinh thuc cua
// Cloudbeds (Classic calendar):
//   xanh la dam  = In-House (dang o)
//   xanh duong nhat = Confirmed (da xac nhan)
//   xanh ngoc nhat  = Confirmation Pending (cho xac nhan)
//   xam dam     = Checked Out (da tra phong)
// Full class names (Tailwind needs them written out in full, it
// cannot build class names dynamically). Mau nen de dau tien
// vi trang danh sach don chi lay token dau tien lam cham mau.
export const STATUS_STYLES: Record<ReservationStatus, string> = {
  pending: "bg-[#8fd0c5] text-[#134e4a]",
  confirmed: "bg-[#4aa8de] text-white",
  in_house: "bg-[#2aa76d] text-white",
  checked_out: "bg-[#757c85] text-white",
  cancelled: "bg-[#e5484d] text-white line-through opacity-80",
  no_show: "bg-[var(--cb-muted)] text-white",
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
  /** how many day-cells the bar spans visually (can be fractional) */
  span: number;
  /** true when the real check-in day is visible: the bar starts
   *  at the MIDDLE of that cell (Cloudbeds style — check-in is
   *  in the afternoon, check-out at noon, so a bar runs from the
   *  middle of the arrival cell to the middle of the departure
   *  cell, leaving a visible half-cell turnover gap) */
  startHalf?: boolean;
  /** true when the booking has any note (yellow dot, Cloudbeds legend) */
  hasNotes?: boolean;
  /** false = thanh khong keo duoc (don da tra phong / khach khong den) */
  draggable?: boolean;
  onDragStart: () => void;
  onClick: (e: { clientX: number; clientY: number }) => void;
};

export default function ReservationBar({ reservation, span, startHalf, hasNotes, draggable = true, onDragStart, onClick }: Props) {
  const balance = reservation.totalAmount - reservation.paidAmount;
  const hasDots = balance > 0 || !!hasNotes;

  return (
    <div
      draggable={draggable}
      onDragStart={draggable ? onDragStart : undefined}
      onClick={onClick}
      title={`${reservation.guestName} — ${STATUS_LABELS[reservation.status]} · ${getChannelName(reservation.channelCode)} · ${reservation.guests} khách${balance > 0 ? ` · còn nợ ${balance.toLocaleString("vi-VN")}₫` : ""}`}
      className={`absolute bottom-1 top-1 z-10 flex items-center overflow-hidden whitespace-nowrap px-3 text-[11px] leading-tight ${draggable ? "cursor-grab active:cursor-grabbing" : ""} ${STATUS_STYLES[reservation.status]}`}
      style={{
        left: startHalf ? "calc(50% + 2px)" : "4px",
        width: `calc(${span * 100}% - ${startHalf ? 6 : 8}px)`,
        // Cloudbeds slant: both ends cut diagonally (parallelogram)
        clipPath: "polygon(10px 0, 100% 0, calc(100% - 10px) 100%, 0 100%)",
      }}
    >
      <div className={`min-w-0 flex-1 truncate font-semibold ${hasDots ? "pr-8" : ""}`}>
        {reservation.guestName}
      </div>
      {hasDots && (
        <div className="absolute right-2.5 top-1/2 flex -translate-y-1/2 items-center gap-1">
          {balance > 0 && <span title="Còn nợ tiền" className="h-2 w-2 rounded-full bg-[#e5484d]" />}
          {hasNotes && <span title="Có ghi chú" className="h-2 w-2 rounded-full bg-[#facc15]" />}
        </div>
      )}
    </div>
  );
}
