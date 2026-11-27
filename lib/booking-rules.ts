// ============================================================
// lib/booking-rules.ts — BO KIEM TRA DUNG CHUNG (quy tac rang buoc)
//
// Quy tac chot 2026-11-17 theo yeu cau cua Vos: moi thao tac tao /
// sua / gia han / keo-tha / gan phong / nhan-tra / huy don deu
// phai chay qua cac ham o day TRUOC KHI LUU — khong man hinh nao
// tu tinh ton, tu kiem tra rieng nua. Chi co 1 cach tinh ton
// (quy chung: phong ban duoc - don dang giu), nen khong the lech
// nhau dan toi overbooking.
//
// Ket qua tra ve: { ok, error?, warnings[] }
//   - ok = false  -> CHAN, hien error cho nguoi dung, khong luu.
//   - ok = true + warnings -> cho luu nhung hien canh bao truoc
//     (vi du: phong chua don xong, khach con no khi tra phong).
//
// Buoc Payment (thu tien / coc) CHUA lam o vong nay — ham
// validatePayment de san o cuoi file, giao dien Payment se goi
// no khi chen buoc 5 vao wizard tao don moi.
// ============================================================

import {
  extraFeesPerNight,
  inventoryBlockOn,
  resolvePlanPrice,
  roomBlockOn,
  type InventoryBlock,
  type RatePlan,
  type Reservation,
  type Room,
  type RoomBlock,
} from "@/lib/mock-data";
import { stayDates } from "@/lib/channex-outbox";

export type RuleResult = { ok: boolean; error?: string; warnings: string[] };
const pass = (warnings: string[] = []): RuleResult => ({ ok: true, warnings });
const fail = (error: string, warnings: string[] = []): RuleResult => ({ ok: false, error, warnings });

const fmtDateShort = (iso: string): string => iso.split("-").reverse().join("/");

// ---------- ngay thang ----------

/** So dem o: checkOut - checkIn. Tra 0 neu ngay sai. */
export const nightsBetween = (checkIn: string, checkOut: string): number => {
  const t0 = new Date(`${checkIn}T00:00:00Z`).getTime();
  const t1 = new Date(`${checkOut}T00:00:00Z`).getTime();
  if (Number.isNaN(t0) || Number.isNaN(t1)) return 0;
  return Math.round((t1 - t0) / 86_400_000);
};

export const isPastDate = (date: string, today: string): boolean => date < today;

// ---------- du lieu dung chung cho moi phep tinh ton ----------

export type AvailabilityData = {
  rooms: Room[];
  reservations: Reservation[];
  blocks: RoomBlock[];
  invBlocks: InventoryBlock[];
};

/** Don dang "giu phong": chua huy, khach khong phai khong den, chua tra phong. */
export const isActiveBooking = (r: Reservation): boolean =>
  !["cancelled", "no_show", "checked_out"].includes(r.status);

/**
 * Phong con trong cua 1 loai phong trong 1 dem (quy chung cho moi kenh):
 *   phong ban duoc = phong cua loai - phong hong dem do
 *   da dung = phong da gan thuoc loai + 1 cho moi don chua gan cua loai
 *   kenh bi dong ban loai nay dem nay -> 0
 * Am nghia la thua (don thua ra), phai hien so am de thay ro.
 */
export function roomsLeftOn(
  data: AvailabilityData,
  roomTypeId: string,
  date: string,
  channelCode: string,
): number {
  const { rooms, reservations, blocks, invBlocks } = data;
  if (inventoryBlockOn(invBlocks, channelCode, roomTypeId, date)) return 0;
  const roomsOfType = rooms.filter((r) => r.roomTypeId === roomTypeId);
  const sellable = roomsOfType.filter(
    (r) => !roomBlockOn(blocks, r.number, date, "out_of_order"),
  ).length;
  let used = 0;
  for (const r of reservations) {
    if (!isActiveBooking(r)) continue;
    if (!(r.checkIn <= date && date < r.checkOut)) continue;
    const assignedInType = r.roomNumbers.filter(
      (n) => rooms.find((rm) => rm.number === n)?.roomTypeId === roomTypeId,
    ).length;
    if (assignedInType > 0) used += assignedInType;
    else if (r.roomNumbers.length === 0 && r.roomTypeId === roomTypeId) used += 1;
  }
  return sellable - used;
}

/** Phong con it nhat trong ca ky o + dem kem nhat (de bao loi dung dem). */
export function roomsLeftRange(
  data: AvailabilityData,
  roomTypeId: string,
  checkIn: string,
  checkOut: string,
  channelCode: string,
): { minLeft: number; worstDate: string | null } {
  const dates = stayDates(checkIn, checkOut);
  if (dates.length === 0) return { minLeft: 0, worstDate: null };
  let minLeft = Number.POSITIVE_INFINITY;
  let worstDate: string | null = null;
  for (const d of dates) {
    const left = roomsLeftOn(data, roomTypeId, d, channelCode);
    if (left < minLeft) {
      minLeft = left;
      worstDate = d;
    }
  }
  return { minLeft, worstDate };
}

/**
 * 1 phong cu the co gan duoc cho don nay khong:
 *   - phai thuoc dung loai phong cua don
 *   - khong hong dem nao trong ky o (CHAN)
 *   - khong trung don khac dang giu phong do (CHAN)
 *   - phong chua don xong / tam dong: chi CANH BAO, de nguoi quyet
 */
export function roomFits(
  data: AvailabilityData,
  room: Room,
  roomTypeId: string,
  checkIn: string,
  checkOut: string,
  excludeReservationId?: string,
): RuleResult {
  const warnings: string[] = [];
  if (room.roomTypeId !== roomTypeId)
    return fail(`Phòng ${room.number} không thuộc loại phòng đã chọn.`);
  const dates = stayDates(checkIn, checkOut);
  for (const d of dates) {
    const blk = roomBlockOn(data.blocks, room.number, d, "out_of_order");
    if (blk)
      return fail(`Phòng ${room.number} đang hỏng (${blk.reason}) đêm ${fmtDateShort(d)}.`);
  }
  for (const other of data.reservations) {
    if (other.id === excludeReservationId) continue;
    if (!isActiveBooking(other)) continue;
    if (!other.roomNumbers.includes(room.number)) continue;
    if (other.checkIn < checkOut && checkIn < other.checkOut)
      return fail(
        `Phòng ${room.number} đã có khách ${other.guestName} (${fmtDateShort(other.checkIn)} → ${fmtDateShort(other.checkOut)}).`,
      );
  }
  if (["dirty", "in_progress"].includes(room.housekeepingStatus))
    warnings.push(`Phòng ${room.number} chưa dọn xong.`);
  const oos = dates
    .map((d) => roomBlockOn(data.blocks, room.number, d, "out_of_service"))
    .find(Boolean);
  if (oos) warnings.push(`Phòng ${room.number} đang tạm đóng (${oos.reason}) trong kỳ ở.`);
  return pass(warnings);
}

/** Danh sach phong gan duoc (cho o chon phong), sap theo so phong. */
export function fittingRooms(
  data: AvailabilityData,
  roomTypeId: string,
  checkIn: string,
  checkOut: string,
  excludeReservationId?: string,
): Room[] {
  return data.rooms
    .filter((rm) => rm.roomTypeId === roomTypeId)
    .filter((rm) => roomFits(data, rm, roomTypeId, checkIn, checkOut, excludeReservationId).ok)
    .sort((a, b) => a.number.localeCompare(b.number));
}

// ---------- ngay + so khach ----------

/** Ngay di sau ngay den, ngay den khong o qua khu, du suc chua, it nhat 1 nguoi lon. */
export function validateStay(
  checkIn: string,
  checkOut: string,
  adults: number,
  children: number,
  maxOccupancy: number,
  today: string,
): RuleResult {
  if (!checkIn || !checkOut) return fail("Chưa chọn đủ ngày đến / ngày đi.");
  if (nightsBetween(checkIn, checkOut) <= 0) return fail("Ngày đi phải sau ngày đến.");
  if (isPastDate(checkIn, today)) return fail("Ngày đến đã qua — không đặt được đơn vào ngày quá khứ.");
  if (adults < 1) return fail("Phải có ít nhất 1 người lớn.");
  if (adults + children > maxOccupancy)
    return fail(`Loại phòng này tối đa ${maxOccupancy} khách, đã nhập ${adults + children} khách.`);
  return pass();
}

// ---------- gia ----------

export type PriceBreakdown = {
  perNight: { date: string; price: number | null }[];
  unpriced: string[];
  roomTotal: number;
  feesTotal: number;
  grandTotal: number;
};

/** Gia that tung dem + phu thu them khach. Dem chua co gia -> price null, vao danh sach unpriced. */
export function priceBreakdown(
  plan: RatePlan,
  allPlans: RatePlan[],
  checkIn: string,
  checkOut: string,
  adults: number,
  children: number,
  overrides?: Record<string, number>,
): PriceBreakdown {
  const dates = stayDates(checkIn, checkOut);
  const perNight = dates.map((date) => {
    const price = resolvePlanPrice(plan, date, allPlans, overrides);
    return { date, price: price === undefined ? null : price };
  });
  const unpriced = perNight.filter((n) => n.price === null).map((n) => n.date);
  const roomTotal = perNight.reduce((s, n) => s + (n.price ?? 0), 0);
  const feesTotal = extraFeesPerNight(plan, adults, children).total * dates.length;
  return { perNight, unpriced, roomTotal, feesTotal, grandTotal: roomTotal + feesTotal };
}

// ---------- tao don moi ----------

export type CreateInput = {
  data: AvailabilityData;
  checkIn: string;
  checkOut: string;
  adults: number;
  children: number;
  maxOccupancy: number;
  roomTypeId: string;
  plan?: RatePlan; // goi gia cua kenh + loai phong nay (thieu -> chan)
  allPlans: RatePlan[];
  overrides?: Record<string, number>;
  channelCode: string;
  roomNumber?: string; // gan phong ngay (neu co)
  today: string;
};

/** Tao don: ngay + khach -> gia du cac dem + tong > 0 -> con ton / phong gan duoc. */
export function validateCreate(
  input: CreateInput,
): RuleResult & { breakdown?: PriceBreakdown } {
  const stay = validateStay(
    input.checkIn,
    input.checkOut,
    input.adults,
    input.children,
    input.maxOccupancy,
    input.today,
  );
  if (!stay.ok) return stay;
  if (!input.plan)
    return fail("Kênh này chưa có gói giá cho loại phòng này — tạo gói giá ở Kênh bán rồi tạo lại đơn.");
  const breakdown = priceBreakdown(
    input.plan,
    input.allPlans,
    input.checkIn,
    input.checkOut,
    input.adults,
    input.children,
    input.overrides,
  );
  if (breakdown.unpriced.length > 0)
    return {
      ...fail(
        `Chưa có giá đêm ${breakdown.unpriced.map(fmtDateShort).join(", ")} — nhập giá ở Lịch giá rồi tạo lại đơn.`,
      ),
      breakdown,
    };
  if (breakdown.grandTotal <= 0)
    return { ...fail("Tổng đơn đang là 0₫ — kiểm tra lại giá các đêm ở Lịch giá."), breakdown };
  if (input.roomNumber) {
    const room = input.data.rooms.find((rm) => rm.number === input.roomNumber);
    if (!room) return { ...fail(`Không tìm thấy phòng ${input.roomNumber}.`), breakdown };
    const fits = roomFits(input.data, room, input.roomTypeId, input.checkIn, input.checkOut);
    if (!fits.ok) return { ...fits, breakdown };
    return { ...pass(fits.warnings), breakdown };
  }
  const { minLeft, worstDate } = roomsLeftRange(
    input.data,
    input.roomTypeId,
    input.checkIn,
    input.checkOut,
    input.channelCode,
  );
  if (minLeft < 1)
    return {
      ...fail(
        `Loại phòng này đã hết đêm ${worstDate ? fmtDateShort(worstDate) : ""} — không tạo được đơn.`,
      ),
      breakdown,
    };
  return { ...pass(), breakdown };
}

// ---------- sua don ----------

/** Sua don: don phai sua duoc + chay lai toan bo kiem tra nhu tao moi (tru chinh don dang sua ra khoi phep dem ton). */
export function validateEdit(
  input: CreateInput & { booking: Reservation },
): RuleResult & { breakdown?: PriceBreakdown } {
  const editable = canEdit(input.booking);
  if (!editable.ok) return editable;
  const dataWithoutSelf: AvailabilityData = {
    ...input.data,
    reservations: input.data.reservations.filter((r) => r.id !== input.booking.id),
  };
  return validateCreate({ ...input, data: dataWithoutSelf });
}

/** Khong sua don da tra phong / da huy / khach khong den. */
export function canEdit(booking: Reservation): RuleResult {
  if (["checked_out", "cancelled", "no_show"].includes(booking.status))
    return fail("Không sửa được đơn đã trả phòng / đã huỷ / khách không đến.");
  return pass();
}

// ---------- gia han ----------

/** Gia han: ngay di moi phai sau ngay di cu; cac dem them phai con ton + co gia. */
export function validateExtend(
  data: AvailabilityData,
  booking: Reservation,
  newCheckOut: string,
  plan: RatePlan,
  allPlans: RatePlan[],
  overrides: Record<string, number> | undefined,
  channelCode: string,
): RuleResult & { addedTotal?: number } {
  if (!["pending", "confirmed", "in_house"].includes(booking.status))
    return fail("Chỉ gia hạn được đơn đang chờ, đã xác nhận hoặc đang ở.");
  if (nightsBetween(booking.checkOut, newCheckOut) <= 0)
    return fail("Ngày đi mới phải sau ngày đi hiện tại.");
  const breakdown = priceBreakdown(
    plan,
    allPlans,
    booking.checkOut,
    newCheckOut,
    booking.adults ?? booking.guests,
    booking.children ?? 0,
    overrides,
  );
  if (breakdown.unpriced.length > 0)
    return fail(
      `Chưa có giá đêm ${breakdown.unpriced.map(fmtDateShort).join(", ")} — nhập giá ở Lịch giá rồi gia hạn.`,
    );
  if (booking.roomNumbers.length > 0) {
    for (const n of booking.roomNumbers) {
      const room = data.rooms.find((rm) => rm.number === n);
      if (!room) continue;
      const fits = roomFits(data, room, booking.roomTypeId, booking.checkOut, newCheckOut, booking.id);
      if (!fits.ok) return fits;
    }
  } else {
    const { minLeft, worstDate } = roomsLeftRange(
      data,
      booking.roomTypeId,
      booking.checkOut,
      newCheckOut,
      channelCode,
    );
    if (minLeft < 1)
      return fail(
        `Loại phòng này đã hết đêm ${worstDate ? fmtDateShort(worstDate) : ""} — không gia hạn được.`,
      );
  }
  return { ok: true, warnings: [], addedTotal: breakdown.grandTotal };
}

// ---------- chuyen trang thai ----------

/** Nhan phong: don da xac nhan + da gan phong + phong khong hong. Phong chua don: canh bao. */
export function canCheckIn(data: AvailabilityData, booking: Reservation): RuleResult {
  if (booking.status !== "confirmed")
    return fail(
      booking.status === "pending"
        ? "Đơn đang chờ xác nhận — bấm Duyệt / Xác nhận trước khi nhận phòng."
        : "Chỉ nhận phòng được đơn đã xác nhận.",
    );
  if (booking.roomNumbers.length === 0)
    return fail("Chưa gán phòng cho đơn này — gán phòng trên Lịch phòng rồi nhận phòng.");
  const warnings: string[] = [];
  for (const n of booking.roomNumbers) {
    const room = data.rooms.find((rm) => rm.number === n);
    if (!room) continue;
    for (const d of stayDates(booking.checkIn, booking.checkOut)) {
      const blk = roomBlockOn(data.blocks, n, d, "out_of_order");
      if (blk) return fail(`Phòng ${n} đang hỏng (${blk.reason}) — đổi phòng khác rồi nhận phòng.`);
    }
    if (["dirty", "in_progress"].includes(room.housekeepingStatus))
      warnings.push(`Phòng ${n} chưa dọn xong.`);
  }
  return pass(warnings);
}

/** Tra phong: chi don dang o. Con no: canh bao (khong chan), de le tan quyet. */
export function canCheckOut(booking: Reservation): RuleResult {
  if (booking.status !== "in_house") return fail("Chỉ trả phòng được đơn đang ở.");
  const balance = booking.totalAmount - booking.paidAmount;
  if (balance > 0)
    return pass([`Khách còn nợ ${balance.toLocaleString("vi-VN")}₫ — xác nhận vẫn trả phòng?`]);
  return pass();
}

/** Huy don: chi don cho xac nhan / da xac nhan (ke ca huy hang loat). */
export function canCancel(booking: Reservation): RuleResult {
  if (booking.status === "in_house")
    return fail("Đơn đang ở không huỷ được — làm thủ tục trả phòng trước.");
  if (booking.status === "checked_out") return fail("Đơn đã trả phòng không huỷ được.");
  if (!["pending", "confirmed"].includes(booking.status))
    return fail("Đơn này không huỷ được ở trạng thái hiện tại.");
  return pass();
}

// ---------- gan phong / keo-tha / chan phong ----------

/** Gan phong cho 1 don (tu lich hoac tu form): phong phai hop + trong. */
export function validateAssign(
  data: AvailabilityData,
  booking: Reservation,
  roomNumber: string,
  typeId?: string,
): RuleResult {
  const room = data.rooms.find((rm) => rm.number === roomNumber);
  if (!room) return fail(`Không tìm thấy phòng ${roomNumber}.`);
  return roomFits(data, room, typeId ?? booking.roomTypeId, booking.checkIn, booking.checkOut, booking.id);
}

/**
 * Keo-tha tren lich: don phai keo duoc + ngay moi khong o qua khu +
 * phong dich phai cung loai phong cua don (doi loai thi sua o trang
 * Dat phong de tinh lai gia) + phong trong cac dem moi.
 */
export function validateDrop(
  data: AvailabilityData,
  booking: Reservation,
  targetRoomNumber: string,
  newCheckIn: string,
  newCheckOut: string,
  today: string,
): RuleResult {
  if (["checked_out", "cancelled", "no_show"].includes(booking.status))
    return fail("Không kéo được đơn đã trả phòng / đã huỷ / khách không đến.");
  if (nightsBetween(newCheckIn, newCheckOut) <= 0) return fail("Ngày đi phải sau ngày đến.");
  if (isPastDate(newCheckIn, today)) return fail("Không kéo đơn về ngày quá khứ.");
  const room = data.rooms.find((rm) => rm.number === targetRoomNumber);
  if (!room) return fail(`Không tìm thấy phòng ${targetRoomNumber}.`);
  if (room.roomTypeId !== booking.roomTypeId)
    return fail(
      `Phòng ${targetRoomNumber} khác loại phòng của đơn — đổi loại phòng thì sửa ở trang Đặt phòng (để tính lại giá).`,
    );
  return roomFits(data, room, booking.roomTypeId, newCheckIn, newCheckOut, booking.id);
}

/** Chan phong (hong / tam dong): khong duoc chan phong dang co khach trong khoang chan. */
export function validateBlock(
  reservations: Reservation[],
  roomNumber: string,
  from: string,
  to: string,
  blocks: RoomBlock[] = [],
): RuleResult {
  if (!from || !to || to < from)
    return fail("Ngày chặn chưa đúng (ngày kết thúc phải sau ngày bắt đầu).");
  const clash = reservations.find(
    (r) =>
      isActiveBooking(r) &&
      r.roomNumbers.includes(roomNumber) &&
      r.checkIn <= to &&
      from < r.checkOut,
  );
  if (clash)
    return fail(
      `Phòng ${roomNumber} đang có khách ${clash.guestName} (${fmtDateShort(clash.checkIn)} → ${fmtDateShort(clash.checkOut)}) — chuyển khách đi trước rồi chặn phòng.`,
    );
  // Phong da co lan chan trung ngay thi khong chan them nua
  // (truoc day chi kiem tra khach, khong kiem tra lan chan cu).
  const dup = blocks.find(
    (b) => b.roomNumber === roomNumber && b.from <= to && from <= b.to,
  );
  if (dup)
    return fail(
      `Phòng ${roomNumber} đã bị chặn từ ${fmtDateShort(dup.from)} đến ${fmtDateShort(dup.to)} (${dup.kind === "out_of_order" ? "Phòng hỏng" : "Tạm đóng"}: ${dup.reason}) — xoá lần chặn cũ hoặc chọn ngày khác.`,
    );
  return pass();
}

// ---------- thanh toan (DUNG SAU, khi lam buoc Payment) ----------

/** Thu tien: so tien > 0 va khong qua so con no. */
export function validatePayment(amount: number, balance: number): RuleResult {
  if (!(amount > 0)) return fail("Số tiền thu phải lớn hơn 0.");
  if (amount > balance)
    return fail(`Chỉ còn nợ ${balance.toLocaleString("vi-VN")}₫ — không thu quá số nợ.`);
  return pass();
}
