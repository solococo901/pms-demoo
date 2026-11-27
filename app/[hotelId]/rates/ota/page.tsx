"use client";
// OTA8 — app/[hotelId]/rates/ota/page.tsx (Gia kenh ban)
// Moi kenh (Website dung dau, roi OTA) x moi loai phong tu chon 1 trong
// 2 cach tinh: "Ke thua gia goc" (gia = gia goc) hoac "Theo %" (gia =
// gia goc + %). % ap truc tiep vao gia goc, khong cong don. % luu o
// formula_id cua goi gia (null = ke thua). Gia sua tay thang %.

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { currentHotelId } from "@/lib/current-hotel";
import { useParams } from "next/navigation";
import { useToast } from "@/components/Toast";
import { DatePicker } from "@/components/DatePicker";
import { CHANNELS, getFormula, applyFormula } from "@/lib/mock-data";
import { queueChannexDates } from "@/lib/channex-outbox";
import { writeAuditLog } from "@/lib/audit-log";

const ACCOUNT_ID = "11111111-1111-1111-1111-111111111111";
// Website dung dau, roi cac kenh OTA.
const PRICE_CHANNELS = [
  CHANNELS.find((c) => c.code === "website")!,
  ...CHANNELS.filter((c) => c.type === "ota"),
];
const QUICK_PCTS = [5, 10, 15, -10];

type RoomType = { id: string; name: string; code?: string | null };
type Plan = { id: string; channelCode: string; roomTypeId: string; formulaId?: string | null; derivedFromId?: string | null };
type Period = { id: string; roomTypeId: string; from: string; to: string; price: number };
// Che do tinh gia cua 1 cap (kenh x loai phong).
type Mode = "inherit" | "pct";
// Ban nhap chua xac nhan, giu theo tung kenh.
type Draft = { mode: Mode; pct: number };
type PriceRow = { rate_plan_id: string; date: string; price: number | null; min_stay: number | null; max_stay: number | null; stop_sell: boolean | null; cta: boolean | null; ctd: boolean | null };

const fmt = (n: number) => n.toLocaleString("vi-VN");
const p2 = (n: number) => String(n).padStart(2, "0");
const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
};
const fmtShort = (s: string) => {
  const [y, m, d] = s.split("-");
  return `${d}/${m}`;
};
const fmtDate = (s: string) => {
  const [y, m, d] = s.split("-");
  return `${d}/${m}/${y}`;
};
// Gia goc cua 1 loai phong vao 1 ngay (0 neu khong co giai doan nao chua ngay do).
const basePriceOn = (periods: Period[], typeId: string, date: string) => {
  const pd = periods.find((x) => x.roomTypeId === typeId && x.from <= date && date <= x.to);
  return pd ? pd.price : 0;
};
const formulaIdForPct = (pct: number) =>
  pct > 0 ? `f-plus${pct}` : pct < 0 ? `f-minus${-pct}` : null;
// % cua 1 goi (null = ke thua gia goc).
const pctOfPlan = (plan: Plan | undefined) => {
  const f = getFormula(plan?.formulaId ?? undefined);
  return f && f.kind === "percent" ? f.value : 0;
};
const modeOfPlan = (plan: Plan | undefined): Mode => (plan?.formulaId ? "pct" : "inherit");
// Gia kenh tinh tu gia goc + % (lam tron toi 1000, giong applyFormula).
const channelPrice = (base: number, mode: Mode, pct: number) =>
  mode === "inherit" || pct === 0 ? base : applyFormula(base, { id: formulaIdForPct(pct) ?? "", name: "", kind: "percent", value: pct });
// Trang thai da luu cua 1 kenh (theo tung loai phong).
const savedMapFor = (plans: Plan[], types: RoomType[], channelCode: string) => {
  const next: Record<string, Draft> = {};
  for (const t of types) {
    const plan = plans.find((p) => p.channelCode === channelCode && p.roomTypeId === t.id);
    next[t.id] = { mode: modeOfPlan(plan), pct: pctOfPlan(plan) };
  }
  return next;
};

export default function OtaPage() {
  const params = useParams();
  const HOTEL_ID = typeof params.hotelId === "string" ? params.hotelId : currentHotelId();
  const [types, setTypes] = useState<RoomType[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [periods, setPeriods] = useState<Period[]>([]);
  const [channel, setChannel] = useState("website");
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [saved, setSaved] = useState<Record<string, Draft>>({});
  // Ban nhap % chua xac nhan, giu theo tung kenh.
  const [stash, setStash] = useState<Record<string, Record<string, Draft>>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const { showToast } = useToast();
  const [err, setErr] = useState("");
  // Tick de khi luu % moi thi xoa luon gia sua tay cua kenh nay (mac dinh: giu nguyen).
  const [clearOverrides, setClearOverrides] = useState(false);
  // Ngay dung de xem truoc gia kenh (live preview).
  const [viewDate, setViewDate] = useState(todayStr());

  const dirty = useMemo(() => JSON.stringify(drafts) !== JSON.stringify(saved), [drafts, saved]);
  const changedCount = useMemo(
    () => types.filter((t) => JSON.stringify(drafts[t.id]) !== JSON.stringify(saved[t.id])).length,
    [drafts, saved, types]
  );
  const chName = PRICE_CHANNELS.find((c) => c.code === channel)?.name ?? channel;
  const isWebsite = channel === "website";

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [HOTEL_ID]);

  // Doi kenh: cat ban nhap cua kenh cu (neu co thay doi chua luu),
  // roi nap kenh moi — uu tien ban nhap da co, neu khong thi lay tu goi gia.
  function changeChannel(next: string) {
    if (next === channel) return;
    setClearOverrides(false);
    setErr("");
    if (dirty) setStash((prev) => ({ ...prev, [channel]: { ...drafts } }));
    const savedNext = savedMapFor(plans, types, next);
    setDrafts(stash[next] ?? savedNext);
    setSaved(savedNext);
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
    // Nap cach tinh cua kenh mac dinh (Website) ngay tu du lieu vua tai ve.
    const init = savedMapFor(planList, typeList, channel);
    setDrafts(init);
    setSaved(init);
    setStash({});
    setLoading(false);
  }

  // Dam bao co goi Website (goc) cho loai phong — goi OTA tro ve no.
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
  // doi cach tinh, de cach tinh moi ap dung cho ca cac ngay da sua tay.
  // Dong khong co han che thi xoa han; dong co han che thi giu han che,
  // chi dat gia ve NULL (gia se tinh lai theo cach tinh moi).
  async function clearOverridesForChannel(typeIds: string[], next: Record<string, Draft>): Promise<{ cleared: number; kept: number; error: string | null }> {
    let cleared = 0;
    let kept = 0;
    let clearError: string | null = null;
    const changedDates = new Set<string>();
    for (const typeId of typeIds) {
      if (clearError) break;
      const plan = plans.find((p) => p.channelCode === channel && p.roomTypeId === typeId);
      if (!plan) continue;
      const rows: PriceRow[] = [];
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
      const toNull: { rate_plan_id: string; date: string; price: null; min_stay: number | null; max_stay: number | null; stop_sell: boolean; cta: boolean; ctd: boolean }[] = [];
      for (const row of rows) {
        const hasRestriction = row.min_stay != null || row.max_stay != null || !!row.stop_sell || !!row.cta || !!row.ctd;
        if (!hasRestriction) toDelete.push(row.date);
        else toNull.push({ rate_plan_id: row.rate_plan_id, date: row.date, price: null, min_stay: row.min_stay, max_stay: row.max_stay, stop_sell: !!row.stop_sell, cta: !!row.cta, ctd: !!row.ctd });
      }
      if (toDelete.length > 0) {
        const { error } = await supabase.from("rate_prices").delete().eq("rate_plan_id", plan.id).in("date", toDelete);
        if (error) { clearError = "Không xoá được giá sửa tay: " + error.message; break; }
        cleared += toDelete.length;
        toDelete.forEach((d) => changedDates.add(d));
      }
      if (toNull.length > 0) {
        const { error } = await supabase.from("rate_prices").upsert(toNull, { onConflict: "rate_plan_id,date" });
        if (error) { clearError = "Không cập nhật được giá cho ngày có hạn chế: " + error.message; break; }
        kept += toNull.length;
        toNull.forEach((r) => changedDates.add(r.date));
      }
      if (toDelete.length + toNull.length > 0) {
        const typeName = types.find((t) => t.id === typeId)?.name ?? typeId;
        const d = next[typeId];
        const label = d.mode === "inherit" ? "kế thừa giá gốc" : `${d.pct > 0 ? "+" : ""}${d.pct}%`;
        await writeAuditLog({
          hotelId: HOTEL_ID,
          accountId: ACCOUNT_ID,
          action: "price_updated",
          entityType: "rate_price",
          entityId: typeId,
          summary: `Đổi cách tính ${chName} cho ${typeName} (${label}): xoá ${toDelete.length} giá sửa tay${toNull.length > 0 ? `, ${toNull.length} ngày giữ hạn chế và tính lại giá` : ""}`,
          details: { roomTypeId: typeId, channel, mode: d.mode, pct: d.pct, cleared: toDelete.length, kept: toNull.length },
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
      const d = drafts[t.id];
      if (!d) continue;
      const s = saved[t.id];
      if (JSON.stringify(d) === JSON.stringify(s)) continue;
      if (d.mode === "pct" && d.pct <= -100) {
        setErr(`% của ${t.name} phải lớn hơn -100% (nếu không giá kênh sẽ bằng 0 hoặc âm).`);
        setSaving(false);
        return;
      }
    }
    let changed = 0;
    for (const t of types) {
      const d = drafts[t.id];
      const s = saved[t.id];
      if (!d || JSON.stringify(d) === JSON.stringify(s)) continue;
      const formulaId = d.mode === "inherit" ? null : formulaIdForPct(d.pct);
      const plan = plans.find((p) => p.channelCode === channel && p.roomTypeId === t.id);
      if (plan) {
        const { error } = await supabase.from("rate_plans").update({ formula_id: formulaId }).eq("id", plan.id).eq("hotel_id", HOTEL_ID).eq("account_id", ACCOUNT_ID);
        if (error) { setErr(`Không lưu được cách tính của ${t.name}: ` + error.message); setSaving(false); return; }
        setPlans((prev) => prev.map((p) => (p.id === plan.id ? { ...p, formulaId } : p)));
      } else {
        const webId = await ensureWebsitePlan(t.id);
        if (!webId) { setSaving(false); return; }
        const id = `plan-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const { error } = await supabase.from("rate_plans").insert({
          id, hotel_id: HOTEL_ID, account_id: ACCOUNT_ID,
          room_type_id: t.id, channel_code: channel,
          name: chName, cancellation_policy: "flexible", meal_plan: "room_only", policy_id: null,
          derived_from_id: isWebsite ? null : webId, formula_id: formulaId,
        });
        if (error) { setErr(`Không tạo được gói ${chName} cho ${t.name}: ` + error.message); setSaving(false); return; }
        setPlans((prev) => [...prev, { id, channelCode: channel, roomTypeId: t.id, formulaId, derivedFromId: isWebsite ? null : webId }]);
      }
      changed += 1;
    }
    // Tick "Ap dung cho ca cac ngay da sua tay": xoa gia sua tay cua kenh nay
    // cho cac loai phong vua doi cach tinh (chi cac loai da doi, khong dung loai khac).
    const changedTypeIds = types.filter((t) => JSON.stringify(drafts[t.id]) !== JSON.stringify(saved[t.id])).map((t) => t.id);
    let cleared = 0;
    let kept = 0;
    let clearError: string | null = null;
    if (clearOverrides && changedTypeIds.length > 0) {
      const res = await clearOverridesForChannel(changedTypeIds, drafts);
      cleared = res.cleared;
      kept = res.kept;
      clearError = res.error;
    }
    setSaved({ ...drafts });
    // Kenh nay da luu xong — xoa ban nhap cua no.
    setStash((prev) => {
      const next = { ...prev };
      delete next[channel];
      return next;
    });
    setSaving(false);
    setClearOverrides(false);
    if (clearError) setErr(clearError);
    let toast = `Đã lưu cách tính giá của ${chName} cho ${changed} loại phòng.`;
    if (clearOverrides) {
      if (clearError) toast += " Xoá giá sửa tay chưa xong — xem lỗi ở trên.";
      else {
        if (cleared > 0) toast += ` Đã xoá ${cleared} giá sửa tay để áp cách tính mới.`;
        if (kept > 0) toast += ` ${kept} ngày giữ nguyên hạn chế và tính lại giá.`;
        if (cleared === 0 && kept === 0) toast += " Không có giá sửa tay nào cho kênh này.";
      }
    }
    showToast(toast);
  }

  const setDraft = (typeId: string, patch: Partial<Draft>) =>
    setDrafts((prev) => ({ ...prev, [typeId]: { ...prev[typeId], ...patch } }));

  if (loading) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-[var(--cb-text)]">Giá kênh bán</h1>
        <p className="mt-4 text-sm text-[var(--cb-muted)]">Đang tải…</p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[var(--cb-text)]">Giá kênh bán</h1>
          <p className="mt-1 text-sm text-[var(--cb-muted)]">
            Mỗi kênh × mỗi loại phòng chọn 1 trong 2 cách tính: kế thừa giá gốc, hoặc theo % từ giá gốc. % tính thẳng vào giá gốc, không cộng dồn.
          </p>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <button
            onClick={confirmSave}
            disabled={!dirty || saving}
            className="cb-btn-primary px-5 py-2.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50"
            title={dirty ? "Lưu cách tính giá đã đổi vào cơ sở dữ liệu" : "Chưa có thay đổi nào để lưu"}
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

      {/* Chon kenh: Website dung dau */}
      <div className="mt-5 flex flex-wrap items-center gap-2">
        {PRICE_CHANNELS.map((c) => {
          const active = c.code === channel;
          return (
            <button
              key={c.code}
              type="button"
              onClick={() => changeChannel(c.code)}
              className={`rounded-full px-4 py-2 text-sm font-semibold transition-colors ${active ? "bg-primary text-white shadow-card" : "border border-line bg-surface text-ink hover:border-primary hover:text-primary"}`}
            >
              {c.code === "website" ? "Website ★" : c.name}
            </button>
          );
        })}
        <span className="ml-2 flex items-center gap-2 text-sm text-ink">
          <span className="font-semibold">Ngày đang xem</span>
          <DatePicker value={viewDate} onChange={(v) => setViewDate(v || todayStr())} />
        </span>
        {changedCount > 0 && (
          <span className="rounded-full bg-primary-soft px-2 py-0.5 text-xs font-semibold text-primary">{changedCount} loại phòng đã đổi (chưa xác nhận)</span>
        )}
      </div>

      <div className="mt-4 space-y-4">
        {types.length === 0 && (
          <div className="rounded-xl border border-line bg-surface p-5 text-sm text-[var(--cb-muted)]">
            Chưa có loại phòng nào. Tạo loại phòng ở mục Thiết lập khách sạn → Loại phòng trước.
          </div>
        )}
        {types.map((t) => {
          const d = drafts[t.id] ?? { mode: "inherit" as Mode, pct: 0 };
          const s = saved[t.id] ?? { mode: "inherit" as Mode, pct: 0 };
          const changed = JSON.stringify(d) !== JSON.stringify(s);
          const base = basePriceOn(periods, t.id, viewDate);
          const price = channelPrice(base, d.mode, d.pct);
          const list = periods.filter((p) => p.roomTypeId === t.id).sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
          return (
            <div key={t.id} className="overflow-hidden rounded-xl border border-line bg-surface shadow-card">
              <div className="flex flex-wrap items-baseline gap-2 border-b border-[var(--nui-bg)] bg-primary-soft px-4 py-3">
                <span className="text-[15px] font-bold text-ink">{t.name}</span>
                {t.code ? <span className="text-xs font-medium text-[var(--cb-muted)]">{t.code}</span> : null}
                {changed && <span className="rounded-full bg-primary-soft px-2 py-0.5 text-xs font-semibold text-primary">đã đổi</span>}
                <span className="ml-auto text-sm text-[var(--cb-muted)]">
                  Giá gốc ngày {fmtShort(viewDate)}: <b className="text-ink tabular-nums">{fmt(base)}</b>
                  <span className="mx-2 text-[var(--cb-muted)]">→</span>
                  Giá {chName}:
                  <b key={`${t.id}-${d.mode}-${d.pct}-${base}`} className="page-enter ml-1 inline-block text-ink tabular-nums">{fmt(price)}</b>
                </span>
              </div>
              <div className="px-4 py-4">
                {/* Chon cach tinh */}
                <div className="flex flex-wrap gap-2" role="group" aria-label="Cách tính giá">
                  <button
                    type="button"
                    onClick={() => setDraft(t.id, { mode: "inherit" })}
                    className={`flex-1 min-w-44 rounded-xl border px-4 py-3 text-left transition-colors ${d.mode === "inherit" ? "border-primary bg-primary-soft shadow-card" : "border-line bg-surface hover:border-primary"}`}
                  >
                    <span className="block text-sm font-bold text-ink">Kế thừa giá gốc</span>
                    <span className="mt-0.5 block text-xs text-[var(--cb-muted)]">Giá {chName} = giá gốc, không cộng thêm gì.</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setDraft(t.id, { mode: "pct" })}
                    className={`flex-1 min-w-44 rounded-xl border px-4 py-3 text-left transition-colors ${d.mode === "pct" ? "border-primary bg-primary-soft shadow-card" : "border-line bg-surface hover:border-primary"}`}
                  >
                    <span className="block text-sm font-bold text-ink">Theo % từ giá gốc</span>
                    <span className="mt-0.5 block text-xs text-[var(--cb-muted)]">Giá {chName} = giá gốc + %. % âm là giảm giá.</span>
                  </button>
                </div>

                {/* Nhap % — chi hien khi chon "Theo %" */}
                {d.mode === "pct" && (
                  <div key={`pct-${t.id}`} className="page-enter mt-4 rounded-xl border border-line bg-surface px-4 py-3">
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => setDraft(t.id, { pct: Math.max(-99, d.pct - 1) })}
                          className="flex h-8 w-8 items-center justify-center rounded-full border border-line bg-surface text-base font-bold text-ink transition-colors hover:border-primary hover:text-primary"
                          title="Giảm 1%"
                        >
                          −
                        </button>
                        <input
                          type="number"
                          value={d.pct}
                          onChange={(e) => setDraft(t.id, { pct: Number(e.target.value) || 0 })}
                          className="cb-input-pill w-20 px-2 py-1.5 text-center text-base font-bold tabular-nums [-moz-appearance:textfield] [appearance:textfield] [&::-webkit-outer-spin-button]:m-0 [&::-webkit-outer-spin-button]:[-webkit-appearance:none] [&::-webkit-inner-spin-button]:m-0 [&::-webkit-inner-spin-button]:[-webkit-appearance:none]"
                          aria-label="% cộng thêm"
                        />
                        <button
                          type="button"
                          onClick={() => setDraft(t.id, { pct: d.pct + 1 })}
                          className="flex h-8 w-8 items-center justify-center rounded-full border border-line bg-surface text-base font-bold text-ink transition-colors hover:border-primary hover:text-primary"
                          title="Tăng 1%"
                        >
                          +
                        </button>
                        <span className="text-sm font-bold text-ink">%</span>
                      </span>
                      <span className="flex flex-wrap gap-1.5">
                        {QUICK_PCTS.map((q) => (
                          <button
                            key={q}
                            type="button"
                            onClick={() => setDraft(t.id, { pct: q })}
                            className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${d.pct === q ? "bg-primary text-white" : "border border-line bg-surface text-ink hover:border-primary hover:text-primary"}`}
                          >
                            {q > 0 ? `+${q}%` : `${q}%`}
                          </button>
                        ))}
                      </span>
                      <span className="ml-auto text-sm text-[var(--cb-muted)]">
                        {fmt(base)} {d.pct > 0 ? "+" : ""}{d.pct}% = <b className="text-base text-ink tabular-nums">{fmt(price)}</b>
                      </span>
                    </div>
                    <p className="mt-2 text-xs text-[var(--cb-muted)]">% ≤ −100% sẽ làm giá bằng 0 hoặc âm nên không cho lưu. Giá sửa tay (nhập riêng từng ngày ở Lịch giá) luôn thắng % này.</p>
                  </div>
                )}
                {d.mode === "inherit" && (
                  <p key={`inh-${t.id}`} className="page-enter mt-3 rounded-xl border border-line bg-primary-soft px-4 py-2.5 text-sm text-ink">
                    Đang kế thừa giá gốc — giá {chName} ngày {fmtShort(viewDate)} là <b className="tabular-nums">{fmt(base)}</b>. Muốn cộng thêm thì chuyển sang “Theo %”.
                  </p>
                )}

                {/* Bang gia theo tung giai doan gia goc */}
                <table className="mt-4 w-full text-sm text-ink">
                  <thead>
                    <tr className="text-left text-xs text-[var(--cb-muted)]">
                      <th className="py-2 font-semibold">Giai đoạn giá gốc</th>
                      <th className="py-2 text-right font-semibold">Giá gốc</th>
                      <th className="py-2 text-right font-semibold">Giá {chName}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.length === 0 && (
                      <tr className="border-t border-[var(--nui-bg)]">
                        <td colSpan={3} className="py-3 text-[var(--cb-muted)]">Chưa có giai đoạn giá gốc — thêm giai đoạn ở trang Giá gốc (Base Rate) trước.</td>
                      </tr>
                    )}
                    {list.map((pd) => (
                      <tr key={pd.id} className="border-t border-[var(--nui-bg)]">
                        <td className="py-2.5 tabular-nums">{fmtShort(pd.from)} – {fmtShort(pd.to)}</td>
                        <td className="py-2.5 text-right tabular-nums">{fmt(pd.price)}</td>
                        <td className="py-2.5 text-right font-semibold tabular-nums">{fmt(channelPrice(pd.price, d.mode, d.pct))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })}
      </div>

      <p className="mt-4 text-xs text-[var(--cb-muted)]">
        Thay đổi chỉ lưu khi bấm <b>Xác nhận</b>. Đổi cách tính ở đây đổi cho đúng loại phòng đó ở đúng kênh đang chọn — các loại phòng và kênh khác không bị ảnh hưởng. Ngày ngoài giai đoạn giá gốc thì giá gốc là 0 nên giá kênh cũng là 0. Giá sửa tay từng ngày (ở Lịch giá) luôn thắng cách tính này.
      </p>
    </div>
  );
}
