"use client";
// OTA1 — app/[hotelId]/rates/ota/page.tsx (Gia kenh OTA)
// Trang rieng dat % cong them cho tung kenh OTA va tung loai phong.
// Gia kenh = gia goc + %. Lich gia lay gia tu day de hien thi.
// % luu o formula_id cua goi suy ra trong rate_plans (1 goi cho
// moi cap kenh x loai phong) — doi % la doi formula_id cua goi do.
//
// Luu y logic:
// - % dang sua duoc giu theo tung kenh (drafts): doi kenh qua lai
//   khong lam mat % chua xac nhan cua kenh cu.
// - Chi nap % tu goi gia khi mo trang va khi doi kenh (khong nap
//   lai khi plans thay doi trong luc luu, de tranh ghi de % dang sua).

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { currentHotelId } from "@/lib/current-hotel";
import { useParams } from "next/navigation";
import { useToast } from "@/components/Toast";
import { DatePicker } from "@/components/DatePicker";
import { CHANNELS, CHANNEL_FORMULA, getFormula, applyFormula } from "@/lib/mock-data";
import { queueChannexDates } from "@/lib/channex-outbox";
import { writeAuditLog } from "@/lib/audit-log";

const ACCOUNT_ID = "11111111-1111-1111-1111-111111111111";
const OTA_CHANNELS = CHANNELS.filter((c) => c.type === "ota");

type RoomType = { id: string; name: string; code?: string | null };
type Plan = { id: string; channelCode: string; roomTypeId: string; formulaId?: string | null; derivedFromId?: string | null };
type Period = { id: string; roomTypeId: string; from: string; to: string; price: number };

const fmt = (n: number) => n.toLocaleString("vi-VN");
const p2 = (n: number) => String(n).padStart(2, "0");
const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
};
// Gia goc cua 1 loai phong vao 1 ngay (0 neu khong co giai doan nao chua ngay do).
const basePriceOn = (periods: Period[], typeId: string, date: string) => {
  const pd = periods.find((x) => x.roomTypeId === typeId && x.from <= date && date <= x.to);
  return pd ? pd.price : 0;
};
// Gia kenh tu tinh tu gia goc + % (lam tron toi 1000, giong applyFormula).
const derivedPrice = (base: number, pct: number) =>
  pct === 0 ? base : applyFormula(base, { id: formulaIdForPct(pct) ?? "", name: "", kind: "percent", value: pct });
const fmtDate = (s: string) => {
  const [y, m, d] = s.split("-");
  return `${d}/${m}`;
};
// % mac dinh cua kenh (khi chua co goi suy ra nao cho cap do).
const defaultPct = (channelCode: string) => {
  const f = getFormula(CHANNEL_FORMULA[channelCode]);
  return f && f.kind === "percent" ? f.value : 0;
};
const formulaIdForPct = (pct: number) =>
  pct > 0 ? `f-plus${pct}` : pct < 0 ? `f-minus${-pct}` : null;
// % hien tai cua 1 cap (kenh x loai phong): lay tu goi suy ra neu co,
// chua co goi thi lay % mac dinh cua kenh.
const pctOfPlan = (plans: Plan[], channelCode: string, typeId: string) => {
  const plan = plans.find((p) => p.channelCode === channelCode && p.roomTypeId === typeId);
  const f = getFormula(plan?.formulaId ?? undefined);
  return f && f.kind === "percent" ? f.value : defaultPct(channelCode);
};
// Bang % cua 1 kenh theo tung loai phong.
const pctMapFor = (plans: Plan[], types: RoomType[], channelCode: string) => {
  const next: Record<string, number> = {};
  for (const t of types) next[t.id] = pctOfPlan(plans, channelCode, t.id);
  return next;
};

export default function OtaPage() {
  const params = useParams();
  const HOTEL_ID = typeof params.hotelId === "string" ? params.hotelId : currentHotelId();
  const [types, setTypes] = useState<RoomType[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [periods, setPeriods] = useState<Period[]>([]);
  const [channel, setChannel] = useState("booking_com");
  const [pct, setPct] = useState<Record<string, number>>({});
  const [savedPct, setSavedPct] = useState<Record<string, number>>({});
  // Ban nhap % chua xac nhan, giu theo tung kenh.
  const [drafts, setDrafts] = useState<Record<string, Record<string, number>>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const { showToast } = useToast();
  const [err, setErr] = useState("");
  // Tick de khi luu % moi thi xoa luon gia sua tay cua kenh nay (mac dinh: giu nguyen).
  const [clearOverrides, setClearOverrides] = useState(false);
  // Ngay dung de xem truoc gia kenh trong bang % (live preview).
  const [viewDate, setViewDate] = useState(todayStr());

  const dirty = useMemo(() => JSON.stringify(pct) !== JSON.stringify(savedPct), [pct, savedPct]);
  const changedCount = useMemo(
    () => types.filter((t) => (pct[t.id] ?? defaultPct(channel)) !== (savedPct[t.id] ?? defaultPct(channel))).length,
    [pct, savedPct, types, channel]
  );

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [HOTEL_ID]);

  // Doi kenh: cat ban nhap cua kenh cu (neu co thay doi chua luu),
  // roi nap kenh moi — uu tien ban nhap da co, neu khong thi lay tu goi gia.
  function changeChannel(next: string) {
    if (next === channel) return;
    setClearOverrides(false);
    if (dirty) setDrafts((prev) => ({ ...prev, [channel]: { ...pct } }));
    const saved = pctMapFor(plans, types, next);
    setPct(drafts[next] ?? saved);
    setSavedPct(saved);
    setChannel(next);
  }

  async function loadAll() {
    setLoading(true);
    setErr("");
    const [tRes, plRes, pRes] = await Promise.all([
      supabase.from("room_types").select("id, name, code").eq("hotel_id", HOTEL_ID).eq("account_id", ACCOUNT_ID).order("name"),
      supabase.from("rate_plans").select("id, channel_code, room_type_id, formula_id, derived_from_id").eq("hotel_id", HOTEL_ID).eq("account_id", ACCOUNT_ID),
      supabase.from("base_rate_periods").select("id, room_type_id, from_date, to_date, price").eq("hotel_id", HOTEL_ID).eq("account_id", ACCOUNT_ID).order("from_date"),
    ]);
    if (tRes.error) { setErr("Không tải được loại phòng: " + tRes.error.message); setLoading(false); return; }
    if (plRes.error) { setErr("Không tải được gói giá: " + plRes.error.message); setLoading(false); return; }
    if (pRes.error) { setErr("Không tải được giai đoạn giá gốc: " + pRes.error.message); setLoading(false); return; }
    const typeList = (tRes.data ?? []) as RoomType[];
    const planList = ((plRes.data ?? []) as { id: string; channel_code: string; room_type_id: string; formula_id: string | null; derived_from_id: string | null }[]).map((r) => ({
      id: r.id, channelCode: r.channel_code, roomTypeId: r.room_type_id, formulaId: r.formula_id, derivedFromId: r.derived_from_id,
    }));
    setTypes(typeList);
    setPlans(planList);
    setPeriods(((pRes.data ?? []) as { id: string; room_type_id: string; from_date: string; to_date: string; price: number }[]).map((r) => ({
      id: r.id, roomTypeId: r.room_type_id, from: r.from_date, to: r.to_date, price: Number(r.price),
    })));
    // Nap % cua kenh mac dinh ngay tu du lieu vua tai ve.
    const init = pctMapFor(planList, typeList, channel);
    setPct(init);
    setSavedPct(init);
    setDrafts({});
    setLoading(false);
  }

  // Dam bao co goi Website (goc) cho loai phong — goi suy ra tro ve no.
  async function ensureWebsitePlan(typeId: string): Promise<string | undefined> {
    const ex = plans.find((p) => p.channelCode === "website" && p.roomTypeId === typeId);
    if (ex) return ex.id;
    const id = `plan-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const { error } = await supabase.from("rate_plans").insert({
      id, hotel_id: HOTEL_ID, account_id: ACCOUNT_ID,
      room_type_id: typeId, channel_code: "website",
      name: "Website", cancellation_policy: "flexible", meal_plan: "room_only", policy_id: null,
      derived_from_id: null, formula_id: null,
    });
    if (error) { setErr("Không tạo được gói gốc Website: " + error.message); return undefined; }
    setPlans((prev) => [...prev, { id, channelCode: "website", roomTypeId: typeId, formulaId: null, derivedFromId: null }]);
    return id;
  }

  // Xoa gia sua tay (rate_prices) cua kenh dang chon cho cac loai phong da
  // doi %, de % moi ap dung cho ca cac ngay da sua tay. Dong khong co han
  // che thi xoa han; dong co han che thi giu han che, chi cap nhat lai gia
  // theo % moi (tinh truc tiep tu gia goc + % moi, khong doc lai plans vi
  // state plans chua kip cap nhat formula_id trong luc luu).
  async function clearOverridesForChannel(typeIds: string[], newPct: Record<string, number>): Promise<{ cleared: number; kept: number; error: string | null }> {
    let cleared = 0;
    let kept = 0;
    let clearError: string | null = null;
    const chName = OTA_CHANNELS.find((c) => c.code === channel)?.name ?? channel;
    const changedDates = new Set<string>();
    for (const typeId of typeIds) {
      if (clearError) break;
      const plan = plans.find((p) => p.channelCode === channel && p.roomTypeId === typeId);
      if (!plan) continue;
      const pct = newPct[typeId] ?? defaultPct(channel);
      type PriceRow = { rate_plan_id: string; date: string; price: number; min_stay: number | null; max_stay: number | null; stop_sell: boolean | null; cta: boolean | null; ctd: boolean | null };
      const rows: PriceRow[] = [];
      // % ap dung cho moi ngay nen khong gioi han khoang ngay — lay theo trang.
      for (let from = 0; ; from += 1000) {
        const { data: page, error } = await supabase
          .from("rate_prices")
          .select("rate_plan_id, date, price, min_stay, max_stay, stop_sell, cta, ctd")
          .eq("rate_plan_id", plan.id)
          .order("date")
          .range(from, from + 999);
        if (error) { clearError = "Không tải được giá sửa tay: " + error.message; break; }
        rows.push(...((page ?? []) as PriceRow[]));
        if (!page || page.length < 1000) break;
      }
      if (clearError) break;
      const toDelete: string[] = [];
      const toUpdate: { rate_plan_id: string; date: string; price: number; min_stay: number | null; max_stay: number | null; stop_sell: boolean; cta: boolean; ctd: boolean }[] = [];
      for (const row of rows) {
        const hasRestriction = row.min_stay != null || row.max_stay != null || !!row.stop_sell || !!row.cta || !!row.ctd;
        if (!hasRestriction) {
          toDelete.push(row.date);
        } else {
          // Cot price NOT NULL nen khong xoa duoc dong co han che — ghi de
          // gia thanh gia tu tinh moi (gia goc + % moi), giu nguyen han che.
          toUpdate.push({ rate_plan_id: row.rate_plan_id, date: row.date, price: derivedPrice(basePriceOn(periods, typeId, row.date), pct), min_stay: row.min_stay, max_stay: row.max_stay, stop_sell: !!row.stop_sell, cta: !!row.cta, ctd: !!row.ctd });
        }
      }
      if (toDelete.length > 0) {
        const { error } = await supabase.from("rate_prices").delete().eq("rate_plan_id", plan.id).in("date", toDelete);
        if (error) { clearError = "Không xoá được giá sửa tay: " + error.message; break; }
        cleared += toDelete.length;
        toDelete.forEach((d) => changedDates.add(d));
      }
      if (toUpdate.length > 0) {
        const { error } = await supabase.from("rate_prices").upsert(toUpdate, { onConflict: "rate_plan_id,date" });
        if (error) { clearError = "Không cập nhật được giá cho ngày có hạn chế: " + error.message; break; }
        kept += toUpdate.length;
        toUpdate.forEach((r) => changedDates.add(r.date));
      }
      if (toDelete.length + toUpdate.length > 0) {
        const typeName = types.find((t) => t.id === typeId)?.name ?? typeId;
        await writeAuditLog({
          hotelId: HOTEL_ID,
          accountId: ACCOUNT_ID,
          action: "price_updated",
          entityType: "rate_price",
          entityId: typeId,
          summary: `Đổi % ${chName} cho ${typeName} (${pct > 0 ? "+" : ""}${pct}%): xoá ${toDelete.length} giá sửa tay${toUpdate.length > 0 ? `, cập nhật ${toUpdate.length} ngày có hạn chế` : ""}`,
          details: { roomTypeId: typeId, channel, pct, cleared: toDelete.length, kept: toUpdate.length },
        });
      }
    }
    queueChannexDates([...changedDates], HOTEL_ID);
    return { cleared, kept, error: clearError };
  }

  async function confirmSave() {
    if (!dirty || saving) return;
    setSaving(true);
    setErr("");
    // % <= -100% thi gia kenh <= 0 (am hoac bang 0) — khong hop le.
    for (const t of types) {
      const next = pct[t.id];
      if (next !== savedPct[t.id] && next <= -100) {
        setErr(`% của ${t.name} phải lớn hơn -100% (nếu không giá kênh sẽ bằng 0 hoặc âm).`);
        setSaving(false);
        return;
      }
    }
    const chName = OTA_CHANNELS.find((c) => c.code === channel)?.name ?? channel;
    let changed = 0;
    for (const t of types) {
      const next = pct[t.id];
      const cur = savedPct[t.id];
      if (next === cur) continue;
      const plan = plans.find((p) => p.channelCode === channel && p.roomTypeId === t.id);
      const formulaId = formulaIdForPct(next);
      if (plan) {
        const { error } = await supabase.from("rate_plans").update({ formula_id: formulaId }).eq("id", plan.id).eq("hotel_id", HOTEL_ID).eq("account_id", ACCOUNT_ID);
        if (error) { setErr(`Không lưu được % của ${t.name}: ` + error.message); setSaving(false); return; }
        setPlans((prev) => prev.map((p) => (p.id === plan.id ? { ...p, formulaId } : p)));
      } else {
        const webId = await ensureWebsitePlan(t.id);
        if (!webId) { setSaving(false); return; }
        const id = `plan-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const { error } = await supabase.from("rate_plans").insert({
          id, hotel_id: HOTEL_ID, account_id: ACCOUNT_ID,
          room_type_id: t.id, channel_code: channel,
          name: chName, cancellation_policy: "flexible", meal_plan: "room_only", policy_id: null,
          derived_from_id: webId, formula_id: formulaId,
        });
        if (error) { setErr(`Không tạo được gói ${chName} cho ${t.name}: ` + error.message); setSaving(false); return; }
        setPlans((prev) => [...prev, { id, channelCode: channel, roomTypeId: t.id, formulaId, derivedFromId: webId }]);
      }
      changed += 1;
    }
    // Tick "Ap dung cho ca cac ngay da sua tay": xoa gia sua tay cua kenh nay
    // cho cac loai phong vua doi % (chi cac loai da doi, khong dung loai khac).
    const changedTypeIds = types.filter((t) => pct[t.id] !== savedPct[t.id]).map((t) => t.id);
    let cleared = 0;
    let kept = 0;
    let clearError: string | null = null;
    if (clearOverrides && changedTypeIds.length > 0) {
      const res = await clearOverridesForChannel(changedTypeIds, pct);
      cleared = res.cleared;
      kept = res.kept;
      clearError = res.error;
    }
    setSavedPct({ ...pct });
    // Kenh nay da luu xong — xoa ban nhap cua no.
    setDrafts((prev) => {
      const next = { ...prev };
      delete next[channel];
      return next;
    });
    setSaving(false);
    setClearOverrides(false);
    if (clearError) setErr(clearError);
    let toast = `Đã lưu % của ${chName} cho ${changed} loại phòng. Giá kênh sẽ tự tính lại từ giá gốc.`;
    if (clearOverrides) {
      if (clearError) toast += " Xoá giá sửa tay chưa xong — xem lỗi ở trên.";
      else {
        if (cleared > 0) toast += ` Đã xoá ${cleared} giá sửa tay để áp % mới.`;
        if (kept > 0) toast += ` ${kept} ngày giữ nguyên giá vì đang có hạn chế.`;
        if (cleared === 0 && kept === 0) toast += " Không có giá sửa tay nào cho kênh này.";
      }
    }
    showToast(toast);
  }

  if (loading) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-[var(--cb-text)]">Giá kênh OTA</h1>
        <p className="mt-4 text-sm text-[var(--cb-muted)]">Đang tải…</p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[var(--cb-text)]">Giá kênh OTA</h1>
          <p className="mt-1 text-sm text-[var(--cb-muted)]">
            Đặt % cộng thêm cho từng kênh và từng loại phòng. Giá kênh = giá gốc + %. Lịch giá lấy giá ở đây để hiển thị.
          </p>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <button
            onClick={confirmSave}
            disabled={!dirty || saving}
            className="cb-btn-primary px-5 py-2.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50"
            title={dirty ? "Lưu các % đã đổi vào cơ sở dữ liệu" : "Chưa có thay đổi nào để lưu"}
          >
            {saving ? "Đang lưu…" : "Xác nhận"}
          </button>
          <label className={`flex cursor-pointer items-center gap-1.5 text-xs text-ink ${!dirty || saving ? "opacity-50" : ""}`}>
            <input
              type="checkbox"
              checked={clearOverrides}
              disabled={!dirty || saving}
              onChange={(e) => setClearOverrides(e.target.checked)}
              className="h-3.5 w-3.5"
            />
            Áp dụng cho cả các ngày đã sửa tay (xoá giá sửa tay của kênh này)
          </label>
        </div>
      </div>

      {err && (
        <div className="mt-4 rounded-xl border border-danger/40 bg-danger-soft px-4 py-3 text-sm font-medium text-danger">{err}</div>
      )}
      {dirty && !err && (
        <div className="mt-4 rounded-xl border border-line bg-primary-soft px-4 py-2.5 text-sm text-ink">
          Có thay đổi chưa lưu — bấm <b>Xác nhận</b> để lưu vào cơ sở dữ liệu.
        </div>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-2 text-sm text-ink">
        <label htmlFor="ota-channel" className="font-semibold">Giá cho OTA</label>
        <select
          id="ota-channel"
          value={channel}
          onChange={(e) => changeChannel(e.target.value)}
          className="cb-input-pill px-3 py-2"
        >
          {OTA_CHANNELS.map((c) => (
            <option key={c.code} value={c.code}>{c.name}</option>
          ))}
        </select>
        <span className="ml-3 font-semibold">Ngày đang xem</span>
        <DatePicker value={viewDate} onChange={(v) => setViewDate(v || todayStr())} />
      </div>

      {/* Bang % tong hop: 1 dong 1 loai phong, gia kenh xem truoc truc tiep khi go % */}
      <div className="mt-4 overflow-hidden rounded-xl border border-line bg-surface shadow-card">
        <div className="flex flex-wrap items-center gap-2 border-b border-[var(--nui-bg)] bg-primary-soft px-4 py-2.5 text-sm text-ink">
          <span className="font-bold">{OTA_CHANNELS.find((c) => c.code === channel)?.name ?? channel}</span>
          <span className="text-[var(--cb-muted)]">· % mặc định {defaultPct(channel) > 0 ? "+" : ""}{defaultPct(channel)}%</span>
          {changedCount > 0 && (
            <span className="rounded-full bg-primary-soft px-2 py-0.5 text-xs font-semibold text-primary">{changedCount} loại phòng đã đổi % (chưa xác nhận)</span>
          )}
          <span className="ml-auto text-xs text-[var(--cb-muted)]">Giá kênh tính từ giá gốc ngày {fmtDate(viewDate)}</span>
        </div>
        <table className="w-full text-sm text-ink">
          <thead>
            <tr className="text-left text-xs text-[var(--cb-muted)]">
              <th className="px-4 py-2 font-semibold">Loại phòng</th>
              <th className="px-4 py-2 text-right font-semibold">Giá gốc hiện tại</th>
              <th className="px-4 py-2 text-right font-semibold">% cộng thêm</th>
              <th className="px-4 py-2 text-right font-semibold">Giá kênh</th>
            </tr>
          </thead>
          <tbody>
            {types.length === 0 && (
              <tr className="border-t border-[var(--nui-bg)]">
                <td colSpan={4} className="px-4 py-3 text-[var(--cb-muted)]">Chưa có loại phòng nào. Tạo loại phòng ở mục Thiết lập khách sạn → Loại phòng trước.</td>
              </tr>
            )}
            {types.map((t) => {
              const base = basePriceOn(periods, t.id, viewDate);
              const p = pct[t.id] ?? defaultPct(channel);
              const changed = p !== (savedPct[t.id] ?? defaultPct(channel));
              return (
                <tr key={t.id} className="border-t border-[var(--nui-bg)]">
                  <td className="px-4 py-2.5 font-semibold">
                    {t.name}
                    {t.code ? <span className="ml-2 text-xs font-medium text-[var(--cb-muted)]">{t.code}</span> : null}
                    {changed && <span className="ml-2 rounded-full bg-primary-soft px-2 py-0.5 text-xs font-semibold text-primary">đã đổi</span>}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{fmt(base)}</td>
                  <td className="px-4 py-2.5 text-right">
                    <span className="inline-flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setPct((prev) => ({ ...prev, [t.id]: Math.max(-99, p - 1) }))}
                        className="flex h-7 w-7 items-center justify-center rounded-full border border-line bg-surface text-sm font-bold text-ink hover:border-primary hover:text-primary"
                        title="Giảm 1%"
                      >
                        −
                      </button>
                      <input
                        id={`ota-pct-${t.id}`}
                        type="number"
                        value={p}
                        onChange={(e) => setPct((prev) => ({ ...prev, [t.id]: Number(e.target.value) || 0 }))}
                        className="cb-input-pill w-20 px-2 py-1.5 text-right font-semibold [-moz-appearance:textfield] [appearance:textfield] [&::-webkit-outer-spin-button]:m-0 [&::-webkit-outer-spin-button]:[-webkit-appearance:none] [&::-webkit-inner-spin-button]:m-0 [&::-webkit-inner-spin-button]:[-webkit-appearance:none]"
                      />
                      <button
                        type="button"
                        onClick={() => setPct((prev) => ({ ...prev, [t.id]: p + 1 }))}
                        className="flex h-7 w-7 items-center justify-center rounded-full border border-line bg-surface text-sm font-bold text-ink hover:border-primary hover:text-primary"
                        title="Tăng 1%"
                      >
                        +
                      </button>
                      <span className="font-semibold">%</span>
                    </span>
                  </td>
                  <td className={`px-4 py-2.5 text-right font-semibold tabular-nums ${derivedPrice(base, p) <= 0 ? "text-danger" : ""}`}>{fmt(derivedPrice(base, p))}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-4 space-y-4">
        {types.length === 0 && (
          <div className="rounded-xl border border-line bg-surface p-5 text-sm text-[var(--cb-muted)]">
            Chưa có loại phòng nào. Tạo loại phòng ở mục Thiết lập khách sạn → Loại phòng trước.
          </div>
        )}
        {types.map((t) => {
          const list = periods.filter((p) => p.roomTypeId === t.id).sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
          const p = pct[t.id] ?? defaultPct(channel);
          return (
            <div key={t.id} className="overflow-hidden rounded-xl border border-line bg-surface shadow-card">
              <div className="border-b border-[var(--nui-bg)] bg-primary-soft px-4 py-3">
                <span className="text-[15px] font-bold text-ink">{t.name}</span>
                {t.code ? <span className="ml-2 text-xs font-medium text-[var(--cb-muted)]">{t.code}</span> : null}
                <span className="ml-2 text-sm text-[var(--cb-muted)]">Giá kênh ngày {fmtDate(viewDate)}: <b className="text-ink">{fmt(derivedPrice(basePriceOn(periods, t.id, viewDate), p))}</b></span>
              </div>
              <table className="w-full text-sm text-ink">
                <thead>
                  <tr className="text-left text-xs text-[var(--cb-muted)]">
                    <th className="px-4 py-2 font-semibold">Giai đoạn</th>
                    <th className="px-4 py-2 text-right font-semibold">Giá gốc</th>
                    <th className="px-4 py-2 text-right font-semibold">Giá kênh</th>
                  </tr>
                </thead>
                <tbody>
                  {list.length === 0 && (
                    <tr className="border-t border-[var(--nui-bg)]">
                      <td colSpan={3} className="px-4 py-3 text-[var(--cb-muted)]">Chưa có giai đoạn giá gốc — thêm giai đoạn ở trang Giá gốc (Base Rate) trước.</td>
                    </tr>
                  )}
                  {list.map((pd) => {
                    const derived = p === 0 ? pd.price : applyFormula(pd.price, { id: formulaIdForPct(p) ?? "", name: "", kind: "percent", value: p });
                    return (
                      <tr key={pd.id} className="border-t border-[var(--nui-bg)]">
                        <td className="px-4 py-2.5">{fmtDate(pd.from)} – {fmtDate(pd.to)}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{fmt(pd.price)}</td>
                        <td className="px-4 py-2.5 text-right font-semibold tabular-nums">{fmt(derived)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          );
        })}
      </div>

      <p className="mt-4 text-xs text-[var(--cb-muted)]">
        Thay đổi chỉ lưu khi bấm <b>Xác nhận</b>. Đổi % ở đây đổi cho đúng loại phòng đó ở đúng kênh đang chọn — các loại phòng và kênh khác không bị ảnh hưởng. Ngày ngoài giai đoạn giá gốc thì giá gốc là 0 nên giá kênh cũng là 0.
      </p>
    </div>
  );
}
