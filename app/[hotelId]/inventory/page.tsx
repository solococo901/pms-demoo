"use client";
// INV4 — app/[hotelId]/inventory/page.tsx (Chặn phòng & Đóng bán)
// Theo chuan PMS lon: trang nay chi la BANG KIEM TRA (xem + xoa).
// Chan phong tao o Lich phong; dong ban + han che tao o Lich gia /
// Cap nhat gia hang loat. Du lieu, cach ghi DB, day Channex giu nguyen.

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { CHANNELS, getChannelName, type InventoryBlock, type Room, type RoomBlock, type RoomType } from "@/lib/mock-data";
import { supabase } from "@/lib/supabase";
import { currentHotelId } from "@/lib/current-hotel";
import { queueChannexDates, rangeDates } from "@/lib/channex-outbox";
import { DatePicker } from "@/components/DatePicker";
import { useToast } from "@/components/Toast";
import ConfirmDialog from "@/components/ConfirmDialog";
import { writeAuditLog } from "@/lib/audit-log";

const ACCOUNT_ID = "11111111-1111-1111-1111-111111111111";
const OTA_CHANNELS = CHANNELS.filter((c) => c.type === "ota");

const fmtDate = (s: string) => {
  const [y, m, d] = s.split("-");
  return `${d}/${m}/${y}`;
};
const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const toDate = (s: string) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
};
const toISO = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const addDays = (s: string, n: number) => {
  const d = toDate(s);
  d.setDate(d.getDate() + n);
  return toISO(d);
};
const diffDays = (a: string, b: string) => Math.round((toDate(b).getTime() - toDate(a).getTime()) / 86400000);
const nights = (a: string, b: string) => diffDays(a, b) + 1;
const DOW = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];
const dowOf = (s: string) => DOW[toDate(s).getDay()];

type RowStatus = "active" | "upcoming" | "expired";
const statusOf = (from: string, to: string, today: string): RowStatus =>
  to < today ? "expired" : from > today ? "upcoming" : "active";
const STATUS_LABEL: Record<RowStatus, string> = { active: "Đang chạy", upcoming: "Sắp tới", expired: "Hết hạn" };
const STATUS_DOT: Record<RowStatus, string> = { active: "#1db584", upcoming: "#f59e0b", expired: "#9aa7b4" };

const inputSm = "rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-primary";

type ListRow = {
  key: string;
  kind: "room" | "stop";
  rawId: string;
  from: string;
  to: string;
  reason: string;
  status: RowStatus;
  roomNumber?: string;
  roomTypeId?: string;
  blockKind?: RoomBlock["kind"];
  scope?: InventoryBlock["scope"];
  channelCode?: string;
  managedElsewhere: boolean;
};

function Dot({ color }: { color: string }) {
  return <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />;
}

function Modal({ onClose, children, wide }: { onClose: () => void; children: ReactNode; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className={`max-h-[90vh] w-full ${wide ? "max-w-2xl" : "max-w-lg"} overflow-y-auto rounded-xl border border-line bg-surface p-5 shadow-2xl`}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

export default function InventoryPage() {
  const { showToast } = useToast();
  const params = useParams();
  const HOTEL_ID = typeof params.hotelId === "string" ? params.hotelId : currentHotelId();
  const router = useRouter();
  const today = todayStr();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [roomTypes, setRoomTypes] = useState<RoomType[]>([]);
  const [roomBlocks, setRoomBlocks] = useState<RoomBlock[]>([]);
  const [invBlocks, setInvBlocks] = useState<InventoryBlock[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  // Che do xem + tab + bo loc.
  const [view, setView] = useState<"list" | "calendar">("list");
  const [tab, setTab] = useState<"all" | "room" | "stop">("all");
  const [fFrom, setFFrom] = useState("");
  const [fTo, setFTo] = useState("");
  const [fType, setFType] = useState("");
  const [fChannel, setFChannel] = useState("");
  const [fStatus, setFStatus] = useState("");
  const [fSearch, setFSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());


  // Lich + chi tiet 1 o chan phong tren lich.
  const [calStart, setCalStart] = useState(today);
  const [calBlock, setCalBlock] = useState<RoomBlock | null>(null);

  // Hop xac nhan dung chung (thay cho confirm() cua trinh duyet).
  const [confirmReq, setConfirmReq] = useState<{ message: string; confirmLabel: string; resolve: (ok: boolean) => void } | null>(null);
  function askConfirm(message: string, confirmLabel = "Xác nhận") {
    return new Promise<boolean>((resolve) => setConfirmReq({ message, confirmLabel, resolve }));
  }

  useEffect(() => {
    (async () => {
      const [roomsRes, typesRes, rbRes, ibRes] = await Promise.all([
        supabase.from("rooms").select("*").eq("hotel_id", HOTEL_ID).order("number"),
        supabase.from("room_types").select("*").eq("hotel_id", HOTEL_ID),
        supabase.from("room_blocks").select("*").eq("hotel_id", HOTEL_ID).order("from_date"),
        supabase.from("inventory_blocks").select("*").eq("hotel_id", HOTEL_ID).order("from_date"),
      ]);
      if (roomsRes.error || typesRes.error || rbRes.error || ibRes.error) {
        setLoadError((roomsRes.error ?? typesRes.error ?? rbRes.error ?? ibRes.error)?.message ?? "Không đọc được dữ liệu");
        setLoading(false);
        return;
      }
      const loadedRooms: Room[] = (roomsRes.data ?? []).map((r) => ({
        number: r.number, roomTypeId: r.room_type_id,
        housekeepingStatus: (r.housekeeping_status ?? "clean") as Room["housekeepingStatus"],
      }));
      setRooms(loadedRooms);
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
      setRoomBlocks((rbRes.data ?? []).map((b) => ({
        id: b.id, roomNumber: b.room_number, from: b.from_date, to: b.to_date,
        kind: b.kind as RoomBlock["kind"], reason: b.reason ?? undefined,
      })));
      setInvBlocks((ibRes.data ?? []).map((b) => ({
        id: b.id, scope: b.scope as InventoryBlock["scope"],
        channelCode: b.channel_code ?? undefined, roomTypeId: b.room_type_id,
        from: b.from_date, to: b.to_date, reason: b.reason ?? undefined,
      })));
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const roomTypeName = (id?: string) => roomTypes.find((t) => t.id === id)?.name ?? id ?? "—";
  const roomTypeOfRoom = (num: string) => rooms.find((r) => r.number === num)?.roomTypeId;

  // Gom 2 loai thanh 1 danh sach.
  const rows: ListRow[] = useMemo(() => {
    const out: ListRow[] = [];
    for (const b of roomBlocks) {
      out.push({
        key: `rb-${b.id}`, kind: "room", rawId: b.id, from: b.from, to: b.to,
        reason: b.reason ?? "", status: statusOf(b.from, b.to, today),
        roomNumber: b.roomNumber,
        roomTypeId: rooms.find((r) => r.number === b.roomNumber)?.roomTypeId,
        blockKind: b.kind, managedElsewhere: false,
      });
    }
    for (const b of invBlocks) {
      out.push({
        key: `ib-${b.id}`, kind: "stop", rawId: b.id, from: b.from, to: b.to,
        reason: b.reason ?? "", status: statusOf(b.from, b.to, today),
        roomTypeId: b.roomTypeId, scope: b.scope, channelCode: b.channelCode,
        managedElsewhere: b.reason === "Tắt bán trên kênh",
      });
    }
    out.sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
    return out;
  }, [roomBlocks, invBlocks, rooms, today]);

  // The tom tat.
  const chips = useMemo(() => {
    const blockedRooms = new Set(rows.filter((r) => r.kind === "room" && r.status === "active").map((r) => r.roomNumber));
    const stopNow = rows.filter((r) => r.kind === "stop" && r.status === "active").length;
    const expiring = rows.filter((r) => r.status === "active" && r.to >= today && r.to <= addDays(today, 7)).length;
    return { blockedRooms: blockedRooms.size, stopNow, expiring };
  }, [rows, today]);

  const filtered = useMemo(() => {
    const q = fSearch.trim().toLowerCase();
    return rows.filter((r) => {
      if (tab !== "all" && r.kind !== tab) return false;
      if (fFrom && r.to < fFrom) return false;
      if (fTo && r.from > fTo) return false;
      if (fType && r.roomTypeId !== fType) return false;
      // Bo loc kenh chi ap dung cho dong Dong ban; dong Chan phong luon hien.
      if (fChannel && r.kind === "stop") {
        if (fChannel === "room_type" && r.scope !== "room_type") return false;
        if (fChannel !== "room_type" && (r.scope !== "channel" || r.channelCode !== fChannel)) return false;
      }
      if (fStatus && r.status !== fStatus) return false;
      if (q) {
        const hay = `${r.reason} ${r.roomNumber ?? ""} ${roomTypes.find((t) => t.id === r.roomTypeId)?.name ?? ""} ${r.kind === "stop" ? getChannelName(r.channelCode ?? "") : ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, tab, fFrom, fTo, fType, fChannel, fStatus, fSearch, roomTypes]);

  async function deleteRoomBlock(id: string, silent = false) {
    const blk = roomBlocks.find((b) => b.id === id);
    if (blk && !silent) {
      const ok = await askConfirm(`Mở phòng ${blk.roomNumber} (${fmtDate(blk.from)} – ${fmtDate(blk.to)})? Phòng sẽ bán lại như bình thường.`, "Mở phòng");
      if (!ok) return false;
    }
    const { error } = await supabase.from("room_blocks").delete().eq("id", id);
    if (error) { showToast("Xoá chặn phòng không thành công: " + error.message, "error"); return false; }
    setRoomBlocks((prev) => prev.filter((b) => b.id !== id));
    setSelected((prev) => { const next = new Set(prev); next.delete(`rb-${id}`); return next; });
    if (blk?.kind === "out_of_order") queueChannexDates(rangeDates(blk.from, blk.to));
    if (blk) writeAuditLog({ hotelId: HOTEL_ID, accountId: ACCOUNT_ID, action: "room_unblocked", entityType: "room_block", entityId: id, summary: `Mở phòng ${blk.roomNumber} · ${fmtDate(blk.from)} → ${fmtDate(blk.to)}` });
    if (!silent) showToast("Đã mở phòng.");
    return true;
  }

  async function deleteInvBlock(id: string, silent = false) {
    const blk = invBlocks.find((b) => b.id === id);
    if (blk && !silent) {
      const ok = await askConfirm(`Xoá đóng bán ${blk.scope === "channel" ? getChannelName(blk.channelCode ?? "") : "Tất cả kênh"} × ${roomTypeName(blk.roomTypeId)} (${fmtDate(blk.from)} – ${fmtDate(blk.to)})? Kênh sẽ bán lại loại phòng này trong khoảng ngày đó.`, "Xoá");
      if (!ok) return false;
    }
    const { error } = await supabase.from("inventory_blocks").delete().eq("id", id);
    if (error) { showToast("Xoá đóng bán không thành công: " + error.message, "error"); return false; }
    setInvBlocks((prev) => prev.filter((b) => b.id !== id));
    setSelected((prev) => { const next = new Set(prev); next.delete(`ib-${id}`); return next; });
    if (blk) {
      queueChannexDates(rangeDates(blk.from, blk.to));
      writeAuditLog({ hotelId: HOTEL_ID, accountId: ACCOUNT_ID, action: "stop_sell_removed", entityType: "inventory_block", entityId: id, summary: `Mở bán ${blk.scope === "channel" ? getChannelName(blk.channelCode ?? "") : "Tất cả kênh"} × ${roomTypeName(blk.roomTypeId)} · ${fmtDate(blk.from)} → ${fmtDate(blk.to)}` });
    }
    if (!silent) showToast("Đã mở bán.");
    return true;
  }

  async function deleteSelected() {
    const deletable = rows.filter((r) => selected.has(r.key) && !r.managedElsewhere);
    if (deletable.length === 0) { showToast("Không có dòng nào xoá được.", "error"); return; }
    const ok = await askConfirm(`Xoá ${deletable.length} dòng đã chọn? Hành động này không hoàn tác được.`, "Xoá");
    if (!ok) return;
    for (const r of deletable) {
      if (r.kind === "room") await deleteRoomBlock(r.rawId, true);
      else await deleteInvBlock(r.rawId, true);
    }
    showToast(`Đã xoá ${deletable.length} dòng.`);
  }

  const calDays = useMemo(() => {
    const out: string[] = [];
    for (let i = 0; i < 14; i++) out.push(addDays(calStart, i));
    return out;
  }, [calStart]);

  function onCalCell(room: Room, date: string) {
    const blk = roomBlocks.find((b) => b.roomNumber === room.number && b.from <= date && date <= b.to);
    if (blk) { setCalBlock(blk); return; }
    const stop = invBlocks.some((b) => b.roomTypeId === room.roomTypeId && b.from <= date && date <= b.to);
    if (stop) {
      setTab("stop"); setFType(room.roomTypeId); setView("list");
      return;
    }
    // O trong: sang Lich phong de chan phong (trang nay chi xem + xoa).
    router.push(`/${HOTEL_ID}/calendar`);
  }

  if (loading) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-ink">Chặn phòng & Đóng bán</h1>
        <p className="mt-4 text-sm text-muted">Đang tải dữ liệu từ Supabase...</p>
      </div>
    );
  }
  if (loadError) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-ink">Chặn phòng & Đóng bán</h1>
        <p className="mt-4 text-sm text-danger">Không đọc được dữ liệu từ Supabase: {loadError}</p>
      </div>
    );
  }

  const selectable = filtered.filter((r) => !r.managedElsewhere);
  const allSelected = selectable.length > 0 && selectable.every((r) => selected.has(r.key));

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ink">Chặn phòng & Đóng bán</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            Bảng kiểm tra chung: mọi lần chặn phòng và đóng bán đang có. Chặn phòng mới làm ở Lịch phòng; đóng bán và hạn chế làm ở Lịch giá / Cập nhật giá hàng loạt.
          </p>
        </div>
        <div className="flex gap-2">
          <Link href={`/${HOTEL_ID}/calendar`} className="cb-btn-ghost px-4 py-2 text-sm">+ Chặn phòng</Link>
          <Link href={`/${HOTEL_ID}/rates/bulk?tab=restrictions&mode=stop_sell`} className="cb-btn-primary px-4 py-2 text-sm">+ Đóng bán</Link>
        </div>
      </div>

      {/* The tom tat */}
      <div className="mt-4 flex flex-wrap gap-2">
        <span className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1.5 text-sm">
          <Dot color="#e5484d" /> Đang chặn: <b>{chips.blockedRooms} phòng</b>
        </span>
        <span className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1.5 text-sm">
          <Dot color="#f59e0b" /> Đang đóng bán: <b>{chips.stopNow}</b>
        </span>
        <span className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1.5 text-sm">
          <Dot color="#9aa7b4" /> Sắp hết hạn (7 ngày): <b>{chips.expiring}</b>
        </span>
      </div>

      {/* Tab + che do xem */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1 rounded-lg border border-line bg-surface p-1">
          {([
            ["all", `Tất cả (${rows.length})`],
            ["room", `Chặn phòng (${rows.filter((r) => r.kind === "room").length})`],
            ["stop", `Đóng bán (${rows.filter((r) => r.kind === "stop").length})`],
          ] as const).map(([k, label]) => (
            <button key={k} onClick={() => setTab(k)} className={`rounded-md px-3 py-1.5 text-sm font-semibold ${tab === k ? "bg-primary text-white" : "text-muted"}`}>{label}</button>
          ))}
        </div>
        <div className="flex gap-1 rounded-lg border border-line bg-surface p-1">
          <button onClick={() => setView("list")} className={`rounded-md px-3 py-1.5 text-sm font-semibold ${view === "list" ? "bg-primary text-white" : "text-muted"}`}>Danh sách</button>
          <button onClick={() => setView("calendar")} className={`rounded-md px-3 py-1.5 text-sm font-semibold ${view === "calendar" ? "bg-primary text-white" : "text-muted"}`}>Lịch</button>
        </div>
      </div>

      {/* Bo loc */}
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <div>
          <span className="text-xs text-muted">Từ ngày</span>
          <div className="mt-0.5"><DatePicker value={fFrom} onChange={setFFrom} placeholder="Từ ngày" clearable /></div>
        </div>
        <div>
          <span className="text-xs text-muted">Đến ngày</span>
          <div className="mt-0.5"><DatePicker value={fTo} onChange={setFTo} placeholder="Đến ngày" clearable /></div>
        </div>
        <select className={inputSm} value={fType} onChange={(e) => setFType(e.target.value)}>
          <option value="">Tất cả loại phòng</option>
          {roomTypes.map((t) => (<option key={t.id} value={t.id}>{t.name}</option>))}
        </select>
        <select className={inputSm} value={fChannel} onChange={(e) => setFChannel(e.target.value)} title="Bộ lọc kênh chỉ áp dụng cho dòng Đóng bán">
          <option value="">Tất cả kênh</option>
          <option value="room_type">Đóng bán chung (tất cả kênh)</option>
          {OTA_CHANNELS.map((c) => (<option key={c.code} value={c.code}>{c.name}</option>))}
        </select>
        <select className={inputSm} value={fStatus} onChange={(e) => setFStatus(e.target.value)}>
          <option value="">Tất cả trạng thái</option>
          <option value="active">Đang chạy</option>
          <option value="upcoming">Sắp tới</option>
          <option value="expired">Hết hạn</option>
        </select>
        <input className={inputSm} placeholder="Tìm lý do, phòng..." value={fSearch} onChange={(e) => setFSearch(e.target.value)} />
        {(fFrom || fTo || fType || fChannel || fStatus || fSearch) && (
          <button className="text-sm font-medium text-primary hover:underline" onClick={() => { setFFrom(""); setFTo(""); setFType(""); setFChannel(""); setFStatus(""); setFSearch(""); }}>Xoá bộ lọc</button>
        )}
      </div>

      {selected.size > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg border border-line bg-surface px-3 py-2 text-sm">
          <span>Đã chọn <b>{selected.size}</b> dòng</span>
          <button className="font-medium text-danger hover:underline" onClick={deleteSelected}>Xoá các dòng đã chọn</button>
          <button className="font-medium text-muted hover:underline" onClick={() => setSelected(new Set())}>Bỏ chọn</button>
        </div>
      )}

      {view === "list" ? (
        <div className="cb-card mt-4 p-5">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--nui-bg)] text-left text-xs uppercase tracking-wide text-muted">
                <th className="w-8 py-2 pr-2">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={(e) => {
                      if (e.target.checked) setSelected(new Set(selectable.map((r) => r.key)));
                      else setSelected(new Set());
                    }}
                  />
                </th>
                <th className="py-2 pr-3 font-semibold">Loại</th>
                <th className="py-2 pr-3 font-semibold">Phòng / Loại phòng</th>
                <th className="py-2 pr-3 font-semibold">Phạm vi</th>
                <th className="py-2 pr-3 font-semibold">Ngày</th>
                <th className="py-2 pr-3 font-semibold">Lý do</th>
                <th className="py-2 pr-3 font-semibold">Trạng thái</th>
                <th className="py-2 text-right font-semibold"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.key} className="border-b border-[var(--nui-bg)] align-top">
                  <td className="py-2.5 pr-2">
                    <input
                      type="checkbox"
                      disabled={r.managedElsewhere}
                      checked={selected.has(r.key)}
                      onChange={(e) => {
                        setSelected((prev) => { const next = new Set(prev); if (e.target.checked) next.add(r.key); else next.delete(r.key); return next; });
                      }}
                    />
                  </td>
                  <td className="py-2.5 pr-3">
                    {r.kind === "room" ? (
                      <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${r.blockKind === "out_of_order" ? "bg-red-50 text-red-700" : "bg-slate-100 text-slate-600"}`}>{r.blockKind === "out_of_order" ? "Phòng hỏng" : "Tạm đóng"}</span>
                    ) : (
                      <span className="inline-block whitespace-nowrap rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">Đóng bán</span>
                    )}
                  </td>
                  <td className="py-2.5 pr-3">
                    {r.kind === "room" ? (
                      <><div className="font-semibold text-ink">{r.roomNumber}</div><div className="text-xs text-muted">{roomTypeName(r.roomTypeId)}</div></>
                    ) : (
                      <div className="font-semibold text-ink">{roomTypeName(r.roomTypeId)}</div>
                    )}
                  </td>
                  <td className="py-2.5 pr-3">
                    {r.kind === "room"
                      ? (r.blockKind === "out_of_order" ? "Tất cả kênh" : "Chỉ trong PMS")
                      : (r.scope === "channel" ? getChannelName(r.channelCode ?? "") : "Tất cả kênh")}
                  </td>
                  <td className="py-2.5 pr-3">
                    <div className="whitespace-nowrap">{fmtDate(r.from)} – {fmtDate(r.to)}</div>
                    <div className="text-xs text-muted">{nights(r.from, r.to)} đêm</div>
                  </td>
                  <td className="py-2.5 pr-3">{r.reason || "—"}</td>
                  <td className="py-2.5 pr-3">
                    <span className="inline-flex items-center gap-1.5 whitespace-nowrap"><Dot color={STATUS_DOT[r.status]} />{STATUS_LABEL[r.status]}</span>
                  </td>
                  <td className="py-2.5 text-right">
                    {r.managedElsewhere ? (
                      <span className="text-xs text-muted" title="Tắt bằng công tắc ở trang Kênh bán — bật lại công tắc ở đó để mở bán">Quản lý ở Kênh bán</span>
                    ) : (
                      <button className="font-medium text-danger hover:underline" onClick={() => { if (r.kind === "room") deleteRoomBlock(r.rawId); else deleteInvBlock(r.rawId); }}>{r.kind === "room" ? "Mở phòng" : "Xoá"}</button>
                    )}
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={8} className="py-6 text-center text-muted">Không có dòng nào khớp bộ lọc.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="cb-card mt-4 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <button className="cb-btn-ghost px-3 py-1.5 text-sm" onClick={() => setCalStart(addDays(calStart, -14))}>‹</button>
              <span className="text-sm font-semibold text-ink">{fmtDate(calDays[0])} – {fmtDate(calDays[13])}</span>
              <button className="cb-btn-ghost px-3 py-1.5 text-sm" onClick={() => setCalStart(addDays(calStart, 14))}>›</button>
              <button className="text-sm font-medium text-primary hover:underline" onClick={() => setCalStart(today)}>Hôm nay</button>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
              <span className="inline-flex items-center gap-1.5"><Dot color="#e5484d" /> Phòng hỏng</span>
              <span className="inline-flex items-center gap-1.5"><Dot color="#9aa7b4" /> Tạm đóng</span>
              <span className="inline-flex items-center gap-1.5"><Dot color="#f59e0b" /> Đóng bán</span>
            </div>
          </div>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[980px] border-collapse text-sm">
              <thead>
                <tr>
                  <th className="sticky left-0 z-10 w-[150px] bg-surface py-2 pr-2 text-left font-medium text-muted">Phòng</th>
                  {calDays.map((d) => (
                    <th key={d} className="w-[64px] py-1 text-center font-medium text-muted">
                      <div className="text-[11px]">{dowOf(d)}</div>
                      <div>{d.slice(8, 10)}/{d.slice(5, 7)}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rooms.map((room) => (
                  <tr key={room.number} className="border-t border-[var(--nui-bg)]">
                    <td className="sticky left-0 z-10 bg-surface py-1.5 pr-2">
                      <div className="font-semibold text-ink">{room.number}</div>
                      <div className="text-xs text-muted">{roomTypeName(room.roomTypeId)}</div>
                    </td>
                    {calDays.map((d) => {
                      const blk = roomBlocks.find((b) => b.roomNumber === room.number && b.from <= d && d <= b.to);
                      const stop = !blk && invBlocks.some((b) => b.roomTypeId === room.roomTypeId && b.from <= d && d <= b.to);
                      const bg = blk ? (blk.kind === "out_of_order" ? "#e5484d" : "#9aa7b4") : stop ? "#f59e0b" : "";
                      const title = blk
                        ? `${blk.kind === "out_of_order" ? "Phòng hỏng" : "Tạm đóng"}: ${blk.reason ?? ""} (${fmtDate(blk.from)} – ${fmtDate(blk.to)})`
                        : stop
                          ? "Đóng bán loại phòng này ngày này — bấm để xem danh sách"
                          : `${room.number} · ${fmtDate(d)} — bấm để sang Lịch phòng`;
                      return (
                        <td key={d} className="p-0.5">
                          <button
                            title={title}
                            onClick={() => onCalCell(room, d)}
                            className={`block h-9 w-full rounded ${bg ? "" : "bg-surface-muted hover:bg-[var(--nui-bg)]"}`}
                            style={bg ? { backgroundColor: bg } : undefined}
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
                {rooms.length === 0 && (
                  <tr><td colSpan={15} className="py-6 text-center text-muted">Chưa có phòng nào.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-muted">Bấm ô trống để sang Lịch phòng chặn phòng ngày đó; bấm ô đỏ để xem / mở phòng; bấm ô vàng để xem các lần đóng bán của loại phòng đó.</p>
        </div>
      )}

      {/* Chi tiet 1 o chan phong tren lich */}
      {calBlock && (
        <Modal onClose={() => setCalBlock(null)}>
          <h2 className="text-lg font-bold text-ink">Phòng {calBlock.roomNumber} — {calBlock.kind === "out_of_order" ? "Phòng hỏng" : "Tạm đóng"}</h2>
          <div className="mt-3 flex flex-col gap-1.5 text-sm">
            <div className="flex justify-between"><span className="text-muted">Loại phòng</span><b>{roomTypeName(roomTypeOfRoom(calBlock.roomNumber))}</b></div>
            <div className="flex justify-between"><span className="text-muted">Từ đêm</span><b>{fmtDate(calBlock.from)}</b></div>
            <div className="flex justify-between"><span className="text-muted">Đến đêm</span><b>{fmtDate(calBlock.to)}</b></div>
            <div className="flex justify-between"><span className="text-muted">Số đêm</span><b>{nights(calBlock.from, calBlock.to)}</b></div>
            <div className="flex justify-between"><span className="text-muted">Lý do</span><b>{calBlock.reason ?? "—"}</b></div>
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <button className="cb-btn-ghost px-4 py-2 text-sm" onClick={() => setCalBlock(null)}>Đóng</button>
            <button className="cb-btn-primary px-4 py-2 text-sm" onClick={async () => { const ok = await deleteRoomBlock(calBlock.id); if (ok) setCalBlock(null); }}>Mở phòng</button>
          </div>
        </Modal>
      )}

      {/* Hop xac nhan dung chung */}
      {confirmReq && (
        <ConfirmDialog
          message={confirmReq.message}
          confirmLabel={confirmReq.confirmLabel}
          onConfirm={() => { const r = confirmReq.resolve; setConfirmReq(null); r(true); }}
          onCancel={() => { const r = confirmReq.resolve; setConfirmReq(null); r(false); }}
        />
      )}
    </div>
  );
}
