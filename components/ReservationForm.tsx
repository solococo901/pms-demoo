"use client";
// ============================================================
// FILE DT2 — components/ReservationForm.tsx (Cloudbeds style)
// The "create reservation" form (front desk: walk-in / phone).
//
// Upgrades in this version:
//   - Guests are split into ADULTS and CHILDREN — the total now
//     includes EXTRA-GUEST FEES: the plan's price already covers
//     baseOccupancy adults; every extra adult / child adds the
//     plan's per-night fee (see extraFeesPerNight in mock-data).
//   - Nightly prices are resolved with resolvePlanPrice, so a
//     DERIVED plan (ke thua) is priced from its base plan +
//     formula, exactly like the selling grid shows.
//   - The form refuses more guests than the room type can hold.
//   - The summary box breaks the total down: room money +
//     extra-guest fees, so staff can explain it to the guest.
// ============================================================

import { useMemo, useState } from "react";
import {
  CHANNELS,
  TODAY,
  extraFeesPerNight,
  resolvePlanPrice,
  type RatePlan,
  type Reservation,
  type Room,
  type RoomType,
} from "@/lib/mock-data";

const DAY_MS = 86_400_000;
const toTime = (d: string) => new Date(d + "T00:00:00Z").getTime();
const toISO = (t: number) => new Date(t).toISOString().slice(0, 10);
const addDays = (d: string, n: number) => toISO(toTime(d) + n * DAY_MS);
const diffDays = (a: string, b: string) => Math.round((toTime(b) - toTime(a)) / DAY_MS);
const fmt = (n: number) => n.toLocaleString("vi-VN");

// Random booking code, same style as Cloudbeds (10 chars)
const newId = () =>
  Array.from({ length: 10 }, () => "ABCDEFGHJKMNPQRSTUVWXYZ23456789"[Math.floor(Math.random() * 31)]).join("");

export default function ReservationForm({
  onCreate,
  onClose,
  roomTypes,
  ratePlans,
  rooms,
}: {
  onCreate: (r: Reservation) => void;
  onClose: () => void;
  roomTypes: RoomType[];
  ratePlans: RatePlan[];
  rooms: Room[];
}) {
  const [guestName, setGuestName] = useState("");
  const [guestPhone, setGuestPhone] = useState("");
  const firstType = roomTypes[0];
  const firstPlan = ratePlans.find((p) => p.roomTypeId === firstType?.id);
  const [channelCode, setChannelCode] = useState(firstPlan?.channelCode ?? "frontdesk");
  const [roomTypeId, setRoomTypeId] = useState(firstType?.id ?? "");
  const [ratePlanId, setRatePlanId] = useState(firstPlan?.id ?? "");
  const [checkIn, setCheckIn] = useState(TODAY);
  const [checkOut, setCheckOut] = useState(addDays(TODAY, 1));
  const [adults, setAdults] = useState(2);
  const [children, setChildren] = useState(0);
  const [roomNumber, setRoomNumber] = useState(""); // "" = leave unassigned
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  // rate plans available for the chosen channel + room type
  const availablePlans = useMemo(
    () => ratePlans.filter((p) => p.channelCode === channelCode && p.roomTypeId === roomTypeId),
    [channelCode, roomTypeId]
  );
  const plan = availablePlans.find((p) => p.id === ratePlanId) ?? availablePlans[0];
  const roomType = roomTypes.find((t) => t.id === roomTypeId);
  const typeRooms = rooms.filter((r) => r.roomTypeId === roomTypeId);

  const nights = Math.max(0, diffDays(checkIn, checkOut));
  const fees = plan ? extraFeesPerNight(plan, adults, children) : { extraAdults: 0, adultTotal: 0, childTotal: 0, total: 0 };
  const roomTotal = useMemo(() => {
    if (!plan || nights === 0) return 0;
    let sum = 0;
    for (let i = 0; i < nights; i++) sum += resolvePlanPrice(plan, addDays(checkIn, i), ratePlans) ?? 0;
    return sum;
  }, [plan, checkIn, nights]);
  const feesTotal = fees.total * nights;
  const total = roomTotal + feesTotal;

  function handleChannel(code: string) {
    setChannelCode(code);
    const first = ratePlans.find((p) => p.channelCode === code && p.roomTypeId === roomTypeId);
    setRatePlanId(first?.id ?? "");
  }

  function handleSubmit() {
    if (!guestName.trim()) return setError("Chưa nhập tên khách.");
    if (nights <= 0) return setError("Ngày đi phải sau ngày đến.");
    if (!plan) return setError("Kênh này chưa có gói giá cho loại phòng đã chọn.");
    if (roomType && adults + children > roomType.maxOccupancy)
      return setError(`Loại phòng này ở tối đa ${roomType.maxOccupancy} khách — đang nhập ${adults + children} khách.`);
    if (adults < 1) return setError("Phải có ít nhất 1 người lớn.");
    onCreate({
      id: newId(),
      guestName: guestName.trim(),
      guestPhone,
      channelCode,
      paymentCollector: "hotel_collect",
      roomNumbers: roomNumber ? [roomNumber] : [],
      roomTypeId,
      ratePlanId: plan.id,
      checkIn,
      checkOut,
      guests: adults + children,
      adults,
      children,
      totalAmount: total,
      paidAmount: 0,
      status: "confirmed",
      createdAt: TODAY,
      note: note || undefined,
    });
  }

  const inputCls = "w-full rounded-lg border border-[#dde3ea] px-3 py-2 text-sm text-[#17293e] outline-none focus:border-[#2563eb]";
  const labelCls = "block text-xs font-medium text-[#68707a] mb-1";

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-[#17293e]/40 p-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-6 shadow-xl">
        <div className="flex items-start justify-between">
          <h2 className="text-lg font-bold text-[#17293e]">Tạo đặt phòng mới</h2>
          <button onClick={onClose} className="cb-btn-ghost flex h-8 w-8 items-center justify-center rounded-full text-sm">✕</button>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className={labelCls}>Tên khách *</label>
            <input className={inputCls} value={guestName} onChange={(e) => setGuestName(e.target.value)} placeholder="VD: Nguyễn Văn A" />
          </div>
          <div>
            <label className={labelCls}>Số điện thoại</label>
            <input className={inputCls} value={guestPhone} onChange={(e) => setGuestPhone(e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>Nguồn đơn</label>
            <select className={inputCls} value={channelCode} onChange={(e) => handleChannel(e.target.value)}>
              {CHANNELS.map((c) => (<option key={c.code} value={c.code}>{c.name}</option>))}
            </select>
          </div>
          <div>
            <label className={labelCls}>Loại phòng</label>
            <select
              className={inputCls}
              value={roomTypeId}
              onChange={(e) => {
                setRoomTypeId(e.target.value);
                const first = ratePlans.find((p) => p.channelCode === channelCode && p.roomTypeId === e.target.value);
                setRatePlanId(first?.id ?? "");
                setRoomNumber("");
              }}
            >
              {roomTypes.map((t) => (<option key={t.id} value={t.id}>{t.name} (tối đa {t.maxOccupancy} khách)</option>))}
            </select>
          </div>
          <div>
            <label className={labelCls}>Gói giá (của kênh đã chọn)</label>
            <select className={inputCls} value={plan?.id ?? ""} onChange={(e) => setRatePlanId(e.target.value)}>
              {availablePlans.map((p) => (<option key={p.id} value={p.id}>{p.name}{p.derivedFromId ? " (kế thừa)" : ""}</option>))}
              {availablePlans.length === 0 && <option value="">— chưa có gói giá —</option>}
            </select>
          </div>
          <div>
            <label className={labelCls}>Ngày đến</label>
            <input type="date" className={inputCls} value={checkIn} onChange={(e) => setCheckIn(e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>Ngày đi</label>
            <input type="date" className={inputCls} value={checkOut} onChange={(e) => setCheckOut(e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>Người lớn</label>
            <input type="number" min={1} className={inputCls} value={adults} onChange={(e) => setAdults(Number(e.target.value))} />
          </div>
          <div>
            <label className={labelCls}>Trẻ em (có phụ thu)</label>
            <input type="number" min={0} className={inputCls} value={children} onChange={(e) => setChildren(Number(e.target.value))} />
          </div>
          <div>
            <label className={labelCls}>Gán phòng ngay</label>
            <select className={inputCls} value={roomNumber} onChange={(e) => setRoomNumber(e.target.value)}>
              <option value="">— để chưa gán —</option>
              {typeRooms.map((r) => (<option key={r.number} value={r.number}>Phòng {r.number}</option>))}
            </select>
          </div>
          <div>
            <label className={labelCls}>Giá gồm sẵn</label>
            <div className="rounded-lg bg-[#f7f9fb] px-3 py-2 text-sm text-[#68707a]">
              {plan ? `${plan.baseOccupancy ?? 2} người lớn · thêm NL ${fmt(plan.extraAdultFee ?? 0)}₫/đêm · TE ${fmt(plan.extraChildFee ?? 0)}₫/đêm` : "—"}
            </div>
          </div>
          <div className="col-span-2">
            <label className={labelCls}>Ghi chú</label>
            <input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Yêu cầu đặc biệt..." />
          </div>
        </div>

        <div className="mt-4 space-y-1 rounded-xl bg-[#f2f6fe] px-4 py-3 text-sm text-[#17293e]">
          <div className="flex items-center justify-between">
            <span>Tiền phòng — {nights} đêm × {plan?.name ?? "—"}</span>
            <span className="font-semibold">{fmt(roomTotal)}₫</span>
          </div>
          {feesTotal > 0 && (
            <div className="flex items-center justify-between text-[#68707a]">
              <span>
                Phụ thu khách thêm ({fees.extraAdults > 0 ? `+${fees.extraAdults} người lớn` : ""}{fees.extraAdults > 0 && children > 0 ? ", " : ""}{children > 0 ? `+${children} trẻ em` : ""}) × {nights} đêm
              </span>
              <span className="font-semibold">{fmt(feesTotal)}₫</span>
            </div>
          )}
          <div className="flex items-center justify-between border-t border-[#dde3ea] pt-1.5">
            <span className="font-semibold">Tổng tiền</span>
            <span className="text-base font-bold text-[#2563eb]">{fmt(total)}₫</span>
          </div>
        </div>
        {error && <p className="mt-3 text-sm text-[#e5484d]">{error}</p>}

        <div className="mt-5 flex gap-2">
          <button onClick={handleSubmit} className="cb-btn-primary flex-1 py-2.5 text-sm">
            Tạo đặt phòng
          </button>
          <button onClick={onClose} className="cb-btn-ghost px-5 py-2.5 text-sm">Đóng</button>
        </div>
      </div>
    </div>
  );
}
