"use client";

// NATEUI9 — app/[hotelId]/room-types/page.tsx (Loai phong)
// 1 man hinh: moi loai phong la 1 dong mo rong duoc, phong vat ly nam trong dong do; doi sang token toi gian 2026-11-21.
// Gia ban KHONG nam o day — nhap o Lich gia.

import { Fragment, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { currentHotelId } from "@/lib/current-hotel";
import type { Room, RoomType } from "@/lib/mock-data";
import { useToast } from "@/components/Toast";

const inputSm =
  "rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-primary";
const ACCOUNT_ID = "11111111-1111-1111-1111-111111111111";

const HK_LABELS: Record<Room["housekeepingStatus"], string> = {
  clean: "Sạch",
  dirty: "Chưa dọn",
  in_progress: "Đang dọn",
  out_of_order: "Ngừng bán",
};

// Ma loai phong tu ten tieng Viet: bo dau, noi bang gach ngang ("Phòng Đôi" -> "phong-doi").
function slugifyTypeName(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "loai-phong";
}

// Ma ngan tu dong: chu cai dau moi tu cua slug ("phong-doi" -> "PD"); chi dung khi de trong o Ma.
function autoCodeFromName(name: string): string {
  const slug = slugifyTypeName(name);
  const code = slug
    .split("-")
    .filter(Boolean)
    .map((w) => w.charAt(0))
    .join("")
    .toUpperCase()
    .slice(0, 4);
  return code || "PHG";
}

// Sap xep so phong: so truoc (101 < 102 < 201), chu sau.
function sortRoomNumbers(a: string, b: string): number {
  const na = Number(a);
  const nb = Number(b);
  if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
  return a.localeCompare(b);
}

// Doc o them nhieu phong: danh sach cach dau phay + khoang so ("101, 102, 105-110").
function parseRoomSpec(text: string): { numbers: string[]; invalid: string[] } {
  const numbers: string[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();
  for (const raw of text.split(/[,;\s]+/)) {
    const tok = raw.trim();
    if (!tok) continue;
    const range = tok.match(/^(\d+)-(\d+)$/);
    if (range) {
      const a = parseInt(range[1], 10);
      const b = parseInt(range[2], 10);
      if (b < a || b - a > 500) {
        invalid.push(tok);
        continue;
      }
      for (let n = a; n <= b; n++) {
        const s = String(n);
        if (!seen.has(s)) {
          seen.add(s);
          numbers.push(s);
        }
      }
    } else if (/^[A-Za-z0-9]+$/.test(tok)) {
      if (!seen.has(tok)) {
        seen.add(tok);
        numbers.push(tok);
      }
    } else {
      invalid.push(tok);
    }
  }
  return { numbers, invalid };
}

// Danh so tu dong: tu so bat dau, tao N phong lien tiep; so 0 o dau thi giu do dai ("001".."010").
function autoNumbers(start: string, count: number): { numbers: string[]; invalid: string[] } {
  const s = start.trim();
  if (!/^\d+$/.test(s) || !Number.isFinite(count) || count < 1 || count > 500) {
    return { numbers: [], invalid: s || count < 1 ? [s || "số lượng"] : [] };
  }
  const width = s.startsWith("0") ? s.length : 0;
  const first = parseInt(s, 10);
  const numbers: string[] = [];
  for (let i = 0; i < count; i++) {
    const n = String(first + i);
    numbers.push(width > 0 ? n.padStart(width, "0") : n);
  }
  return { numbers, invalid: [] };
}

// Panel phong vat ly nam trong dong loai phong — dat o cap module
// de React khong tao lai component moi lan ve lai (khong thi o nhap mat chu khi go).
function TypeRoomsPanel(props: {
  hotelId: string;
  typeId: string;
  rooms: Room[]; // phong cua loai nay (da loc + da sap xep)
  totalRooms: number; // tong phong cua loai nay (chua loc)
  allRoomNumbers: Set<string>;
  roomTypes: RoomType[];
  activeRoomNumbers: Set<string>;
  onAddRooms: (typeId: string, numbers: string[]) => void;
  onDeleteRoom: (number: string) => void;
  onSetHK: (number: string, status: Room["housekeepingStatus"]) => void;
  onMoveRoom: (number: string, newTypeId: string) => void;
}) {
  const [mode, setMode] = useState<"list" | "auto">("list");
  const [listText, setListText] = useState("");
  const [autoStart, setAutoStart] = useState("");
  const [autoCount, setAutoCount] = useState(10);

  const parsed = mode === "list" ? parseRoomSpec(listText) : autoNumbers(autoStart, autoCount);
  const fresh = parsed.numbers.filter((n) => !props.allRoomNumbers.has(n));
  const dups = parsed.numbers.filter((n) => props.allRoomNumbers.has(n));
  const preview = fresh.slice(0, 8).join(", ") + (fresh.length > 8 ? ` … và ${fresh.length - 8} phòng nữa` : "");

  function addRooms() {
    if (fresh.length === 0) return;
    props.onAddRooms(props.typeId, fresh);
    setListText("");
    setAutoStart("");
  }

  return (
    <div className="rounded-lg bg-[var(--nui-bg)] px-4 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm font-semibold text-ink">
          Phòng của loại này ({props.totalRooms} phòng)
        </span>
        <Link
          href={`/hotels/${props.hotelId}/room-types/${props.typeId}`}
          className="text-[13px] font-medium text-primary hover:underline"
        >
          Sửa chi tiết loại phòng →
        </Link>
      </div>

      {/* danh sach phong cua loai nay */}
      {props.rooms.length === 0 ? (
        <p className="mt-2 text-[13px] text-muted">
          {props.totalRooms === 0
            ? "Chưa có phòng nào — thêm phòng ở ô dưới."
            : "Không có phòng nào khớp với bộ lọc."}
        </p>
      ) : (
        <div className="mt-2">
          {props.rooms.map((r) => (
            <div key={r.number} className="flex flex-wrap items-center gap-2 border-b border-line py-1.5 last:border-b-0">
              <span className="w-16 font-bold text-ink">{r.number}</span>
              <select
                className="rounded-lg border border-line bg-surface px-2 py-1 text-[13px] outline-none focus:border-primary"
                value={r.housekeepingStatus}
                onChange={(e) => props.onSetHK(r.number, e.target.value as Room["housekeepingStatus"])}
                title="Trạng thái dọn phòng"
              >
                {(Object.keys(HK_LABELS) as Room["housekeepingStatus"][]).map((s) => (
                  <option key={s} value={s}>{HK_LABELS[s]}</option>
                ))}
              </select>
              <select
                className="max-w-56 rounded-lg border border-line bg-surface px-2 py-1 text-[13px] outline-none focus:border-primary"
                value={r.roomTypeId}
                onChange={(e) => props.onMoveRoom(r.number, e.target.value)}
                title="Chuyển phòng sang loại khác"
              >
                {props.roomTypes.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
              <button
                onClick={() => props.onDeleteRoom(r.number)}
                className="ml-auto text-[13px] font-medium text-danger hover:underline"
                title={props.activeRoomNumbers.has(r.number) ? "Phòng đang có đơn đang hiệu lực — không xoá được" : "Xoá phòng này"}
              >
                Xoá
              </button>
            </div>
          ))}
        </div>
      )}

      {/* them nhieu phong 1 lan */}
      <div className="mt-3 border-t border-line pt-3">
        <div className="flex gap-1">
          <button
            onClick={() => setMode("list")}
            className={`rounded-full px-3 py-1 text-[13px] font-medium ${mode === "list" ? "bg-primary text-white" : "bg-surface text-ink"}`}
          >
            Danh sách / khoảng số
          </button>
          <button
            onClick={() => setMode("auto")}
            className={`rounded-full px-3 py-1 text-[13px] font-medium ${mode === "auto" ? "bg-primary text-white" : "bg-surface text-ink"}`}
          >
            Đánh số tự động
          </button>
        </div>
        {mode === "list" ? (
          <div className="mt-2 flex flex-wrap gap-2">
            <input
              className={`${inputSm} min-w-64 flex-1`}
              placeholder="Số phòng — VD: 101, 102, 105-110"
              value={listText}
              onChange={(e) => setListText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") addRooms();
              }}
            />
            <button className="cb-btn-primary px-4 py-2 text-sm disabled:opacity-50" onClick={addRooms} disabled={fresh.length === 0}>
              + Thêm phòng
            </button>
          </div>
        ) : (
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-ink">
            <span>Từ số</span>
            <input
              className={`${inputSm} w-24`}
              placeholder="VD: 301"
              value={autoStart}
              onChange={(e) => setAutoStart(e.target.value)}
            />
            <span>tạo</span>
            <input
              type="number"
              min={1}
              max={500}
              className={`${inputSm} w-20`}
              value={autoCount}
              onChange={(e) => setAutoCount(Number(e.target.value))}
            />
            <span>phòng</span>
            <button className="cb-btn-primary px-4 py-2 text-sm disabled:opacity-50" onClick={addRooms} disabled={fresh.length === 0}>
              + Thêm phòng
            </button>
          </div>
        )}
        {fresh.length > 0 && (
          <p className="mt-1.5 text-[13px] text-success">Sẽ tạo {fresh.length} phòng: {preview}</p>
        )}
        {dups.length > 0 && (
          <p className="mt-1 text-[13px] text-warning">Đã có rồi, sẽ bỏ qua: {dups.slice(0, 8).join(", ")}{dups.length > 8 ? ` … và ${dups.length - 8} số nữa` : ""}</p>
        )}
        {parsed.invalid.length > 0 && (
          <p className="mt-1 text-[13px] text-danger">Không hiểu: {parsed.invalid.slice(0, 8).join(", ")} — chỉ nhận số, dấu phẩy và khoảng (VD: 105-110).</p>
        )}
      </div>
    </div>
  );
}

export default function HotelRoomTypesPage() {
  const params = useParams();
  const id = typeof params.hotelId === "string" ? params.hotelId : currentHotelId();
  const { showToast } = useToast();

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
  // Trang thai tu dong luu (luu am tham 600ms sau moi thay doi).
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const loadedRef = useRef(false);

  // ----- toolbar state -----
  const [typeSearch, setTypeSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");
  const [hkFilter, setHkFilter] = useState<"all" | Room["housekeepingStatus"]>("all");
  const [showAddType, setShowAddType] = useState(false);
  // Loai phong nao dang mo rong (xem phong ben trong).
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  // ----- form tao loai phong -----
  const [typeName, setTypeName] = useState("");
  const [typeCode, setTypeCode] = useState("");
  const [typeAdults, setTypeAdults] = useState(2);
  const [typeChildren, setTypeChildren] = useState(0);
  const [typeBed, setTypeBed] = useState("");
  const [typeSize, setTypeSize] = useState("");
  const [typeDesc, setTypeDesc] = useState("");

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
      setSaveState("saving");
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
        if (error) { setDbError(error.message); setSaveState("error"); return; }
      }
      const { data: dbTypes } = await supabase.from("room_types").select("id").eq("hotel_id", id);
      const keepT = new Set(roomTypes.map((x) => x.id));
      for (const d of dbTypes ?? []) {
        if (!keepT.has(d.id)) {
          const { error } = await supabase.from("room_types").delete().eq("id", d.id);
          if (error) { setDbError("Không xoá được loại phòng trong kho: " + error.message); setSaveState("error"); return; }
        }
      }
      const roomRows = rooms.map((r) => ({
        id: `${id}-${r.number}`, hotel_id: id, account_id: ACCOUNT_ID,
        room_type_id: r.roomTypeId, number: r.number, floor: Number(r.number.charAt(0)) || 1,
        housekeeping_status: r.housekeepingStatus,
      }));
      if (roomRows.length > 0) {
        const { error } = await supabase.from("rooms").upsert(roomRows);
        if (error) { setDbError(error.message); setSaveState("error"); return; }
      }
      const { data: dbRooms } = await supabase.from("rooms").select("id").eq("hotel_id", id);
      const keepR = new Set(roomRows.map((x) => x.id));
      for (const d of dbRooms ?? []) {
        if (!keepR.has(d.id)) await supabase.from("rooms").delete().eq("id", d.id);
      }
      setSaveState("saved");
    }, 600);
    return () => clearTimeout(t);
  }, [roomTypes, rooms, id]);

  function addRoomType() {
    if (!typeName.trim()) { showToast("Chưa nhập tên loại phòng.", "error"); return; }
    const newId = slugifyTypeName(typeName);
    if (roomTypes.some((t) => t.id === newId)) { showToast("Loại phòng này đã tồn tại ở khách sạn này.", "error"); return; }
    const code = typeCode.trim().toUpperCase() || autoCodeFromName(typeName);
    if (roomTypes.some((t) => (t.code ?? "").toUpperCase() === code)) { showToast(`Mã "${code}" đã có — đổi mã khác.`, "error"); return; }
    const size = typeSize.trim() === "" ? undefined : Number(typeSize);
    if (size !== undefined && (!Number.isFinite(size) || size <= 0)) { showToast("Diện tích phải là số lớn hơn 0.", "error"); return; }
    setRoomTypes((p) => [
      ...p,
      {
        id: newId,
        code,
        name: typeName.trim(),
        maxOccupancy: typeAdults + typeChildren,
        maxAdults: typeAdults,
        maxChildren: typeChildren,
        bedConfig: typeBed.trim() || "—",
        sizeM2: size,
        descriptionVi: typeDesc.trim() || undefined,
        active: true,
      },
    ]);
    // Mo luon phan phong cua loai moi de them phong ngay.
    setExpandedIds((p) => new Set(p).add(newId));
    setTypeName(""); setTypeCode(""); setTypeBed(""); setTypeSize(""); setTypeDesc("");
    setTypeAdults(2); setTypeChildren(0);
    setShowAddType(false);
  }

  function deleteRoomType(typeId: string) {
    if (rooms.some((r) => r.roomTypeId === typeId)) { showToast("Không xoá được: khách sạn này vẫn còn phòng thuộc loại đó — chuyển hoặc xoá hết phòng của loại này trước.", "error"); return; }
    if (planTypeIds.has(typeId)) { showToast("Không xoá được: vẫn còn gói giá thuộc loại này.", "error"); return; }
    setRoomTypes((p) => p.filter((t) => t.id !== typeId));
    setExpandedIds((p) => {
      const s = new Set(p);
      s.delete(typeId);
      return s;
    });
  }

  function addRoomsBulk(typeId: string, numbers: string[]) {
    setRooms((p) => [
      ...p,
      ...numbers.map((n) => ({ number: n, roomTypeId: typeId, housekeepingStatus: "clean" as Room["housekeepingStatus"] })),
    ]);
  }

  function deleteRoom(number: string) {
    if (activeRoomNumbers.has(number))
      showToast(`Không xoá được: phòng ${number} đang có đơn đang hiệu lực.`, "error");
      return;
    setRooms((p) => p.filter((r) => r.number !== number));
  }

  function toggleExpand(typeId: string) {
    setExpandedIds((p) => {
      const s = new Set(p);
      if (s.has(typeId)) s.delete(typeId);
      else s.add(typeId);
      return s;
    });
  }

  // ----- filtering: tim khop ca ten loai, ma loai VA so phong -----
  const q = typeSearch.trim().toLowerCase();
  const allRoomNumbers = new Set(rooms.map((r) => r.number));

  function roomsOfType(t: RoomType): Room[] {
    return rooms.filter((r) => r.roomTypeId === t.id);
  }

  const shownTypes = roomTypes.filter((t) => {
    const nameMatch = !q || t.name.toLowerCase().includes(q) || (t.code ?? "").toLowerCase().includes(q);
    const roomMatch = !!q && roomsOfType(t).some((r) => r.number.toLowerCase().includes(q));
    if (q && !nameMatch && !roomMatch) return false;
    if (statusFilter === "active" && !(t.active ?? true)) return false;
    if (statusFilter === "inactive" && (t.active ?? true)) return false;
    if (hkFilter !== "all" && !roomsOfType(t).some((r) => r.housekeepingStatus === hkFilter)) return false;
    return true;
  });

  // Phong trong panel: tim theo so phong thi chi hien phong khop; tim theo ten loai thi hien het.
  function shownRoomsOfType(t: RoomType): Room[] {
    const nameMatch = !q || t.name.toLowerCase().includes(q) || (t.code ?? "").toLowerCase().includes(q);
    let list = roomsOfType(t);
    if (q && !nameMatch) list = list.filter((r) => r.number.toLowerCase().includes(q));
    if (hkFilter !== "all") list = list.filter((r) => r.housekeepingStatus === hkFilter);
    return [...list].sort((a, b) => sortRoomNumbers(a.number, b.number));
  }

  // Go so phong thi tu mo loai chua phong do ra.
  function isExpanded(t: RoomType): boolean {
    if (expandedIds.has(t.id)) return true;
    if (q) return roomsOfType(t).some((r) => r.number.toLowerCase().includes(q));
    return false;
  }

  return (
    <div>
      <Link href="/hotels" className="text-sm font-medium text-primary hover:underline">
        ← Tất cả khách sạn
      </Link>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold text-ink">{hotelName}</h1>
        {hotelCode && (
          <span className="rounded-md bg-primary-soft px-2 py-0.5 text-xs font-semibold text-muted">{hotelCode}</span>
        )}
        {hotelStars && <span className="text-amber-500">{"★".repeat(hotelStars)}</span>}
      </div>
      <p className="mt-1 text-sm text-muted">
        Trang quản lí riêng của khách sạn này — không ảnh hưởng khách sạn khác.
      </p>
      {saveState !== "idle" && (
        <p className={`mt-1 text-[13px] ${saveState === "error" ? "text-danger" : saveState === "saving" ? "text-muted" : "text-success"}`}>
          {saveState === "saving" ? "Đang lưu..." : saveState === "saved" ? "✓ Đã lưu tự động." : "Lỗi khi lưu — xem thông báo đỏ phía trên."}
        </p>
      )}
      {loading && <p className="mt-3 text-sm text-muted">Đang tải dữ liệu từ Supabase...</p>}
      {dbError && <p className="mt-3 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">Lỗi cơ sở dữ liệu: {dbError}</p>}

      {/* ===== LOAI PHONG + PHONG VAT LY (1 man hinh) ===== */}
      <div className="cb-card mt-5 p-5">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-base font-bold text-ink">Loại phòng</h2>
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => setExpandedIds(new Set(shownTypes.map((t) => t.id)))}
              className="rounded-lg border border-line bg-surface px-3 py-2 text-[13px] font-medium text-ink hover:bg-[var(--nui-bg)]"
            >
              Mở tất cả
            </button>
            <button
              onClick={() => setExpandedIds(new Set())}
              className="rounded-lg border border-line bg-surface px-3 py-2 text-[13px] font-medium text-ink hover:bg-[var(--nui-bg)]"
            >
              Thu tất cả
            </button>
            <button onClick={() => setShowAddType((v) => !v)} className="cb-btn-primary px-4 py-2 text-sm">
              + Thêm loại phòng
            </button>
          </div>
        </div>
        <p className="mt-0.5 text-sm text-muted">Mỗi loại phòng có mã ngắn để khớp nối với các kênh bán. Tắt công tắc = ngừng bán mà không xoá dữ liệu. Bấm mũi tên ▸ ở đầu dòng để xem phòng vật lý của loại đó.</p>

        {/* toolbar: tim kiem + loc trang thai + loc don phong */}
        <div className="mt-4 flex flex-wrap items-center gap-4">
          <input
            className={`${inputSm} min-w-64 flex-1`}
            placeholder="Tìm mã / tên loại phòng / số phòng"
            value={typeSearch}
            onChange={(e) => setTypeSearch(e.target.value)}
          />
          <div className="flex items-center gap-4 text-sm text-ink">
            <label className="flex items-center gap-1.5">
              <input type="radio" name="typeStatus" checked={statusFilter === "all"} onChange={() => setStatusFilter("all")} className="h-4 w-4 accent-primary" />
              Tất cả
            </label>
            <label className="flex items-center gap-1.5">
              <input type="radio" name="typeStatus" checked={statusFilter === "active"} onChange={() => setStatusFilter("active")} className="h-4 w-4 accent-primary" />
              Đang hoạt động
            </label>
            <label className="flex items-center gap-1.5">
              <input type="radio" name="typeStatus" checked={statusFilter === "inactive"} onChange={() => setStatusFilter("inactive")} className="h-4 w-4 accent-primary" />
              Ngừng hoạt động
            </label>
          </div>
          <select
            className={inputSm}
            value={hkFilter}
            onChange={(e) => setHkFilter(e.target.value as "all" | Room["housekeepingStatus"])}
            title="Lọc theo trạng thái dọn phòng"
          >
            <option value="all">Mọi trạng thái dọn phòng</option>
            {(Object.keys(HK_LABELS) as Room["housekeepingStatus"][]).map((s) => (
              <option key={s} value={s}>{HK_LABELS[s]}</option>
            ))}
          </select>
        </div>

        {/* form tao loai phong (co nhan ro rang, khong chen chuc) */}
        {showAddType && (
          <div className="mt-4 rounded-lg border border-line bg-[var(--nui-bg)] p-4">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <label className="text-xs font-medium text-muted">
                Tên loại phòng *
                <input className={`${inputSm} mt-1 w-full`} placeholder="VD: Phòng Đôi" value={typeName} onChange={(e) => setTypeName(e.target.value)} />
              </label>
              <label className="text-xs font-medium text-muted">
                Mã ngắn
                <input className={`${inputSm} mt-1 w-full`} placeholder="VD: DLX — để trống: tự lấy từ tên (Phòng Đôi → PD)" value={typeCode} onChange={(e) => setTypeCode(e.target.value.toUpperCase())} />
              </label>
              <label className="text-xs font-medium text-muted">
                Người lớn tối đa
                <input type="number" min={1} className={`${inputSm} mt-1 w-full`} value={typeAdults} onChange={(e) => setTypeAdults(Number(e.target.value))} />
              </label>
              <label className="text-xs font-medium text-muted">
                Trẻ em tối đa
                <input type="number" min={0} className={`${inputSm} mt-1 w-full`} value={typeChildren} onChange={(e) => setTypeChildren(Number(e.target.value))} />
              </label>
              <label className="text-xs font-medium text-muted">
                Kiểu giường
                <input className={`${inputSm} mt-1 w-full`} placeholder="VD: King / 2 giường đơn" value={typeBed} onChange={(e) => setTypeBed(e.target.value)} />
              </label>
              <label className="text-xs font-medium text-muted">
                Diện tích (m²)
                <input className={`${inputSm} mt-1 w-full`} placeholder="VD: 28" value={typeSize} onChange={(e) => setTypeSize(e.target.value)} />
              </label>
              <label className="text-xs font-medium text-muted md:col-span-2">
                Mô tả ngắn (hiện cho khách xem)
                <input className={`${inputSm} mt-1 w-full`} placeholder="VD: Phòng view sông, ban công riêng" value={typeDesc} onChange={(e) => setTypeDesc(e.target.value)} />
              </label>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button className="cb-btn-primary px-4 py-2 text-sm" onClick={addRoomType}>+ Thêm loại phòng</button>
              <button
                className="rounded-lg border border-line bg-surface px-4 py-2 text-sm font-medium text-ink"
                onClick={() => setShowAddType(false)}
              >
                Huỷ
              </button>
              <span className="text-xs text-muted">
                Giá bán nhập ở <Link href={`/${id}/rates`} className="font-medium text-primary hover:underline">Lịch giá</Link> sau khi tạo loại phòng.
              </span>
            </div>
          </div>
        )}

        <table className="mt-4 w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--nui-bg)] text-left text-xs uppercase tracking-wide text-muted">
              <th className="w-8 py-2 pr-1 font-semibold"></th>
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
            {shownTypes.map((t, i) => {
              const open = isExpanded(t);
              const typeRooms = roomsOfType(t);
              return (
                <Fragment key={t.id}>
                  <tr className="border-b border-[var(--nui-bg)] align-top">
                    <td className="py-2.5 pr-1">
                      <button
                        onClick={() => toggleExpand(t.id)}
                        className="rounded px-1 text-base leading-none text-muted hover:text-primary"
                        title={open ? "Thu lại" : "Mở ra xem phòng vật lý"}
                      >
                        {open ? "▾" : "▸"}
                      </button>
                    </td>
                    <td className="py-2.5 pr-3 text-muted">{i + 1}</td>
                    <td className="py-2.5 pr-3">
                      <span className="rounded-md bg-primary-soft px-2 py-0.5 text-xs font-semibold text-muted">{t.code ?? "—"}</span>
                    </td>
                    <td className="py-2.5 pr-3 font-medium">
                      <Link href={`/hotels/${id}/room-types/${t.id}`} className="text-primary hover:underline" title="Mở trang quản lí loại phòng này">
                        {t.name}
                      </Link>
                    </td>
                    <td className="py-2.5 pr-3">
                      {t.maxAdults !== undefined ? `${t.maxAdults} người lớn, ${t.maxChildren ?? 0} trẻ em` : `${t.maxOccupancy} khách`}
                    </td>
                    <td className="py-2.5 pr-3">{t.bedConfig}</td>
                    <td className="py-2.5 pr-3">{typeRooms.length}</td>
                    <td className="py-2.5 pr-3">
                      <button
                        onClick={() => setRoomTypes((p) => p.map((x) => (x.id === t.id ? { ...x, active: !(x.active ?? true) } : x)))}
                        className={`relative h-5 w-9 rounded-full transition ${t.active ?? true ? "bg-primary" : "bg-gray-300"}`}
                        title="Đang bán / ngừng bán"
                      >
                        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-surface transition-all ${t.active ?? true ? "left-[18px]" : "left-0.5"}`} />
                      </button>
                    </td>
                    <td className="py-2.5 text-right">
                      <button onClick={() => deleteRoomType(t.id)} className="font-medium text-danger hover:underline">Xoá</button>
                    </td>
                  </tr>
                  {open && (
                    <tr className="border-b border-[var(--nui-bg)]">
                      <td colSpan={9} className="py-3 pl-8 pr-2">
                        <TypeRoomsPanel
                          hotelId={id}
                          typeId={t.id}
                          rooms={shownRoomsOfType(t)}
                          totalRooms={typeRooms.length}
                          allRoomNumbers={allRoomNumbers}
                          roomTypes={roomTypes}
                          activeRoomNumbers={activeRoomNumbers}
                          onAddRooms={addRoomsBulk}
                          onDeleteRoom={deleteRoom}
                          onSetHK={(number, status) =>
                            setRooms((p) =>
                              p.map((x) => (x.number === number ? { ...x, housekeepingStatus: status } : x))
                            )
                          }
                          onMoveRoom={(number, newTypeId) =>
                            setRooms((p) =>
                              p.map((x) => (x.number === number ? { ...x, roomTypeId: newTypeId } : x))
                            )
                          }
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {shownTypes.length === 0 && (
              <tr><td colSpan={9} className="py-6 text-center text-muted">{roomTypes.length === 0 ? "Chưa có loại phòng nào — bấm \"+ Thêm loại phòng\" để tạo." : "Không tìm thấy loại phòng nào khớp."}</td></tr>
            )}
          </tbody>
        </table>
        <p className="mt-3 text-xs text-muted">
          Giá bán không nằm ở đây: giá theo từng kênh nhập ở trang Lịch giá (tab Giá theo kênh) — để khỏi có 2 nơi cùng giữ 1 giá.
        </p>
      </div>
    </div>
  );
}
