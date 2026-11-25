"use client";
// BASERATE1 — app/[hotelId]/rates/base/page.tsx (Gia goc / Base Rate)
// Trang rieng quan ly gia goc theo tung loai phong va tung giai doan.
// Ngay nao khong nam trong giai doan nao thi gia mac dinh la 0.
// Lich gia lay gia tu day de hien thi; Lich gia chi ghi de khoang
// ngay (luu vao rate_prices), khong sua duoc base rate o do.

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { currentHotelId } from "@/lib/current-hotel";
import { useParams } from "next/navigation";
import { useToast } from "@/components/Toast";
import { resolvePlanPrice, type RatePlan } from "@/lib/mock-data";
import { queueChannexDates, rangeDates } from "@/lib/channex-outbox";
import { writeAuditLog } from "@/lib/audit-log";
import { DatePicker } from "@/components/DatePicker";

const ACCOUNT_ID = "11111111-1111-1111-1111-111111111111";

type RoomType = { id: string; name: string; code?: string | null };
type Period = { id: string; roomTypeId: string; from: string; to: string; price: number };

const p2 = (n: number) => String(n).padStart(2, "0");
const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
};
const fmt = (n: number) => n.toLocaleString("vi-VN");
// Sap xep giai doan theo ngay bat dau, roi theo loai phong, roi ngay ket thuc
// (ham so sanh phai tra 0 khi bang nhau, neu khong thu tu se lech va
// nut Xac nhan cu hien la "co thay doi" du khong doi gi).
const byPeriod = (a: Period, b: Period) =>
  a.from < b.from ? -1 : a.from > b.from ? 1
  : a.roomTypeId < b.roomTypeId ? -1 : a.roomTypeId > b.roomTypeId ? 1
  : a.to < b.to ? -1 : a.to > b.to ? 1 : 0;
const fmtDate = (s: string) => {
  const [y, m, d] = s.split("-");
  return `${d}/${m}`;
};
// Gia goc cua 1 loai phong vao 1 ngay: giai doan nao chua ngay do thi lay
// gia cua no, khong co giai doan nao thi mac dinh la 0.
const priceOn = (periods: Period[], roomTypeId: string, date: string) => {
  const p = periods.find((x) => x.roomTypeId === roomTypeId && x.from <= date && date <= x.to);
  return p ? p.price : 0;
};

export default function BaseRatePage() {
  const params = useParams();
  const HOTEL_ID = typeof params.hotelId === "string" ? params.hotelId : currentHotelId();
  const [types, setTypes] = useState<RoomType[]>([]);
  const [periods, setPeriods] = useState<Period[]>([]);
  const [saved, setSaved] = useState<Period[]>([]);
  const [deletedIds, setDeletedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewDate, setViewDate] = useState(todayStr());
  const [saving, setSaving] = useState(false);
  const { showToast } = useToast();
  const [err, setErr] = useState("");
  const [plans, setPlans] = useState<RatePlan[]>([]);
  // Tick de khi luu gia goc thi xoa luon gia sua tay trong khoang vua doi,
  // de gia moi ap dung cho ca cac ngay da sua tay (mac dinh: giu nguyen gia sua tay).
  const [clearOverrides, setClearOverrides] = useState(false);
  // Form them giai doan (mo theo tung loai phong).
  const [addFor, setAddFor] = useState<string | null>(null);
  const [addFrom, setAddFrom] = useState("");
  const [addTo, setAddTo] = useState("");
  const [addPrice, setAddPrice] = useState("");
  // Form sua giai doan (mo theo tung giai doan, dien san gia tri hien tai).
  const [editId, setEditId] = useState<string | null>(null);
  const [editFrom, setEditFrom] = useState("");
  const [editTo, setEditTo] = useState("");
  const [editPrice, setEditPrice] = useState("");

  const dirty = useMemo(
    () => JSON.stringify(periods) !== JSON.stringify(saved) || deletedIds.length > 0,
    [periods, saved, deletedIds]
  );

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [HOTEL_ID]);

  async function loadAll(silent = false) {
    if (!silent) setLoading(true);
    setErr("");
    const [tRes, pRes, plRes] = await Promise.all([
      supabase.from("room_types").select("id, name, code").eq("hotel_id", HOTEL_ID).eq("account_id", ACCOUNT_ID).order("name"),
      supabase.from("base_rate_periods").select("id, room_type_id, from_date, to_date, price").eq("hotel_id", HOTEL_ID).eq("account_id", ACCOUNT_ID).order("from_date").order("room_type_id").order("to_date"),
      supabase.from("rate_plans").select("id, channel_code, room_type_id, name, cancellation_policy, public_name, meal_plan, base_occupancy, extra_adult_fee, extra_child_fee, derived_from_id, formula_id").eq("hotel_id", HOTEL_ID).eq("account_id", ACCOUNT_ID),
    ]);
    if (tRes.error) { setErr("Không tải được loại phòng: " + tRes.error.message); if (!silent) setLoading(false); return; }
    if (pRes.error) { setErr("Không tải được giai đoạn giá gốc: " + pRes.error.message); if (!silent) setLoading(false); return; }
    if (plRes.error) { setErr("Không tải được gói giá: " + plRes.error.message); if (!silent) setLoading(false); return; }
    setTypes((tRes.data ?? []) as RoomType[]);
    const list = ((pRes.data ?? []) as { id: string; room_type_id: string; from_date: string; to_date: string; price: number }[]).map((r) => ({
      id: r.id, roomTypeId: r.room_type_id, from: r.from_date, to: r.to_date, price: Number(r.price),
    }));
    setPeriods(list);
    setSaved(list);
    setDeletedIds([]);
    setPlans(((plRes.data ?? []) as { id: string; channel_code: string; room_type_id: string; name: string; cancellation_policy: string; public_name: string | null; meal_plan: string | null; base_occupancy: number | null; extra_adult_fee: number | null; extra_child_fee: number | null; derived_from_id: string | null; formula_id: string | null }[]).map((row) => ({
      id: row.id,
      channelCode: row.channel_code,
      roomTypeId: row.room_type_id,
      name: row.name,
      cancellationPolicy: row.cancellation_policy as RatePlan["cancellationPolicy"],
      prices: {},
      publicName: row.public_name ?? undefined,
      mealPlan: row.meal_plan as RatePlan["mealPlan"],
      baseOccupancy: row.base_occupancy ?? undefined,
      extraAdultFee: row.extra_adult_fee ?? undefined,
      extraChildFee: row.extra_child_fee ?? undefined,
      derivedFromId: row.derived_from_id ?? undefined,
      formulaId: row.formula_id ?? undefined,
    })));
    if (!silent) setLoading(false);
  }

  function openAdd(typeId: string) {
    setAddFor(typeId);
    setAddFrom(viewDate);
    setAddTo(viewDate);
    setAddPrice("");
    setErr("");
  }

  function submitAdd(typeId: string) {
    if (!addFrom || !addTo) { setErr("Chọn đủ ngày bắt đầu và ngày kết thúc."); return; }
    if (addTo < addFrom) { setErr("Ngày kết thúc phải sau ngày bắt đầu."); return; }
    const price = Number(addPrice.replace(/[^\d]/g, ""));
    if (!addPrice || price < 0) { setErr("Nhập giá cho giai đoạn (số tiền, tối thiểu 0)."); return; }
    // Chan giai doan trung nhau cua cung loai phong.
    const overlap = periods.some((p) => p.roomTypeId === typeId && !(addTo < p.from || addFrom > p.to));
    if (overlap) { setErr("Giai đoạn này trùng với 1 giai đoạn đã có của loại phòng này."); return; }
    setPeriods((prev) => [...prev, { id: `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, roomTypeId: typeId, from: addFrom, to: addTo, price }].sort(byPeriod));
    setAddFor(null);
    setAddPrice("");
    setErr("");
  }

  function openEdit(p: Period) {
    setEditId(p.id);
    setEditFrom(p.from);
    setEditTo(p.to);
    setEditPrice(String(p.price));
    setAddFor(null);
    setErr("");
  }

  function submitEdit(typeId: string) {
    if (!editId) return;
    if (!editFrom || !editTo) { setErr("Chọn đủ ngày bắt đầu và ngày kết thúc."); return; }
    if (editTo < editFrom) { setErr("Ngày kết thúc phải sau ngày bắt đầu."); return; }
    const price = Number(editPrice.replace(/[^\d]/g, ""));
    if (!editPrice || price < 0) { setErr("Nhập giá cho giai đoạn (số tiền, tối thiểu 0)."); return; }
    // Chan trung ngay voi giai doan KHAC cua cung loai phong (tru chinh no).
    const overlap = periods.some((p) => p.roomTypeId === typeId && p.id !== editId && !(editTo < p.from || editFrom > p.to));
    if (overlap) { setErr("Giai đoạn này trùng với 1 giai đoạn đã có của loại phòng này."); return; }
    // Giu nguyen id cu (khong tao tmp- moi) — confirmSave se doi chieu voi
    // ban da luu de cap nhat dung giai doan nay xuong DB.
    setPeriods((prev) => prev.map((p) => (p.id === editId ? { ...p, from: editFrom, to: editTo, price } : p)).sort(byPeriod));
    setEditId(null);
    setEditPrice("");
    setErr("");
  }

  function removePeriod(id: string) {
    const p = periods.find((x) => x.id === id);
    if (!p) return;
    setPeriods((prev) => prev.filter((x) => x.id !== id));
    if (!id.startsWith("tmp-")) setDeletedIds((prev) => [...prev, id]);
  }

  // Xoa gia sua tay (rate_prices) trong cac khoang giai doan vua doi, de gia
  // goc moi ap dung cho ca cac ngay da sua tay. Dong khong co han che thi
  // xoa han; dong co han che thi giu han che, chi cap nhat lai gia.
  async function clearOverridesInRanges(ranges: Period[]): Promise<{ cleared: number; kept: number; error: string | null }> {
    let cleared = 0;
    let kept = 0;
    let clearError: string | null = null;
    if (ranges.length === 0) return { cleared, kept, error: null };
    const byType = new Map<string, { from: string; to: string }[]>();
    for (const r of ranges) {
      const arr = byType.get(r.roomTypeId) ?? [];
      arr.push({ from: r.from, to: r.to });
      byType.set(r.roomTypeId, arr);
    }
    const changedDates = new Set<string>();
    for (const [typeId, typeRanges] of byType) {
      if (clearError) break;
      const typePlans = plans.filter((p) => p.roomTypeId === typeId);
      if (typePlans.length === 0) continue;
      const minFrom = typeRanges.reduce((m, r) => (r.from < m ? r.from : m), typeRanges[0].from);
      const maxTo = typeRanges.reduce((m, r) => (r.to > m ? r.to : m), typeRanges[0].to);
      const inRange = (d: string) => typeRanges.some((r) => r.from <= d && d <= r.to);
      let typeCleared = 0;
      let typeKept = 0;
      for (const plan of typePlans) {
        if (clearError) break;
        // Supabase tra toi da 1000 dong/lan — lay theo trang.
        type PriceRow = { rate_plan_id: string; date: string; price: number; min_stay: number | null; max_stay: number | null; stop_sell: boolean | null; cta: boolean | null; ctd: boolean | null };
        const rows: PriceRow[] = [];
        for (let from = 0; ; from += 1000) {
          const { data: page, error } = await supabase
            .from("rate_prices")
            .select("rate_plan_id, date, price, min_stay, max_stay, stop_sell, cta, ctd")
            .eq("rate_plan_id", plan.id)
            .gte("date", minFrom)
            .lte("date", maxTo)
            .range(from, from + 999);
          if (error) { clearError = "Không tải được giá sửa tay: " + error.message; break; }
          rows.push(...((page ?? []) as PriceRow[]));
          if (!page || page.length < 1000) break;
        }
        if (clearError) break;
        const toDelete: string[] = [];
        const toUpdate: { rate_plan_id: string; date: string; price: number; min_stay: number | null; max_stay: number | null; stop_sell: boolean; cta: boolean; ctd: boolean }[] = [];
        for (const row of rows) {
          if (!inRange(row.date)) continue;
          const hasRestriction = row.min_stay != null || row.max_stay != null || !!row.stop_sell || !!row.cta || !!row.ctd;
          if (!hasRestriction) {
            toDelete.push(row.date);
          } else {
            // Cot price NOT NULL nen khong xoa duoc dong co han che — ghi de
            // gia thanh gia tu tinh moi (gia goc + %), giu nguyen han che.
            const newPrice = resolvePlanPrice(plan, row.date, plans, undefined, periods) ?? 0;
            toUpdate.push({ rate_plan_id: row.rate_plan_id, date: row.date, price: newPrice, min_stay: row.min_stay, max_stay: row.max_stay, stop_sell: !!row.stop_sell, cta: !!row.cta, ctd: !!row.ctd });
          }
        }
        if (toDelete.length > 0) {
          const { error } = await supabase.from("rate_prices").delete().eq("rate_plan_id", plan.id).in("date", toDelete);
          if (error) { clearError = "Không xoá được giá sửa tay: " + error.message; break; }
          cleared += toDelete.length;
          typeCleared += toDelete.length;
          toDelete.forEach((d) => changedDates.add(d));
        }
        if (toUpdate.length > 0) {
          const { error } = await supabase.from("rate_prices").upsert(toUpdate, { onConflict: "rate_plan_id,date" });
          if (error) { clearError = "Không cập nhật được giá cho ngày có hạn chế: " + error.message; break; }
          kept += toUpdate.length;
          typeKept += toUpdate.length;
          toUpdate.forEach((r) => changedDates.add(r.date));
        }
      }
      if (clearError) break;
      if (typeCleared + typeKept > 0) {
        const typeName = types.find((t) => t.id === typeId)?.name ?? typeId;
        await writeAuditLog({
          hotelId: HOTEL_ID,
          accountId: ACCOUNT_ID,
          action: "price_updated",
          entityType: "rate_price",
          entityId: typeId,
          summary: `Áp giá gốc mới cho ${typeName} · ${fmtDate(minFrom)} – ${fmtDate(maxTo)}: xoá ${typeCleared} giá sửa tay${typeKept > 0 ? `, cập nhật ${typeKept} ngày có hạn chế` : ""}`,
          details: { roomTypeId: typeId, from: minFrom, to: maxTo, cleared: typeCleared, kept: typeKept },
        });
      }
    }
    // Day cac ngay trong khoang vua doi len Channex de dong bo gia moi.
    for (const r of ranges) for (const d of rangeDates(r.from, r.to)) changedDates.add(d);
    queueChannexDates([...changedDates], HOTEL_ID);
    return { cleared, kept, error: clearError };
  }

  async function confirmSave() {
    // Cho phep chay rieng khi chi tick o "Ap dung cho ca cac ngay da sua
    // tay" ma khong sua giai doan nao (truoc day nut Xac nhan mo vi dirty
    // = false nen o tick khong bao gio chay duoc — do la goc loi BASERATE3).
    if ((!dirty && !clearOverrides) || saving) return;
    setSaving(true);
    setErr("");
    const news = periods.filter((p) => p.id.startsWith("tmp-"));
    const deletedPeriods = saved.filter((p) => deletedIds.includes(p.id));
    // Giai doan da luu nhung bi sua (doi ngay/gia) — doi chieu voi ban da luu.
    const edited = periods.filter((p) => !p.id.startsWith("tmp-") && saved.some((s) => s.id === p.id && (s.from !== p.from || s.to !== p.to || s.price !== p.price)));
    const editedOld = saved.filter((s) => edited.some((p) => p.id === s.id));
    if (deletedIds.length > 0) {
      const { error } = await supabase.from("base_rate_periods").delete().in("id", deletedIds).eq("hotel_id", HOTEL_ID).eq("account_id", ACCOUNT_ID);
      if (error) { setErr("Không xoá được giai đoạn: " + error.message); setSaving(false); return; }
    }
    if (news.length > 0) {
      const rows = news.map((p) => ({ hotel_id: HOTEL_ID, account_id: ACCOUNT_ID, room_type_id: p.roomTypeId, from_date: p.from, to_date: p.to, price: p.price }));
      const { error } = await supabase.from("base_rate_periods").insert(rows);
      if (error) { setErr("Không lưu được giai đoạn mới: " + error.message); setSaving(false); return; }
    }
    if (edited.length > 0) {
      for (const p of edited) {
        const { error } = await supabase.from("base_rate_periods").update({ from_date: p.from, to_date: p.to, price: p.price }).eq("id", p.id).eq("hotel_id", HOTEL_ID).eq("account_id", ACCOUNT_ID);
        if (error) { setErr(`Không lưu được giai đoạn đã sửa (${fmtDate(p.from)} – ${fmtDate(p.to)}): ` + error.message); setSaving(false); return; }
      }
    }
    // Tick "Ap dung cho ca cac ngay da sua tay": xoa gia sua tay trong cac
    // khoang vua doi de gia goc moi ap dung cho ca cac ngay do. Neu chi tick
    // ma khong sua giai doan nao thi xoa cho cac giai doan HIEN CO. Giai doan
    // vua sua thi xoa ca khoang cu + khoang moi (gia cu khong con hieu luc).
    let cleared = 0;
    let kept = 0;
    let clearError: string | null = null;
    if (clearOverrides) {
      const ranges = dirty ? [...news, ...deletedPeriods, ...edited, ...editedOld] : [...saved];
      const res = await clearOverridesInRanges(ranges);
      cleared = res.cleared;
      kept = res.kept;
      clearError = res.error;
    }
    await loadAll(true);
    setSaving(false);
    setClearOverrides(false);
    if (clearError) setErr(clearError);
    const parts: string[] = [];
    if (news.length > 0) parts.push(`${news.length} giai đoạn mới`);
    if (edited.length > 0) parts.push(`${edited.length} giai đoạn đã sửa`);
    if (deletedIds.length > 0) parts.push(`${deletedIds.length} giai đoạn đã xoá`);
    let toast = parts.length > 0
      ? `Đã lưu thay đổi giá gốc (${parts.join(", ")}). Lịch giá và giá kênh OTA sẽ tự cập nhật.`
      : "Đã áp dụng giá gốc hiện tại. Lịch giá và giá kênh OTA sẽ tự cập nhật.";
    if (clearOverrides) {
      if (clearError) toast += " Xoá giá sửa tay chưa xong — xem lỗi ở trên.";
      else {
        if (cleared > 0) toast += ` Đã xoá ${cleared} giá sửa tay để áp giá gốc mới.`;
        if (kept > 0) toast += ` ${kept} ngày giữ nguyên giá vì đang có hạn chế.`;
        if (cleared === 0 && kept === 0) toast += " Không có giá sửa tay nào trong khoảng này.";
      }
    }
    showToast(toast);
  }

  if (loading) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-[var(--cb-text)]">Giá gốc (Base Rate)</h1>
        <p className="mt-4 text-sm text-[var(--cb-muted)]">Đang tải…</p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[var(--cb-text)]">Giá gốc (Base Rate)</h1>
          <p className="mt-1 text-sm text-[var(--cb-muted)]">
            Giá gốc theo loại phòng. Ngày không có giai đoạn thì giá là 0. Giá OTA tự tính từ giá này. Lịch giá lấy giá ở đây để hiển thị.
          </p>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <button
            onClick={confirmSave}
            disabled={(!dirty && !clearOverrides) || saving}
            className="cb-btn-primary px-5 py-2.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50"
            title={dirty || clearOverrides ? "Lưu các thay đổi vào cơ sở dữ liệu" : "Chưa có thay đổi nào để lưu"}
          >
            {saving ? "Đang lưu…" : "Xác nhận"}
          </button>
          <label className={`flex cursor-pointer items-center gap-1.5 text-xs text-ink ${saving ? "opacity-50" : ""}`}>
            <input
              type="checkbox"
              checked={clearOverrides}
              disabled={saving}
              onChange={(e) => setClearOverrides(e.target.checked)}
              className="h-3.5 w-3.5"
            />
            Áp dụng cho cả các ngày đã sửa tay (xoá giá sửa tay trong khoảng này)
          </label>
        </div>
      </div>

      {err && (
        <div className="mt-4 rounded-xl border border-danger/40 bg-danger-soft px-4 py-3 text-sm font-medium text-danger">{err}</div>
      )}
      {(dirty || clearOverrides) && !err && (
        <div className="mt-4 rounded-xl border border-line bg-primary-soft px-4 py-2.5 text-sm text-ink">
          {dirty
            ? <>Có thay đổi chưa lưu — bấm <b>Xác nhận</b> để lưu vào cơ sở dữ liệu.</>
            : <>Đã tick “Áp dụng cho cả các ngày đã sửa tay” — bấm <b>Xác nhận</b> để xoá giá sửa tay theo giá gốc hiện tại.</>}
        </div>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-2 text-sm text-ink">
        <span className="font-semibold">Xem ngày</span>
        <DatePicker value={viewDate} onChange={(v) => setViewDate(v || todayStr())} />
      </div>

      <div className="mt-4 space-y-4">
        {types.length === 0 && (
          <div className="rounded-xl border border-line bg-surface p-5 text-sm text-[var(--cb-muted)]">
            Chưa có loại phòng nào. Tạo loại phòng ở mục Thiết lập khách sạn → Loại phòng trước.
          </div>
        )}
        {types.map((t) => {
          const list = periods.filter((p) => p.roomTypeId === t.id).sort(byPeriod);
          const today = priceOn(periods, t.id, viewDate);
          const active = list.find((p) => p.from <= viewDate && viewDate <= p.to);
          const editing = editId ? list.find((p) => p.id === editId) ?? null : null;
          return (
            <div key={t.id} className="overflow-hidden rounded-xl border border-line bg-surface shadow-card">
              <div className="border-b border-[var(--nui-bg)] bg-primary-soft px-4 py-3">
                <span className="text-[15px] font-bold text-ink">{t.name}</span>
                {t.code ? <span className="ml-2 text-xs font-medium text-[var(--cb-muted)]">{t.code}</span> : null}
                <span className="ml-2 text-sm text-[var(--cb-muted)]">Ngày đang xem: <b className="text-ink">{fmt(today)}</b></span>
              </div>
              <table className="w-full text-sm text-ink">
                <thead>
                  <tr className="text-left text-xs text-[var(--cb-muted)]">
                    <th className="px-4 py-2 font-semibold">Giai đoạn</th>
                    <th className="px-4 py-2 text-right font-semibold">Giá / đêm</th>
                    <th className="w-32 px-4 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {list.length === 0 && (
                    <tr className="border-t border-[var(--nui-bg)]">
                      <td colSpan={3} className="px-4 py-3 text-[var(--cb-muted)]">Chưa có giai đoạn — giá là 0 cho đến khi thêm giai đoạn.</td>
                    </tr>
                  )}
                  {list.map((p) => (
                    <tr key={p.id} className="border-t border-[var(--nui-bg)]">
                      <td className="px-4 py-2.5">
                        {fmtDate(p.from)} – {fmtDate(p.to)}
                        {active?.id === p.id && (
                          <span className="ml-2 rounded-full bg-success-soft px-2 py-0.5 text-xs font-semibold text-success">đang áp dụng</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right font-semibold tabular-nums">{fmt(p.price)}</td>
                      <td className="px-4 py-2.5 text-right">
                        <span className="inline-flex gap-1.5">
                          <button onClick={() => openEdit(p)} className="rounded-lg border border-line px-2.5 py-1 text-xs font-semibold text-ink hover:bg-primary-soft hover:text-primary">Sửa</button>
                          <button onClick={() => removePeriod(p.id)} className="rounded-lg border border-line px-2.5 py-1 text-xs font-semibold text-ink hover:bg-danger-soft hover:text-danger">Xoá</button>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {editing ? (
                <div className="flex flex-wrap items-center gap-2 border-t border-[var(--nui-bg)] bg-primary-soft/50 px-4 py-3 text-sm text-ink">
                  <span className="font-semibold">Sửa giai đoạn</span>
                  <label className="font-medium">Từ</label>
                  <DatePicker value={editFrom} onChange={setEditFrom} />
                  <label className="font-medium">Đến</label>
                  <DatePicker value={editTo} onChange={setEditTo} min={editFrom} rangeStart={editFrom} />
                  <label className="font-medium">Giá</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={editPrice === "" ? "" : fmt(Number(editPrice))}
                    onChange={(e) => setEditPrice(e.target.value.replace(/[^\d]/g, ""))}
                    placeholder="Nhập giá"
                    className="cb-input-pill w-36 px-2 py-1.5 text-right font-semibold"
                  />
                  <span className="text-[var(--cb-muted)]">VND</span>
                  <button onClick={() => submitEdit(t.id)} className="cb-btn-primary px-4 py-1.5 text-sm">Lưu</button>
                  <button onClick={() => { setEditId(null); setErr(""); }} className="cb-btn-ghost px-3 py-1.5 text-sm">Huỷ</button>
                  <span className="w-full text-xs text-[var(--cb-muted)]">Lưu vào danh sách tạm — bấm Xác nhận ở trên để lưu vào cơ sở dữ liệu.</span>
                </div>
              ) : addFor === t.id ? (
                <div className="flex flex-wrap items-center gap-2 border-t border-[var(--nui-bg)] bg-primary-soft/50 px-4 py-3 text-sm text-ink">
                  <label className="font-medium">Từ</label>
                  <DatePicker value={addFrom} onChange={setAddFrom} />
                  <label className="font-medium">Đến</label>
                  <DatePicker value={addTo} onChange={setAddTo} min={addFrom} rangeStart={addFrom} />
                  <label className="font-medium">Giá</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={addPrice === "" ? "" : fmt(Number(addPrice))}
                    onChange={(e) => setAddPrice(e.target.value.replace(/[^\d]/g, ""))}
                    placeholder="Nhập giá"
                    className="cb-input-pill w-36 px-2 py-1.5 text-right font-semibold"
                  />
                  <span className="text-[var(--cb-muted)]">VND</span>
                  <button onClick={() => submitAdd(t.id)} className="cb-btn-primary px-4 py-1.5 text-sm">Thêm</button>
                  <button onClick={() => { setAddFor(null); setErr(""); }} className="cb-btn-ghost px-3 py-1.5 text-sm">Huỷ</button>
                </div>
              ) : (
                <div className="border-t border-[var(--nui-bg)] px-4 py-3">
                  <button onClick={() => openAdd(t.id)} className="cb-btn-ghost px-3 py-1.5 text-sm font-semibold">+ Thêm giai đoạn</button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <p className="mt-4 text-xs text-[var(--cb-muted)]">
        Thay đổi (thêm/sửa/xoá giai đoạn) chỉ lưu khi bấm <b>Xác nhận</b>. Lịch giá vẫn sửa được theo kiểu ghi đè khoảng ngày (giá sửa tay), nhưng không sửa được base rate ở đó — muốn đổi base rate thì sửa ở trang này.
      </p>
    </div>
  );
}
