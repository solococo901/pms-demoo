"use client";
// ============================================================
// app/[hotelId]/inventory/page.tsx — trang Chặn phòng & Đóng bán (tên cũ: Tồn phòng)
// (gom 2 loai chan ton dang nam rai rac: chan phong o Lich phong,
// dong ban o Lich gia). Khong co muc Ke thua o day.
//   1. Chan phong (room_blocks): theo phong vat ly.
//      - out_of_order (Phong hong): TRU khoi so phong ban duoc, day
//        sang Channex.
//      - out_of_service (Tam dong): chi chan xep phong trong PMS,
//        KHONG tru khoi ton.
//   2. Dong ban (inventory_blocks): tren lich gia, cap kenh hoac
//      cap loai phong — cap nay thang muc ngung ban tung goi gia.
// ============================================================

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { CHANNELS, getChannelName, type InventoryBlock, type Reservation, type Room, type RoomBlock, type RoomType } from "@/lib/mock-data";
import { validateBlock } from "@/lib/booking-rules";
import { supabase } from "@/lib/supabase";
import { currentHotelId } from "@/lib/current-hotel";
import { queueChannexDates, rangeDates } from "@/lib/channex-outbox";
import { DateRangePicker } from "@/components/DatePicker";

const ACCOUNT_ID = "11111111-1111-1111-1111-111111111111";
const fmtDate = (s: string) => {
  const [y, m, d] = s.split("-");
  return `${d}/${m}/${y}`;
};
const inputSm =
  "rounded-lg border border-[var(--cb-border)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--cb-blue)]";

export default function InventoryPage() {
  const params = useParams();
  const HOTEL_ID = typeof params.hotelId === "string" ? params.hotelId : currentHotelId();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [roomTypes, setRoomTypes] = useState<RoomType[]>([]);
  const [roomBlocks, setRoomBlocks] = useState<RoomBlock[]>([]);
  const [invBlocks, setInvBlocks] = useState<InventoryBlock[]>([]);
  // Don dang hoat dong — chi de kiem tra phong co khach truoc khi chan.
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  // Form chan phong.
  const [rbRoom, setRbRoom] = useState("");
  const [rbFrom, setRbFrom] = useState("");
  const [rbTo, setRbTo] = useState("");
  const [rbKind, setRbKind] = useState<RoomBlock["kind"]>("out_of_order");
  const [rbReason, setRbReason] = useState("");
  // Form dong ban.
  const [ibScope, setIbScope] = useState<"channel" | "room_type">("channel");
  const [ibChannel, setIbChannel] = useState(CHANNELS.filter((c) => c.type === "ota")[0]?.code ?? "");
  const [ibType, setIbType] = useState("");
  const [ibFrom, setIbFrom] = useState("");
  const [ibTo, setIbTo] = useState("");
  const [ibReason, setIbReason] = useState("");

  useEffect(() => {
    (async () => {
      const [roomsRes, typesRes, rbRes, ibRes, resRes, rrRes] = await Promise.all([
        supabase.from("rooms").select("*").eq("hotel_id", HOTEL_ID).order("number"),
        supabase.from("room_types").select("*").eq("hotel_id", HOTEL_ID),
        supabase.from("room_blocks").select("*").eq("hotel_id", HOTEL_ID).order("from_date"),
        supabase.from("inventory_blocks").select("*").eq("hotel_id", HOTEL_ID).order("from_date"),
        supabase.from("reservations").select("*").eq("hotel_id", HOTEL_ID),
        supabase.from("reservation_rooms").select("reservation_id, room_number"),
      ]);
      if (roomsRes.error || typesRes.error || rbRes.error || ibRes.error || resRes.error || rrRes.error) {
        setLoadError((roomsRes.error ?? typesRes.error ?? rbRes.error ?? ibRes.error ?? resRes.error ?? rrRes.error)?.message ?? "Không đọc được dữ liệu");
        setLoading(false);
        return;
      }
      const loadedRooms: Room[] = (roomsRes.data ?? []).map((r) => ({
        number: r.number, roomTypeId: r.room_type_id,
        housekeepingStatus: (r.housekeeping_status ?? "clean") as Room["housekeepingStatus"],
      }));
      setRooms(loadedRooms);
      if (loadedRooms[0]) setRbRoom(loadedRooms[0].number);
      const types: RoomType[] = (typesRes.data ?? []).map((t) => ({
        id: t.id, code: t.code ?? undefined, name: t.name,
        maxOccupancy: t.max_occupancy, maxAdults: t.max_adults,
        maxChildren: t.max_children, maxInfants: t.max_infants,
        bedConfig: t.bed_config ?? "", sizeM2: t.size_sqm ?? undefined,
        priceFloor: t.min_price ?? undefined, priceCeiling: t.max_price ?? undefined,
        descriptionVi: t.description_vi ?? undefined,
        descriptionEn: t.description_en ?? undefined, active: t.active,
      }));
      setRoomTypes(types);
      if (types[0]) setIbType(types[0].id);
      setRoomBlocks((rbRes.data ?? []).map((b) => ({
        id: b.id, roomNumber: b.room_number, from: b.from_date, to: b.to_date,
        kind: b.kind as RoomBlock["kind"], reason: b.reason ?? undefined,
      })));
      setInvBlocks((ibRes.data ?? []).map((b) => ({
        id: b.id, scope: b.scope as InventoryBlock["scope"],
        channelCode: b.channel_code ?? undefined, roomTypeId: b.room_type_id,
        from: b.from_date, to: b.to_date, reason: b.reason ?? undefined,
      })));
      const roomsMap = new Map<string, string[]>();
      for (const row of rrRes.data ?? []) {
        const list = roomsMap.get(row.reservation_id) ?? [];
        list.push(row.room_number);
        roomsMap.set(row.reservation_id, list);
      }
      setReservations((resRes.data ?? []).map((r) => ({
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
      })));
      // Ngay mac dinh = hom nay theo gio dia phuong (tinh o client, sau
      // khi mount, de khong lech ngay khi render phia may chu).
      const d = new Date();
      const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      setRbFrom(today); setRbTo(today); setIbFrom(today); setIbTo(today);
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function addRoomBlock() {
    if (!rbRoom || !rbFrom || !rbTo) return alert("Chọn phòng và khoảng ngày.");
    if (rbTo < rbFrom) return alert("Ngày đến phải từ ngày đi trở đi.");
    // Khong chan duoc phong dang co khach o trong khoang nay.
    const check = validateBlock(reservations, rbRoom, rbFrom, rbTo);
    if (!check.ok) return alert(check.error);
    const nb: RoomBlock = {
      id: `blk-${Date.now()}`,
      roomNumber: rbRoom,
      from: rbFrom,
      to: rbTo,
      kind: rbKind,
      reason: rbReason || (rbKind === "out_of_order" ? "Phòng hỏng" : "Tạm đóng"),
    };
    const { error } = await supabase.from("room_blocks").insert({
      id: nb.id, hotel_id: HOTEL_ID, account_id: ACCOUNT_ID,
      room_number: nb.roomNumber, from_date: nb.from, to_date: nb.to, kind: nb.kind, reason: nb.reason,
    });
    if (error) return alert("Lưu chặn phòng không thành công: " + error.message);
    setRoomBlocks((prev) => [...prev, nb]);
    if (nb.kind === "out_of_order") queueChannexDates(rangeDates(nb.from, nb.to));
    setRbReason("");
  }

  async function removeRoomBlock(id: string) {
    const blk = roomBlocks.find((b) => b.id === id);
    const { error } = await supabase.from("room_blocks").delete().eq("id", id);
    if (error) return alert("Xoá chặn phòng không thành công: " + error.message);
    setRoomBlocks((prev) => prev.filter((b) => b.id !== id));
    if (blk?.kind === "out_of_order") queueChannexDates(rangeDates(blk.from, blk.to));
  }

  async function addInvBlock() {
    if (!ibType || !ibFrom || !ibTo) return alert("Chọn loại phòng và khoảng ngày.");
    if (ibTo < ibFrom) return alert("Ngày đến phải từ ngày đi trở đi.");
    const nb: InventoryBlock = {
      id: `ib-${Date.now()}`,
      scope: ibScope,
      channelCode: ibScope === "channel" ? ibChannel : undefined,
      roomTypeId: ibType,
      from: ibFrom,
      to: ibTo,
      reason: ibReason || undefined,
    };
    const { error } = await supabase.from("inventory_blocks").insert({
      id: nb.id, hotel_id: HOTEL_ID, account_id: ACCOUNT_ID,
      scope: nb.scope, channel_code: nb.channelCode ?? null, room_type_id: nb.roomTypeId,
      from_date: nb.from, to_date: nb.to, reason: nb.reason ?? null,
    });
    if (error) return alert("Lưu đóng bán không thành công: " + error.message);
    setInvBlocks((prev) => [...prev, nb]);
    queueChannexDates(rangeDates(nb.from, nb.to));
    setIbReason("");
  }

  async function removeInvBlock(id: string) {
    const blk = invBlocks.find((b) => b.id === id);
    const { error } = await supabase.from("inventory_blocks").delete().eq("id", id);
    if (error) return alert("Xoá đóng bán không thành công: " + error.message);
    setInvBlocks((prev) => prev.filter((b) => b.id !== id));
    if (blk) queueChannexDates(rangeDates(blk.from, blk.to));
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-[var(--cb-text)]">Chặn phòng & Đóng bán</h1>
      <p className="mt-1 text-sm text-[var(--cb-muted)]">
        Chặn phòng và đóng bán của khách sạn này. Chặn phòng cũng tạo được từ Lịch phòng, đóng bán cũng sửa được từ trang Lịch giá (nút Đóng bán). Muốn xem số phòng trống theo ngày thì sang trang Lịch giá, tab Tồn phòng.
      </p>

      {loading && <p className="mt-4 text-sm text-[var(--cb-muted)]">Đang tải dữ liệu từ Supabase...</p>}
      {loadError && <p className="mt-4 text-sm text-[#e5484d]">Không đọc được dữ liệu từ Supabase: {loadError}</p>}

      {/* ---------- 1. Chan phong theo phong vat ly ---------- */}
      <div className="cb-card mt-5 p-5">
        <h2 className="text-base font-bold text-[var(--cb-text)]">Chặn phòng</h2>
        <p className="mt-0.5 text-sm text-[var(--cb-muted)]">
          Chặn từng phòng vật lý. Phòng hỏng trừ khỏi số phòng bán được và đẩy sang Channex; tạm đóng chỉ chặn xếp phòng trong PMS, không trừ tồn.
        </p>
        <table className="mt-3 w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--cb-bg)] text-left text-xs uppercase tracking-wide text-[var(--cb-muted)]">
              <th className="py-2 pr-3 font-semibold">Phòng</th>
              <th className="py-2 pr-3 font-semibold">Từ đêm</th>
              <th className="py-2 pr-3 font-semibold">Đến đêm</th>
              <th className="py-2 pr-3 font-semibold">Loại</th>
              <th className="py-2 pr-3 font-semibold">Lý do</th>
              <th className="py-2 text-right font-semibold"></th>
            </tr>
          </thead>
          <tbody>
            {roomBlocks.map((b) => (
              <tr key={b.id} className="border-b border-[var(--cb-bg)]">
                <td className="py-2.5 pr-3 font-medium text-[var(--cb-text)]">{b.roomNumber}</td>
                <td className="py-2.5 pr-3">{fmtDate(b.from)}</td>
                <td className="py-2.5 pr-3">{fmtDate(b.to)}</td>
                <td className="py-2.5 pr-3">{b.kind === "out_of_order" ? "Phòng hỏng" : "Tạm đóng"}</td>
                <td className="py-2.5 pr-3">{b.reason ?? "—"}</td>
                <td className="py-2.5 text-right">
                  <button onClick={() => removeRoomBlock(b.id)} className="font-medium text-[#e5484d] hover:underline">Xoá</button>
                </td>
              </tr>
            ))}
            {roomBlocks.length === 0 && (
              <tr><td colSpan={6} className="py-6 text-center text-[var(--cb-muted)]">Chưa có phòng nào bị chặn.</td></tr>
            )}
          </tbody>
        </table>
        <div className="mt-4 flex flex-wrap items-end gap-2">
          <select className={inputSm} value={rbRoom} onChange={(e) => setRbRoom(e.target.value)}>
            {rooms.map((r) => (<option key={r.number} value={r.number}>{r.number}</option>))}
          </select>
          <div>
            <span className="text-xs text-[var(--cb-muted)]">Từ đêm → đến đêm</span>
            <div className="mt-0.5"><DateRangePicker from={rbFrom} to={rbTo} onChange={(f, t) => { setRbFrom(f); setRbTo(t); }} /></div>
          </div>
          <select className={inputSm} value={rbKind} onChange={(e) => setRbKind(e.target.value as RoomBlock["kind"])}>
            <option value="out_of_order">Phòng hỏng</option>
            <option value="out_of_service">Tạm đóng</option>
          </select>
          <input className={inputSm} placeholder="Lý do" value={rbReason} onChange={(e) => setRbReason(e.target.value)} />
          <button className="cb-btn-primary px-4 py-2 text-sm" onClick={addRoomBlock}>+ Chặn phòng</button>
        </div>
      </div>

      {/* ---------- 2. Dong ban cap kenh / cap loai phong ---------- */}
      <div className="cb-card mt-5 p-5">
        <h2 className="text-base font-bold text-[var(--cb-text)]">Đóng bán</h2>
        <p className="mt-0.5 text-sm text-[var(--cb-muted)]">
          Đóng bán trên lịch giá. Theo kênh: chỉ kênh đó không bán được loại phòng này. Theo loại phòng: không kênh nào bán được. Mức đóng này thắng mức ngừng bán từng gói giá.
        </p>
        <table className="mt-3 w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--cb-bg)] text-left text-xs uppercase tracking-wide text-[var(--cb-muted)]">
              <th className="py-2 pr-3 font-semibold">Phạm vi</th>
              <th className="py-2 pr-3 font-semibold">Loại phòng</th>
              <th className="py-2 pr-3 font-semibold">Từ ngày</th>
              <th className="py-2 pr-3 font-semibold">Đến ngày</th>
              <th className="py-2 pr-3 font-semibold">Lý do</th>
              <th className="py-2 text-right font-semibold"></th>
            </tr>
          </thead>
          <tbody>
            {invBlocks.map((b) => (
              <tr key={b.id} className="border-b border-[var(--cb-bg)]">
                <td className="py-2.5 pr-3">{b.scope === "channel" ? getChannelName(b.channelCode ?? "") : "Tất cả kênh"}</td>
                <td className="py-2.5 pr-3 font-medium text-[var(--cb-text)]">{roomTypes.find((t) => t.id === b.roomTypeId)?.name ?? b.roomTypeId}</td>
                <td className="py-2.5 pr-3">{fmtDate(b.from)}</td>
                <td className="py-2.5 pr-3">{fmtDate(b.to)}</td>
                <td className="py-2.5 pr-3">{b.reason ?? "—"}</td>
                <td className="py-2.5 text-right">
                  {b.reason === "Tắt bán trên kênh" ? (
                    <span className="text-xs text-[var(--cb-muted)]" title="Tắt bằng công tắc ở trang Kênh bán — bật lại công tắc ở đó để mở bán">Quản lý ở Kênh bán</span>
                  ) : (
                    <button onClick={() => removeInvBlock(b.id)} className="font-medium text-[#e5484d] hover:underline">Xoá</button>
                  )}
                </td>
              </tr>
            ))}
            {invBlocks.length === 0 && (
              <tr><td colSpan={6} className="py-6 text-center text-[var(--cb-muted)]">Chưa có khoảng đóng bán nào.</td></tr>
            )}
          </tbody>
        </table>
        <p className="mt-3 text-xs text-[var(--cb-muted)]">
          Các dòng “Tắt bán trên kênh” do công tắc ở trang Kênh bán tạo ra — muốn mở bán lại thì bật công tắc ở đó, không xoá ở đây.
        </p>
        <div className="mt-4 flex flex-wrap items-end gap-2">
          <select className={inputSm} value={ibScope} onChange={(e) => setIbScope(e.target.value as "channel" | "room_type")}>
            <option value="channel">Theo kênh</option>
            <option value="room_type">Theo loại phòng</option>
          </select>
          {ibScope === "channel" && (
            <select className={inputSm} value={ibChannel} onChange={(e) => setIbChannel(e.target.value)}>
              {CHANNELS.filter((c) => c.type === "ota").map((c) => (<option key={c.code} value={c.code}>{c.name}</option>))}
            </select>
          )}
          <select className={inputSm} value={ibType} onChange={(e) => setIbType(e.target.value)}>
            {roomTypes.map((t) => (<option key={t.id} value={t.id}>{t.name}</option>))}
          </select>
          <div>
            <span className="text-xs text-[var(--cb-muted)]">Từ ngày → đến ngày</span>
            <div className="mt-0.5"><DateRangePicker from={ibFrom} to={ibTo} onChange={(f, t) => { setIbFrom(f); setIbTo(t); }} /></div>
          </div>
          <input className={inputSm} placeholder="Lý do" value={ibReason} onChange={(e) => setIbReason(e.target.value)} />
          <button className="cb-btn-primary px-4 py-2 text-sm" onClick={addInvBlock}>+ Đóng bán</button>
        </div>
      </div>
    </div>
  );
}
