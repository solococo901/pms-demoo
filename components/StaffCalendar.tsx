"use client";
// ============================================================
// FILE 7b — components/StaffCalendar.tsx (Cloudbeds style)
// The staff calendar grid: rooms (rows) x days (columns).
//
// "use client" on the first line = this component runs in the
// browser because it reacts to mouse events (drag, click).
//
// What lives here (logic unchanged from the first version):
//   - the grid + room rows + housekeeping dots
//   - drag & drop: move a booking to another room and/or shift
//     its dates, with an overlap check before applying
//   - the unassigned bookings strip (drag one onto a room)
//   - click a bar -> detail drawer with check-in / check-out
//     buttons that update the status
// ============================================================

import { useEffect, useState } from "react";
import {
  TODAY,
  getRoomTypeName,
  getChannelName,
  roomBlockOn,
  type Reservation,
  type Room,
  type RoomBlock,
} from "@/lib/mock-data";
import { supabase } from "@/lib/supabase";
import { currentHotelId } from "@/lib/current-hotel";
import { queueChannexDates, rangeDates, stayDates } from "@/lib/channex-outbox";
import ReservationBar, { STATUS_LABELS } from "./ReservationBar";

// Round B (Buoc 4.4a): rooms, reservations and room blocks are
// loaded from Supabase and every change (drag & drop, check-in/
// out, add/remove block) is saved back to the database.
const HOTEL_ID = currentHotelId();
const ACCOUNT_ID = "11111111-1111-1111-1111-111111111111";

// ---------- date helpers (dates are "YYYY-MM-DD" strings) ----------
const DAY_MS = 86_400_000;
const toTime = (d: string) => new Date(d + "T00:00:00Z").getTime();
const toISO = (t: number) => new Date(t).toISOString().slice(0, 10);
const addDays = (d: string, n: number) => toISO(toTime(d) + n * DAY_MS);
const diffDays = (from: string, to: string) => Math.round((toTime(to) - toTime(from)) / DAY_MS);
const WEEKDAYS = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];
const dayLabel = (d: string) => {
  const date = new Date(d + "T00:00:00");
  return `${WEEKDAYS[date.getDay()]} ${date.getDate()}/${date.getMonth() + 1}`;
};
const overlaps = (aIn: string, aOut: string, bIn: string, bOut: string) => aIn < bOut && bIn < aOut;

const DAYS = Array.from({ length: 7 }, (_, i) => addDays(TODAY, i));

const HK_DOT: Record<string, string> = {
  clean: "bg-[#1db584]",
  dirty: "bg-[#e5484d]",
  in_progress: "bg-[#f59e0b]",
  out_of_order: "bg-[#9aa7b4]",
};
const HK_LABEL: Record<string, string> = {
  clean: "Đã dọn",
  dirty: "Cần dọn",
  in_progress: "Đang dọn",
  out_of_order: "Đang sửa",
};

/** what is being dragged right now */
type DragItem = { reservationId: string; roomNumber: string | null; visibleStart: number };

export default function StaffCalendar() {
  // The calendar works on its own copy of the data — when staff
  // drags or checks in, THIS state changes and the grid redraws.
  const [rooms, setRooms] = useState<Room[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [blocks, setBlocks] = useState<RoomBlock[]>([]);
  const [dbError, setDbError] = useState("");
  const [dragging, setDragging] = useState<DragItem | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [showBlockForm, setShowBlockForm] = useState(false);

  // block form state
  const [bfRoom, setBfRoom] = useState<string>("");
  const [bfFrom, setBfFrom] = useState(TODAY);
  const [bfTo, setBfTo] = useState(TODAY);
  const [bfKind, setBfKind] = useState<RoomBlock["kind"]>("out_of_order");
  const [bfReason, setBfReason] = useState("");

  const selectedBlock = blocks.find((b) => b.id === selectedBlockId) ?? null;

  // ---------- load rooms + reservations + blocks from Supabase ----------
  useEffect(() => {
    (async () => {
      const [roomsRes, resRes, rrRes, blocksRes] = await Promise.all([
        supabase.from("rooms").select("*").eq("hotel_id", HOTEL_ID).order("number"),
        supabase.from("reservations").select("*").eq("hotel_id", HOTEL_ID),
        supabase.from("reservation_rooms").select("reservation_id, room_number"),
        supabase.from("room_blocks").select("*").eq("hotel_id", HOTEL_ID),
      ]);
      const err = roomsRes.error ?? resRes.error ?? rrRes.error ?? blocksRes.error;
      if (err) return setDbError(err.message);
      setRooms(
        (roomsRes.data ?? []).map((r) => ({
          number: r.number,
          roomTypeId: r.room_type_id,
          housekeepingStatus: r.housekeeping_status,
        }))
      );
      if ((roomsRes.data ?? []).length > 0) setBfRoom((prev) => prev || roomsRes.data![0].number);
      const roomsMap = new Map<string, string[]>();
      for (const row of rrRes.data ?? []) {
        const list = roomsMap.get(row.reservation_id) ?? [];
        list.push(row.room_number);
        roomsMap.set(row.reservation_id, list);
      }
      setReservations(
        (resRes.data ?? []).map((r) => ({
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
      setBlocks(
        (blocksRes.data ?? []).map((b) => ({
          id: b.id,
          roomNumber: b.room_number,
          from: b.from_date,
          to: b.to_date,
          kind: b.kind,
          reason: b.reason ?? "",
        }))
      );
    })();
  }, []);

  async function addBlock() {
    if (!bfRoom || !bfFrom || !bfTo || bfTo < bfFrom) return;
    const nb: RoomBlock = {
      id: `blk-${Date.now()}`,
      roomNumber: bfRoom,
      from: bfFrom,
      to: bfTo,
      kind: bfKind,
      reason: bfReason || (bfKind === "out_of_order" ? "Phòng hỏng" : "Tạm đóng"),
    };
    const { error } = await supabase.from("room_blocks").insert({
      id: nb.id, hotel_id: HOTEL_ID, account_id: ACCOUNT_ID,
      room_number: nb.roomNumber, from_date: nb.from, to_date: nb.to, kind: nb.kind, reason: nb.reason,
    });
    if (error) return alert("Lưu chặn phòng không thành công: " + error.message);
    setBlocks((prev) => [...prev, nb]);
    if (nb.kind === "out_of_order") queueChannexDates(rangeDates(nb.from, nb.to));
    setBfReason("");
    setShowBlockForm(false);
  }

  async function removeBlock(id: string) {
    const blk = blocks.find((b) => b.id === id);
    const { error } = await supabase.from("room_blocks").delete().eq("id", id);
    if (error) return alert("Xoá chặn phòng không thành công: " + error.message);
    setBlocks((prev) => prev.filter((b) => b.id !== id));
    setSelectedBlockId(null);
    if (blk?.kind === "out_of_order") queueChannexDates(rangeDates(blk.from, blk.to));
  }

  const selected = reservations.find((r) => r.id === selectedId) ?? null;
  const unassigned = reservations.filter(
    (r) => r.roomNumbers.length === 0 && !["cancelled", "no_show", "checked_out"].includes(r.status)
  );

  // ---------- drop logic ----------
  async function handleDrop(roomNumber: string, dayIndex: number) {
    if (!dragging) return;
    const res = reservations.find((r) => r.id === dragging.reservationId);
    setDragging(null);
    if (!res) return;

    // Date shift: how many days the bar moved horizontally
    const shift = dragging.roomNumber === null ? 0 : dayIndex - dragging.visibleStart;
    const newCheckIn = addDays(res.checkIn, shift);
    const newCheckOut = addDays(res.checkOut, shift);

    // Block check: an out-of-order block covering any night of
    // the stay means the room is broken then — cannot move in.
    for (let d = newCheckIn; d < newCheckOut; d = addDays(d, 1)) {
      const blk = roomBlockOn(blocks, roomNumber, d, "out_of_order");
      if (blk) {
        alert(`Phòng ${roomNumber} đang bị chặn vì hỏng (${blk.reason}) từ ${blk.from} đến ${blk.to}. Không chuyển khách vào được.`);
        return;
      }
    }

    // Overlap check: would another booking already use this room then?
    const conflict = reservations.some(
      (other) =>
        other.id !== res.id &&
        !["cancelled", "no_show"].includes(other.status) &&
        other.roomNumbers.includes(roomNumber) &&
        overlaps(newCheckIn, newCheckOut, other.checkIn, other.checkOut)
    );
    if (conflict) {
      alert(`Phòng ${roomNumber} đã có khách trong khoảng ngày này. Không chuyển được.`);
      return;
    }

    // Save to the database first: new dates on the reservation,
    // and the room assignment in reservation_rooms.
    const { error: e1 } = await supabase
      .from("reservations")
      .update({ check_in: newCheckIn, check_out: newCheckOut })
      .eq("id", res.id);
    if (e1) return alert("Lưu thay đổi không thành công: " + e1.message);
    if (dragging.roomNumber === null) {
      const { error: e2 } = await supabase
        .from("reservation_rooms")
        .insert({ reservation_id: res.id, room_number: roomNumber });
      if (e2) return alert("Gán phòng không thành công: " + e2.message);
    } else if (dragging.roomNumber !== roomNumber) {
      const { error: e2 } = await supabase
        .from("reservation_rooms")
        .update({ room_number: roomNumber })
        .eq("reservation_id", res.id)
        .eq("room_number", dragging.roomNumber);
      if (e2) return alert("Đổi phòng không thành công: " + e2.message);
    }

    setReservations((prev) =>
      prev.map((r) => {
        if (r.id !== res.id) return r;
        const roomNumbers =
          dragging.roomNumber === null
            ? [...r.roomNumbers, roomNumber] // assign from unassigned strip
            : r.roomNumbers.map((n) => (n === dragging.roomNumber ? roomNumber : n));
        return { ...r, roomNumbers, checkIn: newCheckIn, checkOut: newCheckOut };
      })
    );
    queueChannexDates([...stayDates(res.checkIn, res.checkOut), ...stayDates(newCheckIn, newCheckOut)]);
  }

  async function setStatus(id: string, status: Reservation["status"]) {
    const { error } = await supabase.from("reservations").update({ status }).eq("id", id);
    if (error) return alert("Lưu trạng thái không thành công: " + error.message);
    setReservations((prev) => prev.map((r) => (r.id === id ? { ...r, status } : r)));
    const r = reservations.find((x) => x.id === id);
    if (r) queueChannexDates(stayDates(r.checkIn, r.checkOut));
  }

  // ---------- render ----------
  return (
    <div className="relative">
      {dbError && <p className="mb-3 rounded-lg bg-[#fdecec] px-3 py-2 text-sm text-[#e5484d]">Lỗi cơ sở dữ liệu: {dbError}</p>}
      {/* Unassigned strip */}
      {unassigned.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-[#f0d9a8] bg-[#fff8ec] p-3">
          <span className="text-sm font-medium text-[#92600a]">Chưa gán phòng — kéo thả vào phòng trống:</span>
          {unassigned.map((r) => (
            <span
              key={r.id}
              draggable
              onDragStart={() => setDragging({ reservationId: r.id, roomNumber: null, visibleStart: 0 })}
              onClick={() => setSelectedId(r.id)}
              className="cursor-grab rounded-md bg-[#f59e0b] px-2 py-1 text-xs font-medium text-white shadow-sm"
            >
              {r.guestName} · {r.checkIn.slice(5)} → {r.checkOut.slice(5)}
            </span>
          ))}
        </div>
      )}

      {/* Block-a-room toolbar + form */}
      <div className="mb-4">
        <button onClick={() => setShowBlockForm((v) => !v)} className="cb-btn-ghost px-3 py-2 text-sm">
          ＋ Chặn phòng (sửa chữa / tạm đóng)
        </button>
        {showBlockForm && (
          <div className="cb-card mt-3 flex flex-wrap items-end gap-3 p-4 text-sm text-[#17293e]">
            <label>
              Phòng
              <select value={bfRoom} onChange={(e) => setBfRoom(e.target.value)} className="ml-2 rounded-lg border border-[#dde3ea] px-2 py-2">
                {rooms.map((r) => (
                  <option key={r.number} value={r.number}>{r.number} — {getRoomTypeName(r.roomTypeId)}</option>
                ))}
              </select>
            </label>
            <label>
              Từ đêm
              <input type="date" value={bfFrom} onChange={(e) => setBfFrom(e.target.value)} className="ml-2 rounded-lg border border-[#dde3ea] px-2 py-2" />
            </label>
            <label>
              Đến đêm (tính cả đêm này)
              <input type="date" value={bfTo} onChange={(e) => setBfTo(e.target.value)} className="ml-2 rounded-lg border border-[#dde3ea] px-2 py-2" />
            </label>
            <label>
              Loại chặn
              <select value={bfKind} onChange={(e) => setBfKind(e.target.value as RoomBlock["kind"])} className="ml-2 rounded-lg border border-[#dde3ea] px-2 py-2">
                <option value="out_of_order">Phòng hỏng — trừ khỏi phòng bán được</option>
                <option value="out_of_service">Tạm đóng — vẫn tính trong tồn, chỉ đánh dấu</option>
              </select>
            </label>
            <label>
              Lý do
              <input value={bfReason} onChange={(e) => setBfReason(e.target.value)} className="ml-2 rounded-lg border border-[#dde3ea] px-2 py-2" placeholder="VD: Sửa điều hoà" />
            </label>
            <button onClick={addBlock} className="cb-btn-primary px-4 py-2 text-sm">Thêm chặn</button>
          </div>
        )}
      </div>

      {/* Grid: first column = room, then 7 day columns */}
      <div
        className="grid overflow-hidden rounded-xl border border-[#dde3ea] bg-white shadow-[0_1px_3px_rgba(23,41,62,0.06)]"
        style={{ gridTemplateColumns: `150px repeat(${DAYS.length}, 1fr)` }}
      >
        {/* header row */}
        <div className="border-b border-[#eef1f5] bg-[#f7f9fb] px-3 py-2 text-xs font-semibold text-[#68707a]">Phòng</div>
        {DAYS.map((d) => (
          <div
            key={d}
            className={`border-b border-l border-[#eef1f5] bg-[#f7f9fb] px-2 py-2 text-center text-xs font-semibold ${d === TODAY ? "text-[#2563eb]" : "text-[#68707a]"}`}
          >
            {dayLabel(d)}
            {d === TODAY && " · hôm nay"}
          </div>
        ))}

        {/* one row per physical room */}
        {rooms.map((room) => (
          <div key={room.number} className="contents">
            <div className="flex items-center gap-2 border-b border-[#eef1f5] px-3 py-2">
              <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${HK_DOT[room.housekeepingStatus]}`} title={HK_LABEL[room.housekeepingStatus]} />
              <div>
                <div className="text-sm font-semibold text-[#17293e]">{room.number}</div>
                <div className="text-[11px] text-[#68707a]">{getRoomTypeName(room.roomTypeId)}</div>
              </div>
            </div>

            {DAYS.map((day, dayIndex) => (
              <div
                key={day}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => handleDrop(room.number, dayIndex)}
                className={`relative min-h-[52px] border-b border-l border-[#eef1f5] ${day === TODAY ? "bg-[#f2f6fe]" : ""}`}
              >
                {/* room-block bars that start (visibly) in this cell */}
                {blocks
                  .filter((b) => b.roomNumber === room.number)
                  .map((b) => {
                    const startIdx = diffDays(TODAY, b.from);
                    const endIdx = diffDays(TODAY, b.to) + 1; // block "to" is the last blocked night (included)
                    const visibleStart = Math.max(0, startIdx);
                    const visibleEnd = Math.min(DAYS.length, endIdx);
                    if (visibleStart !== dayIndex || visibleEnd <= visibleStart) return null;
                    const span = visibleEnd - visibleStart;
                    return (
                      <div
                        key={b.id}
                        onClick={() => setSelectedBlockId(b.id)}
                        title={`${b.kind === "out_of_order" ? "Phòng hỏng" : "Tạm đóng"} · ${b.from} → ${b.to} · ${b.reason} (bấm để xem / xoá)`}
                        className={`absolute inset-y-1 left-0.5 z-[5] flex cursor-pointer items-center overflow-hidden whitespace-nowrap rounded px-2 text-[11px] font-medium text-white ${b.kind === "out_of_order" ? "bg-[#68707a]" : "bg-[#9aa7b4]"}`}
                        style={{ width: `calc(${span * 100}% - 4px)` }}
                      >
                        {b.kind === "out_of_order" ? "🚫" : "🧹"} {b.reason}
                      </div>
                    );
                  })}
                {/* bars that start (visibly) in this cell */}
                {reservations
                  .filter((r) => r.roomNumbers.includes(room.number))
                  .map((r) => {
                    const startIdx = diffDays(TODAY, r.checkIn);
                    const endIdx = diffDays(TODAY, r.checkOut);
                    const visibleStart = Math.max(0, startIdx);
                    const visibleEnd = Math.min(DAYS.length, endIdx);
                    if (visibleStart !== dayIndex || visibleEnd <= visibleStart) return null;
                    return (
                      <ReservationBar
                        key={r.id + room.number}
                        reservation={r}
                        span={visibleEnd - visibleStart}
                        onDragStart={() =>
                          setDragging({ reservationId: r.id, roomNumber: room.number, visibleStart })
                        }
                        onClick={() => setSelectedId(r.id)}
                      />
                    );
                  })}
              </div>
            ))}
          </div>
        ))}
      </div>

      <p className="mt-3 text-xs text-[#68707a]">
        Màu chấm cạnh số phòng = trạng thái dọn phòng. Thanh xám = phòng đang bị chặn theo ngày (🚫 hỏng — bị trừ khỏi số phòng bán được; 🧹 tạm đóng — chỉ đánh dấu), bấm vào thanh xám để xem hoặc xoá chặn.
        Kéo thanh khách sang phòng khác để đổi phòng, kéo ngang để đổi ngày — trùng lịch hoặc dính phòng hỏng sẽ bị chặn. Bấm vào thanh khách để mở hồ sơ.
      </p>

      {/* selected room-block panel */}
      {selectedBlock && (
        <div className="cb-card mt-3 flex flex-wrap items-center gap-3 p-4 text-sm text-[#17293e]">
          <span className={`rounded-md px-2 py-1 text-xs font-bold text-white ${selectedBlock.kind === "out_of_order" ? "bg-[#68707a]" : "bg-[#9aa7b4]"}`}>
            {selectedBlock.kind === "out_of_order" ? "🚫 PHÒNG HỎNG" : "🧹 TẠM ĐÓNG"}
          </span>
          <span className="font-semibold">Phòng {selectedBlock.roomNumber}</span>
          <span>{selectedBlock.from} → {selectedBlock.to} (đến đêm {selectedBlock.to})</span>
          <span className="text-[#68707a]">{selectedBlock.reason}</span>
          <span className="ml-auto flex gap-2">
            <button onClick={() => removeBlock(selectedBlock.id)} className="rounded-lg border border-[#e5484d] px-3 py-1.5 text-sm font-semibold text-[#e5484d] hover:bg-red-50">
              Xoá chặn (mở phòng lại)
            </button>
            <button onClick={() => setSelectedBlockId(null)} className="cb-btn-ghost px-3 py-1.5 text-sm">Đóng</button>
          </span>
        </div>
      )}

      {/* ---------- reservation detail drawer ---------- */}
      {selected && (
        <>
          <div className="fixed inset-0 z-20 bg-[#17293e]/30" onClick={() => setSelectedId(null)} />
          <div className="fixed inset-y-0 right-0 z-30 flex w-96 max-w-[90vw] flex-col bg-white shadow-2xl">
            <div className="flex items-start justify-between border-b border-[#eef1f5] p-5">
              <div>
                <div className="text-lg font-bold text-[#17293e]">{selected.guestName}</div>
                <div className="text-sm text-[#68707a]">
                  Đơn {selected.id} · {getChannelName(selected.channelCode)} · {STATUS_LABELS[selected.status]}
                </div>
              </div>
              <button onClick={() => setSelectedId(null)} className="cb-btn-ghost flex h-8 w-8 items-center justify-center rounded-full text-sm">✕</button>
            </div>

            <div className="flex-1 space-y-3 overflow-y-auto p-5 text-sm">
              <Row label="Số điện thoại" value={selected.guestPhone} />
              <Row label="Ngày đến → đi" value={`${selected.checkIn} → ${selected.checkOut}`} />
              <Row label="Phòng" value={selected.roomNumbers.length ? selected.roomNumbers.join(", ") : "Chưa gán"} />
              <Row label="Loại phòng" value={getRoomTypeName(selected.roomTypeId)} />
              <Row label="Số khách" value={String(selected.guests)} />
              <Row label="Thu tiền bởi" value={selected.paymentCollector === "channel_collect" ? "Kênh thu hộ" : "Khách sạn tự thu"} />
              <Row label="Tổng tiền" value={`${selected.totalAmount.toLocaleString("vi-VN")}₫`} />
              <Row label="Đã trả" value={`${selected.paidAmount.toLocaleString("vi-VN")}₫`} />
              <Row
                label="Còn nợ"
                value={`${(selected.totalAmount - selected.paidAmount).toLocaleString("vi-VN")}₫`}
                danger={selected.totalAmount - selected.paidAmount > 0}
              />
              {selected.note && <Row label="Ghi chú" value={selected.note} />}
            </div>

            <div className="flex gap-2 border-t border-[#eef1f5] p-5">
              {selected.status === "confirmed" && (
                <button onClick={() => setStatus(selected.id, "in_house")} className="cb-btn-primary flex-1 py-2.5 text-sm">
                  Nhận phòng
                </button>
              )}
              {selected.status === "in_house" && (
                <button onClick={() => setStatus(selected.id, "checked_out")} className="cb-btn-primary flex-1 py-2.5 text-sm">
                  Trả phòng
                </button>
              )}
              {["pending", "confirmed"].includes(selected.status) && (
                <button onClick={() => setStatus(selected.id, "cancelled")} className="rounded-lg border border-[#e5484d] px-4 py-2.5 text-sm font-semibold text-[#e5484d] hover:bg-red-50">
                  Huỷ đơn
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Row({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-[#68707a]">{label}</span>
      <span className={`text-right font-medium ${danger ? "text-[#e5484d]" : "text-[#17293e]"}`}>{value}</span>
    </div>
  );
}
