"use client";

// NATEUI7 — app/[hotelId]/housekeeping/page.tsx (Buong phong)
// Phong theo trang thai don phong, phong tra hom nay len dau; doi sang token toi gian 2026-11-21.
// Le tan / Buong phong doi duoc trang thai nho SQL 22; trang Loai phong van chi admin.

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { currentHotelId } from "@/lib/current-hotel";
import type { Room } from "@/lib/mock-data";

const ACCOUNT_ID = "11111111-1111-1111-1111-111111111111";

const HK_LABELS: Record<Room["housekeepingStatus"], string> = {
  clean: "Sạch",
  dirty: "Chưa dọn",
  in_progress: "Đang dọn",
  out_of_order: "Ngừng bán",
};
const HK_BADGE: Record<Room["housekeepingStatus"], string> = {
  clean: "bg-success-soft text-success",
  dirty: "bg-danger-soft text-danger",
  in_progress: "bg-warning-soft text-warning",
  out_of_order: "bg-surface-muted text-muted",
};
// Buoc tiep theo trong vong don phong (nut chinh tren tung dong).
const NEXT_STEP: Partial<
  Record<Room["housekeepingStatus"], { to: Room["housekeepingStatus"]; label: string }>
> = {
  dirty: { to: "in_progress", label: "Bắt đầu dọn" },
  in_progress: { to: "clean", label: "Dọn xong" },
  out_of_order: { to: "dirty", label: "Đã sửa xong" },
};

type StayRow = {
  id: string;
  guestName: string;
  checkIn: string;
  checkOut: string;
  status: string;
};
type MoveKind = "arrival" | "departure" | "stayover" | "checkedout" | "none";
type MoveInfo = { kind: MoveKind; label: string; guest: string };
const MOVE_ORDER: Record<MoveKind, number> = {
  departure: 0,
  checkedout: 0,
  arrival: 1,
  stayover: 2,
  none: 3,
};
const STATUS_ORDER: Record<Room["housekeepingStatus"], number> = {
  dirty: 0,
  in_progress: 1,
  out_of_order: 2,
  clean: 3,
};
const MOVE_BADGE: Record<MoveKind, string> = {
  arrival: "bg-primary-soft text-primary",
  departure: "bg-warning-soft text-warning",
  stayover: "bg-surface-muted text-muted",
  checkedout: "bg-danger-soft text-danger",
  none: "bg-surface-muted text-muted",
};

function localISO(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function fmtDate(iso: string) {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}
// So phong sap xep so truoc chu sau ("101" < "101A" < "201").
function compareRoomNumbers(a: string, b: string) {
  const na = parseInt(a, 10);
  const nb = parseInt(b, 10);
  if (!Number.isNaN(na) && !Number.isNaN(nb) && na !== nb) return na - nb;
  return a.localeCompare(b);
}

export default function HousekeepingPage() {
  const params = useParams();
  const HOTEL_ID =
    typeof params.hotelId === "string" ? params.hotelId : currentHotelId();
  const [hotelName, setHotelName] = useState("");
  const [todayStr, setTodayStr] = useState("");
  const [typeNames, setTypeNames] = useState<Record<string, string>>({});
  const [rooms, setRooms] = useState<Room[]>([]);
  const [moves, setMoves] = useState<Record<string, MoveInfo>>({});
  const [loading, setLoading] = useState(true);
  const [dbError, setDbError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | Room["housekeepingStatus"]>("all");
  const [onlyDepartures, setOnlyDepartures] = useState(false);

  useEffect(() => {
    (async () => {
      const today = localISO(new Date());
      setTodayStr(today);
      const [hotelRes, typesRes, roomsRes, resRes] = await Promise.all([
        supabase.from("hotels").select("name").eq("id", HOTEL_ID).single(),
        supabase.from("room_types").select("id, name").eq("hotel_id", HOTEL_ID),
        supabase.from("rooms").select("*").eq("hotel_id", HOTEL_ID),
        // Don dang o / sap den / vua tra: ngay tra >= hom nay.
        supabase
          .from("reservations")
          .select("id, guest_name, check_in, check_out, status")
          .eq("hotel_id", HOTEL_ID)
          .in("status", ["confirmed", "in_house", "checked_out"])
          .gte("check_out", today),
      ]);
      if (hotelRes.error || !hotelRes.data) {
        setDbError("Không tìm thấy khách sạn này trong cơ sở dữ liệu.");
        setLoading(false);
        return;
      }
      setHotelName(hotelRes.data.name);
      const names: Record<string, string> = {};
      (typesRes.data ?? []).forEach((t: { id: string; name: string }) => {
        names[t.id] = t.name;
      });
      setTypeNames(names);
      setRooms(
        (roomsRes.data ?? []).map((r) => ({
          number: r.number,
          roomTypeId: r.room_type_id,
          housekeepingStatus: (r.housekeeping_status ??
            "clean") as Room["housekeepingStatus"],
        }))
      );
      const stays: StayRow[] = (resRes.data ?? []).map((r) => ({
        id: r.id,
        guestName: r.guest_name ?? "",
        checkIn: r.check_in,
        checkOut: r.check_out,
        status: r.status,
      }));
      const stayIds = stays.map((s) => s.id);
      const { data: rr } =
        stayIds.length > 0
          ? await supabase
              .from("reservation_rooms")
              .select("reservation_id, room_number")
              .in("reservation_id", stayIds)
          : { data: [] };
      const roomOfStay: Record<string, string> = {};
      (rr ?? []).forEach((x: { reservation_id: string; room_number: string }) => {
        roomOfStay[x.reservation_id] = x.room_number;
      });
      // Luot o hom nay: don dang o uu tien hon don vua tra phong.
      const mv: Record<string, MoveInfo> = {};
      stays.forEach((s) => {
        const roomNumber = roomOfStay[s.id];
        if (!roomNumber) return;
        const current =
          (s.status === "confirmed" || s.status === "in_house") &&
          s.checkIn <= today &&
          today < s.checkOut;
        const checkedOutToday = s.status === "checked_out" && s.checkOut === today;
        if (!current && !checkedOutToday) return;
        const prev = mv[roomNumber];
        if (prev && prev.kind !== "checkedout") return;
        if (current) {
          const kind: MoveKind =
            s.checkIn === today
              ? "arrival"
              : s.checkOut === today
                ? "departure"
                : "stayover";
          const label =
            kind === "arrival"
              ? "Khách đến"
              : kind === "departure"
                ? "Khách đi"
                : "Đang ở";
          mv[roomNumber] = { kind, label, guest: s.guestName };
        } else {
          mv[roomNumber] = { kind: "checkedout", label: "Đã trả phòng", guest: s.guestName };
        }
      });
      setMoves(mv);
      setLoading(false);
    })();
  }, [HOTEL_ID]);

  async function setHK(roomNumber: string, next: Room["housekeepingStatus"]) {
    setBusy(roomNumber);
    setDbError("");
    const { error } = await supabase
      .from("rooms")
      .update({ housekeeping_status: next })
      .eq("hotel_id", HOTEL_ID)
      .eq("number", roomNumber);
    setBusy(null);
    if (error) {
      setDbError(
        "Không đổi được trạng thái phòng: " +
          error.message +
          " — chạy file SQL 22 (HKBOARD) trong Supabase để mở quyền đổi trạng thái dọn phòng cho lễ tân / buồng phòng."
      );
      return;
    }
    setRooms((prev) =>
      prev.map((r) =>
        r.number === roomNumber ? { ...r, housekeepingStatus: next } : r
      )
    );
  }

  const counts = useMemo(() => {
    const c: Record<Room["housekeepingStatus"], number> = {
      clean: 0,
      dirty: 0,
      in_progress: 0,
      out_of_order: 0,
    };
    rooms.forEach((r) => {
      c[r.housekeepingStatus] += 1;
    });
    return c;
  }, [rooms]);
  const departuresToday = useMemo(
    () =>
      rooms.filter((r) => {
        const k = moves[r.number]?.kind;
        return k === "departure" || k === "checkedout";
      }).length,
    [rooms, moves]
  );

  const visible = useMemo(() => {
    const list = rooms.filter((r) => {
      if (filter !== "all" && r.housekeepingStatus !== filter) return false;
      if (onlyDepartures) {
        const k = moves[r.number]?.kind;
        if (k !== "departure" && k !== "checkedout") return false;
      }
      return true;
    });
    return [...list].sort(
      (a, b) =>
        MOVE_ORDER[moves[a.number]?.kind ?? "none"] -
          MOVE_ORDER[moves[b.number]?.kind ?? "none"] ||
        STATUS_ORDER[a.housekeepingStatus] - STATUS_ORDER[b.housekeepingStatus] ||
        compareRoomNumbers(a.number, b.number)
    );
  }, [rooms, moves, filter, onlyDepartures]);

  const chipCls = (active: boolean) =>
    `rounded-full border px-3 py-1.5 text-sm ${
      active
        ? "border-primary bg-primary font-semibold text-white"
        : "border-line bg-surface text-ink hover:border-primary"
    }`;

  if (loading) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-ink">Buồng phòng</h1>
        <p className="mt-2 text-sm text-muted">Đang tải danh sách phòng…</p>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-ink">Buồng phòng</h1>
      <p className="mt-1 text-sm text-muted">
        {hotelName} · Hôm nay {fmtDate(todayStr)} · {rooms.length} phòng ·{" "}
        <b className="text-danger">{counts.dirty} chưa dọn</b> ·{" "}
        {counts.in_progress} đang dọn · {counts.clean} sạch ·{" "}
        {counts.out_of_order} ngừng bán · {departuresToday} phòng trả hôm nay
      </p>
      <p className="mt-1 text-sm text-muted">
        Phòng trả hôm nay xếp lên đầu — dọn xong bấm “Dọn xong”, phòng sạch cho lễ
        tân gán. Chặn phòng theo ngày (bảo trì, chủ giữ) làm ở{" "}
        <Link href={`/${HOTEL_ID}/inventory`} className="text-primary underline">
          Chặn phòng &amp; Đóng bán
        </Link>
        .
      </p>

      {dbError && (
        <div className="mt-4 rounded-lg border border-danger bg-danger-soft p-3 text-sm text-danger">
          {dbError}
        </div>
      )}

      {/* Bo loc */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {(["all", "dirty", "in_progress", "clean", "out_of_order"] as const).map(
          (s) => (
            <button
              key={s}
              type="button"
              onClick={() => setFilter(s)}
              className={chipCls(filter === s)}
            >
              {s === "all"
                ? `Tất cả (${rooms.length})`
                : `${HK_LABELS[s]} (${counts[s]})`}
            </button>
          )
        )}
        <label className="ml-2 flex cursor-pointer items-center gap-1.5 text-sm text-ink">
          <input
            type="checkbox"
            checked={onlyDepartures}
            onChange={(e) => setOnlyDepartures(e.target.checked)}
          />
          Chỉ phòng trả hôm nay ({departuresToday})
        </label>
      </div>

      {/* Bang phong */}
      <div className="cb-card mt-4 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b-2 border-line text-left text-muted">
              <th className="px-4 py-3 font-semibold">Phòng</th>
              <th className="px-4 py-3 font-semibold">Loại phòng</th>
              <th className="px-4 py-3 font-semibold">Hôm nay</th>
              <th className="px-4 py-3 font-semibold">Khách</th>
              <th className="px-4 py-3 font-semibold">Trạng thái</th>
              <th className="px-4 py-3 text-right font-semibold">Đổi trạng thái</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-muted">
                  Không có phòng nào khớp bộ lọc.
                </td>
              </tr>
            )}
            {visible.map((r) => {
              const mv = moves[r.number] ?? { kind: "none" as MoveKind, label: "—", guest: "" };
              const next = NEXT_STEP[r.housekeepingStatus];
              const isBusy = busy === r.number;
              return (
                <tr
                  key={r.number}
                  className="border-b border-line last:border-0"
                >
                  <td className="px-4 py-3 font-bold text-ink">{r.number}</td>
                  <td className="px-4 py-3 text-ink">
                    {typeNames[r.roomTypeId] ?? r.roomTypeId}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-block rounded-full px-2.5 py-1 text-xs font-semibold ${MOVE_BADGE[mv.kind]}`}
                    >
                      {mv.label}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-ink">{mv.guest || "—"}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-block rounded-full px-2.5 py-1 text-xs font-semibold ${HK_BADGE[r.housekeepingStatus]}`}
                    >
                      {HK_LABELS[r.housekeepingStatus]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      {r.housekeepingStatus === "clean" ? (
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => setHK(r.number, "dirty")}
                          className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-ink hover:border-primary disabled:opacity-50"
                        >
                          Đánh dấu chưa dọn
                        </button>
                      ) : (
                        next && (
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => setHK(r.number, next.to)}
                            className="cb-btn-primary px-3 py-1.5 text-sm disabled:opacity-50"
                          >
                            {next.label}
                          </button>
                        )
                      )}
                      <select
                        value={r.housekeepingStatus}
                        disabled={isBusy}
                        onChange={(e) =>
                          setHK(r.number, e.target.value as Room["housekeepingStatus"])
                        }
                        className="rounded-lg border border-line bg-surface px-2 py-1.5 text-sm outline-none focus:border-primary disabled:opacity-50"
                        title="Đổi thẳng sang trạng thái khác"
                      >
                        {(Object.keys(HK_LABELS) as Room["housekeepingStatus"][]).map(
                          (s) => (
                            <option key={s} value={s}>
                              {HK_LABELS[s]}
                            </option>
                          )
                        )}
                      </select>
                    </div>
                    {r.housekeepingStatus === "out_of_order" && (
                      <div className="mt-1 text-xs text-muted">
                        Phòng này không bán được — sửa xong bấm “Đã sửa xong”, phòng
                        chuyển sang Chưa dọn để dọn lại trước khi bán.
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
