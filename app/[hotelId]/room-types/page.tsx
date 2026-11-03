"use client";

// ============================================================
// FILE HOTELROOMTYPES2 — app/[hotelId]/room-types/page.tsx
// Trang THONG TIN LOAI PHONG rieng biet (theo yeu cau 2026-10-27):
// khong con thanh tab lon (Thong tin chung / Cau hinh / Loai
// phong & Phong chung 1 trang) nua. Noi dung chinh la bang
// loai phong kieu ezCloud: o tim kiem, loc Trang thai (Tat ca /
// Dang hoat dong / Ngung hoat dong), nut Them moi, cong tac
// trang thai va nut xoa tung dong. Bam ten loai phong thi sang
// trang chi tiet rieng nhu cu.
// Khoi Phong vat ly giu lai ben duoi (can 1 cho de quan ly
// phong that — lich phong cua le tan chay tren cac phong nay).
// Gia ban KHONG nam o day: gia theo tung kenh set o trang
// Ban phong, tab Chinh sach gia — tranh 2 noi cung giu 1 gia.
// Trang nay TU CHUA moi thu, khong dung chung component
// HotelDetailPage nua — dan 1 file nay la chay ngay.
// ============================================================

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { currentHotelId } from "@/lib/current-hotel";
import type { Room, RoomType } from "@/lib/mock-data";

const inputSm =
  "rounded-lg border border-[#dde3ea] bg-white px-3 py-2 text-sm outline-none focus:border-[#2563eb]";
const ACCOUNT_ID = "11111111-1111-1111-1111-111111111111";

const HK_LABELS: Record<Room["housekeepingStatus"], string> = {
  clean: "Sạch",
  dirty: "Chưa dọn",
  in_progress: "Đang dọn",
  out_of_order: "Ngừng bán",
};

export default function HotelRoomTypesPage() {
  const params = useParams();
  const id = typeof params.hotelId === "string" ? params.hotelId : currentHotelId();

  // ----- state: header + operations -----
  const [hotelName, setHotelName] = useState("Đang tải...");
  const [hotelCode, setHotelCode] = useState<string | undefined>(undefined);
  const [hotelStars, setHotelStars] = useState<number | undefined>(undefined);
  const [roomTypes, setRoomTypes] = useState<RoomType[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  // Chi luu loai phong nao dang co goi gia (de chan xoa loai phong).
  const [planTypeIds, setPlanTypeIds] = useState<Set<string>>(new Set());
  const [activeRoomNumbers, setActiveRoomNumbers] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [dbError, setDbError] = useState("");
  const loadedRef = useRef(false);

  // ----- ezCloud-style toolbar state -----
  const [typeSearch, setTypeSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");
  const [showAddType, setShowAddType] = useState(false);

  // ----- room type / room forms -----
  const [typeName, setTypeName] = useState("");
  const [typeCode, setTypeCode] = useState("");
  const [typeAdults, setTypeAdults] = useState(2);
  const [typeChildren, setTypeChildren] = useState(0);
  const [typeBed, setTypeBed] = useState("");
  const [roomNumber, setRoomNumber] = useState("");
  const [roomTypeId, setRoomTypeId] = useState("");

  // ----- LOAD everything of this hotel from Supabase -----
  useEffect(() => {
    (async () => {
      const [hotelRes, typesRes, roomsRes, planTypesRes, resRes] = await Promise.all([
        supabase.from("hotels").select("id, name, code, star_rating").eq("id", id).single(),
        supabase.from("room_types").select("*").eq("hotel_id", id),
        supabase.from("rooms").select("*").eq("hotel_id", id),
        supabase.from("rate_plans").select("room_type_id").eq("hotel_id", id),
        supabase.from("reservations").select("id, status").eq("hotel_id", id)
          .not("status", "in", '("cancelled","checked_out")'),
      ]);
      if (hotelRes.error || !hotelRes.data) {
        setDbError("Không tìm thấy khách sạn này trong cơ sở dữ liệu.");
        setLoading(false);
        return;
      }
      loadedRef.current = true;
      setHotelName(hotelRes.data.name);
      setHotelCode(hotelRes.data.code ?? undefined);
      setHotelStars(hotelRes.data.star_rating ?? undefined);
      const types: RoomType[] = (typesRes.data ?? []).map((t) => {
        const d = (t.details ?? {}) as Record<string, any>;
        return {
          id: t.id, code: t.code ?? undefined, name: t.name,
          maxOccupancy: t.max_occupancy, maxAdults: t.max_adults, maxChildren: t.max_children,
          maxInfants: t.max_infants, sizeM2: t.size_sqm ?? undefined,
          bedConfig: t.bed_config ?? "—", priceFloor: t.min_price ?? undefined, priceCeiling: t.max_price ?? undefined,
          descriptionVi: t.description_vi ?? undefined, descriptionEn: t.description_en ?? undefined,
          views: d.views ?? [], bedOptions: d.bedOptions ?? [], photos: d.photos ?? [], amenities: d.amenities ?? [],
          active: t.active !== false,
        };
      });
      setRoomTypes(types);
      if (types[0]) setRoomTypeId(types[0].id);
      setRooms((roomsRes.data ?? []).map((r) => ({
        number: r.number, roomTypeId: r.room_type_id,
        housekeepingStatus: (r.housekeeping_status ?? "clean") as Room["housekeepingStatus"],
      })));
      setPlanTypeIds(new Set((planTypesRes.data ?? []).map((p) => p.room_type_id)));

      const resRows = resRes.data ?? [];
      if (resRows.length > 0) {
        const { data: rr } = await supabase
          .from("reservation_rooms").select("room_number")
          .in("reservation_id", resRows.map((r) => r.id));
        setActiveRoomNumbers(new Set((rr ?? []).map((x) => x.room_number)));
      }
      setLoading(false);
    })();
  }, [id]);

  // ----- SYNC room types + rooms to the database (debounced) -----
  useEffect(() => {
    if (!loadedRef.current) return;
    const t = setTimeout(async () => {
      const typeRows = roomTypes.map((rt) => ({
        id: rt.id, hotel_id: id, account_id: ACCOUNT_ID, code: rt.code ?? null, name: rt.name,
        max_adults: rt.maxAdults, max_children: rt.maxChildren, max_infants: rt.maxInfants ?? 0,
        max_occupancy: rt.maxOccupancy ?? 2, size_sqm: rt.sizeM2 ?? null, bed_config: rt.bedConfig,
        min_price: rt.priceFloor ?? null, max_price: rt.priceCeiling ?? null,
        description_vi: rt.descriptionVi ?? null, description_en: rt.descriptionEn ?? null,
        active: rt.active !== false,
        details: { views: rt.views ?? [], bedOptions: rt.bedOptions ?? [], photos: rt.photos ?? [], amenities: rt.amenities ?? [] },
      }));
      if (typeRows.length > 0) {
        const { error } = await supabase.from("room_types").upsert(typeRows);
        if (error) { setDbError(error.message); return; }
      }
      const { data: dbTypes } = await supabase.from("room_types").select("id").eq("hotel_id", id);
      const keepT = new Set(roomTypes.map((x) => x.id));
      for (const d of dbTypes ?? []) {
        if (!keepT.has(d.id)) {
          const { error } = await supabase.from("room_types").delete().eq("id", d.id);
          if (error) { setDbError("Không xoá được loại phòng trong kho: " + error.message); return; }
        }
      }
      const roomRows = rooms.map((r) => ({
        id: `${id}-${r.number}`, hotel_id: id, account_id: ACCOUNT_ID,
        room_type_id: r.roomTypeId, number: r.number, floor: Number(r.number.charAt(0)) || 1,
        housekeeping_status: r.housekeepingStatus,
      }));
      if (roomRows.length > 0) {
        const { error } = await supabase.from("rooms").upsert(roomRows);
        if (error) { setDbError(error.message); return; }
      }
      const { data: dbRooms } = await supabase.from("rooms").select("id").eq("hotel_id", id);
      const keepR = new Set(roomRows.map((x) => x.id));
      for (const d of dbRooms ?? []) {
        if (!keepR.has(d.id)) await supabase.from("rooms").delete().eq("id", d.id);
      }
    }, 600);
    return () => clearTimeout(t);
  }, [roomTypes, rooms, id]);

  function addRoomType() {
    if (!typeName.trim()) return alert("Chưa nhập tên loại phòng.");
    const newId = typeName.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-");
    if (roomTypes.some((t) => t.id === newId)) return alert("Loại phòng này đã tồn tại ở khách sạn này.");
    setRoomTypes((p) => [
      ...p,
      {
        id: newId,
        code: typeCode.trim().toUpperCase() || undefined,
        name: typeName.trim(),
        maxOccupancy: typeAdults + typeChildren,
        maxAdults: typeAdults,
        maxChildren: typeChildren,
        bedConfig: typeBed || "—",
        active: true,
      },
    ]);
    setTypeName(""); setTypeCode(""); setTypeBed(""); setShowAddType(false);
  }

  function deleteRoomType(typeId: string) {
    if (rooms.some((r) => r.roomTypeId === typeId)) return alert("Không xoá được: khách sạn này vẫn còn phòng thuộc loại đó.");
    if (planTypeIds.has(typeId)) return alert("Không xoá được: vẫn còn gói giá thuộc loại này.");
    setRoomTypes((p) => p.filter((t) => t.id !== typeId));
  }

  function addRoom() {
    if (!roomNumber.trim()) return alert("Chưa nhập số phòng.");
    if (rooms.some((r) => r.number === roomNumber.trim())) return alert("Số phòng này đã có ở khách sạn này.");
    if (!roomTypeId) return alert("Tạo loại phòng trước, rồi mới thêm phòng.");
    setRooms((p) => [...p, { number: roomNumber.trim(), roomTypeId, housekeepingStatus: "clean" }]);
    setRoomNumber("");
  }

  function deleteRoom(number: string) {
    if (activeRoomNumbers.has(number))
      return alert(`Không xoá được: phòng ${number} đang có đơn đang hiệu lực.`);
    setRooms((p) => p.filter((r) => r.number !== number));
  }

  // ----- ezCloud-style filtering for the types table -----
  const shownTypes = roomTypes.filter((t) => {
    const q = typeSearch.trim().toLowerCase();
    if (q && !(t.name.toLowerCase().includes(q) || (t.code ?? "").toLowerCase().includes(q))) return false;
    if (statusFilter === "active" && !(t.active ?? true)) return false;
    if (statusFilter === "inactive" && (t.active ?? true)) return false;
    return true;
  });

  return (
    <div>
      <Link href="/" className="text-sm font-medium text-[#2563eb] hover:underline">
        ← Tất cả khách sạn
      </Link>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold text-[#17293e]">{hotelName}</h1>
        {hotelCode && (
          <span className="rounded-md bg-[#f0f3f7] px-2 py-0.5 text-xs font-semibold text-[#68707a]">{hotelCode}</span>
        )}
        {hotelStars && <span className="text-amber-500">{"★".repeat(hotelStars)}</span>}
      </div>
      <p className="mt-1 text-sm text-[#68707a]">
        Trang quản lí riêng của khách sạn này — không ảnh hưởng khách sạn khác.
      </p>
      {loading && <p className="mt-3 text-sm text-[#68707a]">Đang tải dữ liệu từ Supabase...</p>}
      {dbError && <p className="mt-3 rounded-lg bg-[#fdecec] px-3 py-2 text-sm text-[#e5484d]">Lỗi cơ sở dữ liệu: {dbError}</p>}

      {/* ===== LOAI PHONG (bang kieu ezCloud) ===== */}
      <div className="cb-card mt-5 p-5">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-base font-bold text-[#17293e]">Loại phòng</h2>
          <button onClick={() => setShowAddType((v) => !v)} className="cb-btn-primary ml-auto px-4 py-2 text-sm">
            + Thêm mới phòng
          </button>
        </div>
        <p className="mt-0.5 text-sm text-[#68707a]">Mỗi loại phòng có mã ngắn để khớp nối với các kênh bán. Tắt công tắc = ngừng bán mà không xoá dữ liệu.</p>

        {/* toolbar: tim kiem + loc trang thai */}
        <div className="mt-4 flex flex-wrap items-center gap-4">
          <input
            className={`${inputSm} min-w-64 flex-1`}
            placeholder="Nhập mã / tên phòng"
            value={typeSearch}
            onChange={(e) => setTypeSearch(e.target.value)}
          />
          <div className="flex items-center gap-4 text-sm text-[#17293e]">
            <label className="flex items-center gap-1.5">
              <input type="radio" name="typeStatus" checked={statusFilter === "all"} onChange={() => setStatusFilter("all")} className="h-4 w-4 accent-[#2563eb]" />
              Tất cả
            </label>
            <label className="flex items-center gap-1.5">
              <input type="radio" name="typeStatus" checked={statusFilter === "active"} onChange={() => setStatusFilter("active")} className="h-4 w-4 accent-[#2563eb]" />
              Đang hoạt động
            </label>
            <label className="flex items-center gap-1.5">
              <input type="radio" name="typeStatus" checked={statusFilter === "inactive"} onChange={() => setStatusFilter("inactive")} className="h-4 w-4 accent-[#2563eb]" />
              Ngừng hoạt động
            </label>
          </div>
        </div>

        {/* add form (an/hien bang nut tren) */}
        {showAddType && (
          <div className="mt-4 flex flex-wrap items-end gap-2 border-t border-[#eef1f5] pt-4">
            <input className={inputSm} placeholder="Tên loại phòng mới" value={typeName} onChange={(e) => setTypeName(e.target.value)} />
            <input className={`${inputSm} w-24`} placeholder="Mã, VD: DLX" value={typeCode} onChange={(e) => setTypeCode(e.target.value)} />
            <label className="text-xs text-[#68707a]">Người lớn<input type="number" min={1} className={`${inputSm} mt-0.5 w-20`} value={typeAdults} onChange={(e) => setTypeAdults(Number(e.target.value))} /></label>
            <label className="text-xs text-[#68707a]">Trẻ em<input type="number" min={0} className={`${inputSm} mt-0.5 w-20`} value={typeChildren} onChange={(e) => setTypeChildren(Number(e.target.value))} /></label>
            <input className={inputSm} placeholder="Kiểu giường" value={typeBed} onChange={(e) => setTypeBed(e.target.value)} />
            <button className="cb-btn-primary px-4 py-2 text-sm" onClick={addRoomType}>+ Thêm loại phòng</button>
          </div>
        )}

        <table className="mt-4 w-full text-sm">
          <thead>
            <tr className="border-b border-[#eef1f5] text-left text-xs uppercase tracking-wide text-[#68707a]">
              <th className="py-2 pr-3 font-semibold">STT</th>
              <th className="py-2 pr-3 font-semibold">Mã phòng</th>
              <th className="py-2 pr-3 font-semibold">Tên phòng</th>
              <th className="py-2 pr-3 font-semibold">Sức chứa</th>
              <th className="py-2 pr-3 font-semibold">Giường</th>
              <th className="py-2 pr-3 font-semibold">Tổng số phòng</th>
              <th className="py-2 pr-3 font-semibold">Trạng thái</th>
              <th className="py-2 text-right font-semibold">Thao tác</th>
            </tr>
          </thead>
          <tbody>
            {shownTypes.map((t, i) => (
              <tr key={t.id} className="border-b border-[#eef1f5]">
                <td className="py-2.5 pr-3 text-[#68707a]">{i + 1}</td>
                <td className="py-2.5 pr-3">
                  <span className="rounded-md bg-[#f0f3f7] px-2 py-0.5 text-xs font-semibold text-[#68707a]">{t.code ?? "—"}</span>
                </td>
                <td className="py-2.5 pr-3 font-medium">
                  <Link href={`/hotels/${id}/room-types/${t.id}`} className="text-[#2563eb] hover:underline" title="Mở trang quản lí loại phòng này">
                    {t.name}
                  </Link>
                </td>
                <td className="py-2.5 pr-3">
                  {t.maxAdults !== undefined ? `${t.maxAdults} người lớn, ${t.maxChildren ?? 0} trẻ em` : `${t.maxOccupancy} khách`}
                </td>
                <td className="py-2.5 pr-3">{t.bedConfig}</td>
                <td className="py-2.5 pr-3">{rooms.filter((r) => r.roomTypeId === t.id).length}</td>
                <td className="py-2.5 pr-3">
                  <button
                    onClick={() => setRoomTypes((p) => p.map((x) => (x.id === t.id ? { ...x, active: !(x.active ?? true) } : x)))}
                    className={`relative h-5 w-9 rounded-full transition ${t.active ?? true ? "bg-[#2563eb]" : "bg-gray-300"}`}
                    title="Đang bán / ngừng bán"
                  >
                    <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${t.active ?? true ? "left-[18px]" : "left-0.5"}`} />
                  </button>
                </td>
                <td className="py-2.5 text-right">
                  <button onClick={() => deleteRoomType(t.id)} className="font-medium text-[#e5484d] hover:underline">Xoá</button>
                </td>
              </tr>
            ))}
            {shownTypes.length === 0 && (
              <tr><td colSpan={8} className="py-6 text-center text-[#68707a]">{roomTypes.length === 0 ? "Chưa có loại phòng nào — bấm \"+ Thêm mới phòng\" để tạo." : "Không tìm thấy loại phòng nào khớp."}</td></tr>
            )}
          </tbody>
        </table>
        <p className="mt-3 text-xs text-[#68707a]">
          Giá bán không nằm ở đây: giá theo từng kênh set ở trang Bán phòng, tab Chính sách giá — để khỏi có 2 nơi cùng giữ 1 giá.
        </p>
      </div>

      {/* ===== PHONG VAT LY ===== */}
      <div className="cb-card mt-5 p-5">
        <h2 className="text-base font-bold text-[#17293e]">Phòng vật lý của khách sạn này</h2>
        <p className="mt-0.5 text-sm text-[#68707a]">Từng số phòng cụ thể — đây là các hàng trong Lịch phòng của lễ tân.</p>
        <table className="mt-4 w-full text-sm">
          <thead>
            <tr className="border-b border-[#eef1f5] text-left text-xs uppercase tracking-wide text-[#68707a]">
              <th className="py-2 pr-3 font-semibold">Số phòng</th>
              <th className="py-2 pr-3 font-semibold">Loại phòng</th>
              <th className="py-2 pr-3 font-semibold">Trạng thái dọn phòng</th>
              <th className="py-2 text-right font-semibold"></th>
            </tr>
          </thead>
          <tbody>
            {rooms.map((r) => (
              <tr key={r.number} className="border-b border-[#eef1f5]">
                <td className="py-2.5 pr-3 font-bold text-[#17293e]">{r.number}</td>
                <td className="py-2.5 pr-3">{roomTypes.find((t) => t.id === r.roomTypeId)?.name ?? "—"}</td>
                <td className="py-2.5 pr-3">
                  <select
                    className="rounded-lg border border-[#dde3ea] px-2 py-1 text-[13px] outline-none focus:border-[#2563eb]"
                    value={r.housekeepingStatus}
                    onChange={(e) =>
                      setRooms((p) =>
                        p.map((x) => (x.number === r.number ? { ...x, housekeepingStatus: e.target.value as Room["housekeepingStatus"] } : x))
                      )
                    }
                  >
                    {(Object.keys(HK_LABELS) as Room["housekeepingStatus"][]).map((s) => (
                      <option key={s} value={s}>{HK_LABELS[s]}</option>
                    ))}
                  </select>
                </td>
                <td className="py-2.5 text-right">
                  <button onClick={() => deleteRoom(r.number)} className="font-medium text-[#e5484d] hover:underline">Xoá</button>
                </td>
              </tr>
            ))}
            {rooms.length === 0 && (
              <tr><td colSpan={4} className="py-6 text-center text-[#68707a]">Chưa có phòng nào.</td></tr>
            )}
          </tbody>
        </table>
        <div className="mt-4 flex flex-wrap gap-2">
          <input className={`${inputSm} w-36`} placeholder="Số phòng, VD: 105" value={roomNumber} onChange={(e) => setRoomNumber(e.target.value)} />
          <select className={inputSm} value={roomTypeId} onChange={(e) => setRoomTypeId(e.target.value)}>
            {roomTypes.map((t) => (<option key={t.id} value={t.id}>{t.name}</option>))}
          </select>
          <button className="cb-btn-primary px-4 py-2 text-sm" onClick={addRoom}>+ Thêm phòng</button>
        </div>
      </div>
    </div>
  );
}
