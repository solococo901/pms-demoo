// CALTIDY9 — components/ReservationBar.tsx (thanh don tren Lich phong)
// Chi biet VE (mau theo trang thai, ten khach, kenh); keo-tha nam o StaffCalendar, component nay chi bao len bang callback.
// Doi sang token toi gian 2026-11-21.

import type { Reservation, ReservationStatus } from "@/lib/mock-data";
import { getChannelName } from "@/lib/mock-data";

// Mau thanh theo dung legend chinh thuc cua Cloudbeds (Classic calendar): la dam = In-House,
// duong nhat = Confirmed, ngoc nhat = Confirmation Pending, xam dam = Checked Out.
// Ten class viet day du (Tailwind khong tu ghep ten class dong). Mau nen de dau tien
// vi trang danh sach don chi lay token dau tien lam cham mau. Cac ma mau legend GIU NGUYEN,
// khong doi sang token — chi #e5484d doi sang bg-danger (cung gia tri).
export const STATUS_STYLES: Record<ReservationStatus, string> = {
  pending: "bg-[#8fd0c5] text-[#134e4a]",
  confirmed: "bg-[#4aa8de] text-white",
  in_house: "bg-[#2aa76d] text-white",
  checked_out: "bg-[#757c85] text-white",
  cancelled: "bg-danger text-white line-through opacity-80",
  no_show: "bg-muted text-white",
};

// Nhan trang thai hien cho nguoi dung (tieng Viet; chuyen sang file ngon ngu khi co i18n).
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
  /** true khi ngay nhan phong that hien: thanh bat dau tu GIUA o do
   *  (kieu Cloudbeds — nhan phong buoi chieu, tra phong buoi trua, nen
   *  thanh chay tu giua o den den giua o di, de lai nua o trong doi phong) */
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
        // Cloudbeds: dau thanh nhon 2 dau (mui ten 2 dau)
        clipPath: "polygon(10px 0, calc(100% - 10px) 0, 100% 50%, calc(100% - 10px) 100%, 10px 100%, 0 50%)",
      }}
    >
      <div className={`min-w-0 flex-1 truncate font-semibold ${hasDots ? "pr-8" : ""}`}>
        {reservation.guestName}
      </div>
      {hasDots && (
        <div className="absolute right-2.5 top-1/2 flex -translate-y-1/2 items-center gap-1">
          {balance > 0 && <span title="Còn nợ tiền" className="h-2 w-2 rounded-full bg-danger" />}
          {hasNotes && <span title="Có ghi chú" className="h-2 w-2 rounded-full bg-[#facc15]" />}
        </div>
      )}
    </div>
  );
}
