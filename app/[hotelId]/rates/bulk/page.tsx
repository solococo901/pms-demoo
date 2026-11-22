"use client";
// BULK10 — app/[hotelId]/rates/bulk/page.tsx (Trang rieng Cap nhat gia hang loat, toi gian kieu ezCloud + chon nhanh khoang ngay)
// Khong the card: loai phong + ten loai sat trai, 7 o T2-CN chum phai; Master hien cong thuc suy ra; nut nhanh 30/90/180 ngay, 1 nam, 500 ngay; o nhap hien dau cham ngan cach hang nghin khi go.
// Gia goc = gia Website; kenh khac suy ra theo % hoa hong, nhap tay la override (xoa de ve lai gia suy ra).

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  CHANNELS,
  CHANNEL_FORMULA,
  RATE_PLANS,
  ROOM_TYPES,
  getFormula,
  resolvePlanPrice,
  type RatePlan,
  type RoomType,
} from "@/lib/mock-data";
import { supabase } from "@/lib/supabase";
import { currentHotelId } from "@/lib/current-hotel";
import { queueChannexDates, rangeDates } from "@/lib/channex-outbox";
import { DateRangePicker } from "@/components/DatePicker";
import { IconZap } from "@/components/icons";

const ACCOUNT_ID = "11111111-1111-1111-1111-111111111111";

// ---------- date helpers (giong Lich gia) ----------
const WEEKDAYS = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];
const WEEKDAY_FULL = ["Chủ nhật", "Thứ 2", "Thứ 3", "Thứ 4", "Thứ 5", "Thứ 6", "Thứ 7"];
const dayParts = (d: string) => {
  const date = new Date(d + "T00:00:00");
  return { wd: WEEKDAYS[date.getDay()], dow: date.getDay() };
};
const fmt = (n: number) => n.toLocaleString("vi-VN");
// Hien gia dang nhap co dau cham ngan cach hang nghin (1.500.000) de doc duoc ngay so tien dang go.
const fmtInput = (v: string) => (v === "" ? "" : Number(v).toLocaleString("vi-VN"));
const isoLocal = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
// Mac dinh: thang sau (thuong la thang can nhap gia).
function nextMonthRange(): { from: string; to: string } {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const last = new Date(now.getFullYear(), now.getMonth() + 2, 0);
  return { from: isoLocal(first), to: isoLocal(last) };
}

type Restriction = { stopSell?: boolean; minStay?: number; maxStay?: number; cta?: boolean; ctd?: boolean };
type CellKey = string; // `${planId}|${date}`
const keyOf = (planId: string, date: string): CellKey => `${planId}|${date}`;
type UndoCell = { planId: string; date: string; price?: number; hadPrice: boolean };

const inputCls = "rounded-lg border border-line px-2 py-2 text-ink outline-none focus:border-primary";
const DOW_ORDER = [1, 2, 3, 4, 5, 6, 0]; // T2..CN

export default function BulkRatesPage() {
  const params = useParams();
  const HOTEL_ID = typeof params.hotelId === "string" ? params.hotelId : currentHotelId();

  const [plans, setPlans] = useState<RatePlan[]>(RATE_PLANS.map((p) => ({ ...p, prices: { ...p.prices } })));
  const [roomTypesDb, setRoomTypesDb] = useState<RoomType[]>(ROOM_TYPES);
  const [restrictions, setRestrictions] = useState<Record<CellKey, Restriction>>({});
  const [overrides, setOverrides] = useState<Record<CellKey, number>>({}); // gia sua tay cua goi suy ra
  const [dbError, setDbError] = useState("");

  const [channel, setChannel] = useState<string>("website");
  const [typeIds, setTypeIds] = useState<string[]>([]); // rong = tat ca loai phong
  const [range, setRange] = useState<{ from: string; to: string }>(() => nextMonthRange());
  const [values, setValues] = useState<Record<string, string>>({}); // `${typeId}|${dow}` -> gia nhap
  const [showTypeFilter, setShowTypeFilter] = useState(false);
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState(0);
  const [toast, setToast] = useState<{ text: string; onUndo?: () => void } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ensuringRef = useRef<Set<string>>(new Set());

  const selectedTypes = typeIds.length === 0 ? roomTypesDb : roomTypesDb.filter((t) => typeIds.includes(t.id));
  const chName = CHANNELS.find((c) => c.code === channel)?.name ?? channel;
  const pct = getFormula(CHANNEL_FORMULA[channel])?.value;
  const factorText = pct !== undefined ? `× ${(1 + pct / 100).toFixed(2).replace(".", ",")}` : "";
  const masterNote =
    channel === "website"
      ? "Giá nhập là giá gốc — Booking.com, Expedia, Airbnb, Agoda tự tính theo."
      : channel === "frontdesk"
        ? "Giá nhập là giá Lễ tân — bằng giá gốc."
        : `Giá tự tính từ giá gốc ${factorText} + 0 — ô nào nhập giá thì ô đó thành giá sửa tay (chỉ kênh này).`;

  function showToast(text: string, onUndo?: () => void) {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ text, onUndo });
    toastTimer.current = setTimeout(() => setToast(null), 10000);
  }

  // ---------- Supabase: load plans + daily prices on mount ----------
  useEffect(() => {
    (async () => {
      const [typesRes, plansRes, pricesRes] = await Promise.all([
        supabase.from("room_types").select("*").eq("hotel_id", HOTEL_ID),
        supabase.from("rate_plans").select("*").eq("hotel_id", HOTEL_ID),
        supabase.from("rate_prices").select("*"),
      ]);
      const loadErr = plansRes.error ?? pricesRes.error;
      if (loadErr) {
        setDbError(loadErr.message ?? "Không đọc được dữ liệu");
        return;
      }
      if ((typesRes.data ?? []).length > 0) {
        setRoomTypesDb(
          (typesRes.data ?? []).map((t) => ({
            id: t.id, code: t.code ?? undefined, name: t.name,
            maxOccupancy: t.max_occupancy, maxAdults: t.max_adults,
            maxChildren: t.max_children, maxInfants: t.max_infants,
            bedConfig: t.bed_config ?? "", sizeM2: t.size_sqm ?? undefined,
            priceFloor: t.min_price ?? undefined, priceCeiling: t.max_price ?? undefined,
            active: t.active,
          }))
        );
      }
      const dbPlans: RatePlan[] = (plansRes.data ?? []).map((row) => ({
        id: row.id,
        channelCode: row.channel_code,
        roomTypeId: row.room_type_id,
        name: row.name,
        cancellationPolicy: row.cancellation_policy as RatePlan["cancellationPolicy"],
        prices: {},
        publicName: row.public_name ?? undefined,
        mealPlan: row.meal_plan as RatePlan["mealPlan"],
        baseOccupancy: row.base_occupancy,
        extraAdultFee: Number(row.extra_adult_fee),
        extraChildFee: Number(row.extra_child_fee),
        derivedFromId: row.derived_from_id ?? undefined,
        formulaId: row.formula_id ?? undefined,
      }));
      const planIds = new Set(dbPlans.map((p) => p.id));
      // Supabase tra toi da 1000 dong/lan — lay them cac trang sau
      let allPriceRows = pricesRes.data ?? [];
      if (allPriceRows.length >= 1000) {
        for (let from = 1000; ; from += 1000) {
          const { data: page } = await supabase
            .from("rate_prices").select("*").range(from, from + 999);
          allPriceRows = [...allPriceRows, ...(page ?? [])];
          if (!page || page.length < 1000) break;
        }
      }
      const rows = allPriceRows.filter((r) => planIds.has(r.rate_plan_id));
      const dbOverrides: Record<CellKey, number> = {};
      for (const row of rows) {
        const plan = dbPlans.find((p) => p.id === row.rate_plan_id);
        if (!plan) continue;
        // Gia cua goi suy ra khong nam trong plan.prices — dong gia cua no CHINH LA gia sua tay (override).
        if (plan.derivedFromId) dbOverrides[keyOf(row.rate_plan_id, row.date)] = Number(row.price);
        else plan.prices[row.date] = Number(row.price);
      }
      const dbRestrictions: Record<CellKey, Restriction> = {};
      for (const row of rows) {
        const plan = dbPlans.find((p) => p.id === row.rate_plan_id);
        if (!plan) continue;
        const restr: Restriction = {};
        if (row.min_stay != null) restr.minStay = row.min_stay;
        if (row.max_stay != null) restr.maxStay = row.max_stay;
        if (row.stop_sell) restr.stopSell = true;
        if (row.cta) restr.cta = true;
        if (row.ctd) restr.ctd = true;
        if (Object.keys(restr).length > 0) dbRestrictions[keyOf(row.rate_plan_id, row.date)] = restr;
      }
      setPlans(dbPlans);
      setOverrides(dbOverrides);
      setRestrictions(dbRestrictions);
    })();
  }, []);

  // Prefill tu nut Sua nhanh o Lich gia: ?type=<id>&from=<yyyy-mm-dd>&to=<yyyy-mm-dd>
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const t = q.get("type");
    const from = q.get("from");
    const to = q.get("to");
    if (t) setTypeIds([t]);
    if (from && to && to >= from) setRange({ from, to });
  }, []);

  // Gia hien thi cua 1 o: goi goc lay gia da luu; goi suy ra tinh tu gia goc (+ cong thuc), gia sua tay thang.
  function priceForCell(plan: RatePlan, date: string): number | undefined {
    if (!plan.derivedFromId) return plan.prices[date];
    return resolvePlanPrice(plan, date, plans, overrides);
  }

  // ---------- Supabase: save one cell (price + restrictions giu nguyen) ----------
  async function persistCell(planId: string, date: string, price: number, restr?: Restriction) {
    const r = restr ?? restrictions[keyOf(planId, date)] ?? {};
    const { error } = await supabase.from("rate_prices").upsert({
      rate_plan_id: planId,
      date,
      price,
      min_stay: r.minStay ?? null,
      max_stay: r.maxStay ?? null,
      stop_sell: !!r.stopSell,
      cta: !!r.cta,
      ctd: !!r.ctd,
    });
    if (error) setDbError("Lưu giá không thành công: " + error.message);
    else queueChannexDates([date]);
  }

  // Tra ve promise cua lenh ghi DB de saveAll cho ghi xong that moi bao "Da luu".
  function applyPrice(plan: RatePlan, date: string, price: number): Promise<void> {
    if (plan.derivedFromId) setOverrides((prev) => ({ ...prev, [keyOf(plan.id, date)]: price }));
    else setPlans((prev) => prev.map((p) => (p.id === plan.id ? { ...p, prices: { ...p.prices, [date]: price } } : p)));
    return persistCell(plan.id, date, price);
  }

  function setPrice(planId: string, date: string, price: number) {
    const plan = plans.find((p) => p.id === planId);
    if (!plan) return;
    applyPrice(plan, date, price);
  }

  function clearPrice(planId: string, date: string) {
    const plan = plans.find((p) => p.id === planId);
    if (!plan) return;
    // Goi suy ra: xoa gia sua tay de o ve lai gia suy ra; goi goc: xoa gia luon.
    if (plan.derivedFromId) {
      setOverrides((prev) => {
        const next = { ...prev };
        delete next[keyOf(planId, date)];
        return next;
      });
    } else {
      setPlans((prev) => prev.map((p) => {
        if (p.id !== planId) return p;
        const next = { ...p.prices };
        delete next[date];
        return { ...p, prices: next };
      }));
    }
    supabase
      .from("rate_prices")
      .delete()
      .eq("rate_plan_id", planId)
      .eq("date", date)
      .then(({ error }) => {
        if (error) setDbError("Xoá giá không thành công: " + error.message);
        else queueChannexDates([date]);
      });
  }

  // ---------- goi chuan cua kenh ----------
  // Gia kenh = goi chuan duy nhat: goi goc (khong ke thua, uu tien chi phong), neu khong co thi goi suy ra theo cong thuc cua kenh.
  function standardPlanFor(channelCode: string, roomTypeId: string): RatePlan | undefined {
    const cands = plans.filter((p) => p.channelCode === channelCode && p.roomTypeId === roomTypeId);
    return (
      cands.find((p) => !p.derivedFromId && (p.mealPlan ?? "room_only") === "room_only") ??
      cands.find((p) => p.derivedFromId && p.formulaId === CHANNEL_FORMULA[channelCode]) ??
      cands.find((p) => p.derivedFromId) ??
      cands[0]
    );
  }

  // Chua co goi chuan thi tao goi chuan (ten kenh, huy linh hoat, chi phong) roi moi ghi gia.
  // Goi cua kenh OTA / Le tan tao san la goi suy ra tu gia Website (Le tan khong cong them: gia = gia goc).
  async function ensureStandardPlan(channelCode: string, roomTypeId: string): Promise<RatePlan | undefined> {
    const existing = standardPlanFor(channelCode, roomTypeId);
    if (existing) return existing;
    const key = `${channelCode}|${roomTypeId}`;
    if (ensuringRef.current.has(key)) return undefined;
    ensuringRef.current.add(key);
    try {
      const chName = CHANNELS.find((c) => c.code === channelCode)?.name ?? channelCode;
      const id = `plan-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      let derivedFromId: string | undefined;
      let formulaId: string | undefined;
      if (channelCode !== "website") {
        const webPlan = await ensureStandardPlan("website", roomTypeId);
        if (!webPlan) return undefined;
        derivedFromId = webPlan.id;
        formulaId = CHANNEL_FORMULA[channelCode];
      }
      const { error } = await supabase.from("rate_plans").insert({
        id, hotel_id: HOTEL_ID, account_id: ACCOUNT_ID,
        room_type_id: roomTypeId, channel_code: channelCode,
        name: chName, cancellation_policy: "flexible", meal_plan: "room_only", policy_id: null,
        derived_from_id: derivedFromId ?? null, formula_id: formulaId ?? null,
      });
      if (error) {
        setDbError("Tạo gói chuẩn không thành công: " + error.message);
        return undefined;
      }
      const np: RatePlan = {
        id, channelCode, roomTypeId, name: chName,
        cancellationPolicy: "flexible", mealPlan: "room_only", prices: {},
        derivedFromId, formulaId,
      };
      setPlans((prev) => [...prev, np]);
      return np;
    } finally {
      ensuringRef.current.delete(key);
    }
  }

  // ---------- tinh so o se luu ----------
  const targets = useMemo(() => {
    const list: { typeId: string; date: string; value: number }[] = [];
    if (!range.from || !range.to || range.to < range.from) return list;
    for (const type of selectedTypes) {
      for (let dow = 0; dow <= 6; dow++) {
        const raw = (values[`${type.id}|${dow}`] ?? "").trim();
        if (!raw || !/^\d+$/.test(raw)) continue;
        const value = Number(raw);
        for (const date of rangeDates(range.from, range.to)) {
          if (dayParts(date).dow === dow) list.push({ typeId: type.id, date, value });
        }
      }
    }
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTypes, range, values]);

  // ---------- luu hang loat (co tien trinh + Hoan tac) ----------
  async function saveAll() {
    if (targets.length === 0 || saving) return;
    setSaving(true);
    setProgress(0);
    const snap = new Map<string, UndoCell>();
    const planCache = new Map<string, RatePlan | undefined>();
    const pending: Promise<void>[] = [];
    let done = 0;
    // Ghi theo nhom 10 o: vua khong dong qua nhieu lenh cung luc, vua cho ghi xong that moi bao "Da luu".
    const flush = async () => {
      if (pending.length === 0) return;
      await Promise.all(pending.splice(0));
      setProgress(Math.round((done / targets.length) * 100));
    };
    for (const t of targets) {
      if (!planCache.has(t.typeId)) planCache.set(t.typeId, await ensureStandardPlan(channel, t.typeId));
      const plan = planCache.get(t.typeId);
      if (!plan) continue;
      const k = keyOf(plan.id, t.date);
      if (!snap.has(k)) {
        const had = plan.derivedFromId ? overrides[k] !== undefined : plan.prices[t.date] !== undefined;
        snap.set(k, { planId: plan.id, date: t.date, price: priceForCell(plan, t.date), hadPrice: had });
      }
      pending.push(applyPrice(plan, t.date, t.value));
      done++;
      if (pending.length >= 10) await flush();
    }
    await flush();
    setProgress(100);
    queueChannexDates([...new Set(targets.map((t) => t.date))], HOTEL_ID);
    const typeNames = selectedTypes.map((t) => t.name).join(", ");
    showToast(`Đã lưu ${done} ô giá ${chName} · ${typeNames} — sẽ đồng bộ lên Channex trong ít phút.`, () => {
      snap.forEach((cell) => {
        if (cell.hadPrice && cell.price !== undefined) setPrice(cell.planId, cell.date, cell.price);
        else clearPrice(cell.planId, cell.date);
      });
      showToast("Đã hoàn tác.");
    });
    setValues({});
    setSaving(false);
    setProgress(0);
  }

  function toggleType(id: string) {
    setTypeIds((prev) => {
      const all = roomTypesDb.map((t) => t.id);
      const cur = prev.length === 0 ? all : prev;
      const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
      return next.length === all.length ? [] : next;
    });
  }

  function copyMonday(typeId: string) {
    const mon = (values[`${typeId}|1`] ?? "").trim();
    if (!mon) return;
    setValues((prev) => {
      const next = { ...prev };
      for (const dow of [2, 3, 4, 5, 6, 0]) next[`${typeId}|${dow}`] = mon;
      return next;
    });
  }

  // Chon nhanh khoang ngay: bat dau tu ngay bat dau dang chon, keo dai N ngay (khong can bam lich).
  function setQuickRange(days: number) {
    const from = range.from || isoLocal(new Date());
    const d = new Date(from + "T00:00:00");
    d.setDate(d.getDate() + days - 1);
    setRange({ from, to: isoLocal(d) });
  }

  // Gia hien tai cua 1 thu trong khoang (lay ngay dau tien co thu do) — hien nho duoi o nhap.
  function currentWeekdayPrice(typeId: string, dow: number): number | undefined {
    const plan = standardPlanFor(channel, typeId);
    if (!plan) return undefined;
    if (!range.from || !range.to || range.to < range.from) return undefined;
    for (const date of rangeDates(range.from, range.to)) {
      if (dayParts(date).dow === dow) return priceForCell(plan, date);
    }
    return undefined;
  }

  const rangeText = range.from && range.to ? `${range.from} ~ ${range.to}` : "";
  const shownChips = selectedTypes.slice(0, 3);
  const extraChips = selectedTypes.length - shownChips.length;

  return (
    <div className="bg-surface px-5 pb-6 pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <Link href={`/${HOTEL_ID}/rates`} className="text-sm font-semibold text-primary hover:underline">
            ← Lịch giá
          </Link>
          <h1 className="mt-1 flex items-center gap-1.5 text-xl font-bold text-ink"><IconZap className="h-5 w-5" /> Cập nhật giá hàng loạt</h1>
        </div>
        <button onClick={() => void saveAll()} disabled={saving || targets.length === 0} className="cb-btn-primary px-5 py-2 text-sm disabled:opacity-50">
          {saving ? `Đang lưu… ${progress}%` : "Cập nhật"}
        </button>
      </div>

      {dbError && <div className="mt-3 rounded-lg bg-danger-soft px-3 py-2 text-sm font-medium text-danger">{dbError}</div>}

      {/* Tab lon kieu ezCloud */}
      <div className="mt-4 grid grid-cols-4 border-b border-line text-center text-sm font-semibold">
        <Link href={`/${HOTEL_ID}/inventory`} className="pb-2 text-muted hover:text-ink">Phòng trống</Link>
        <span className="border-b-2 border-primary pb-2 text-primary">Giá</span>
        <Link href={`/${HOTEL_ID}/rates`} className="pb-2 text-muted hover:text-ink">Hạn chế</Link>
        <Link href={`/${HOTEL_ID}/inventory`} className="pb-2 text-muted hover:text-ink">Giới hạn bán</Link>
      </div>

      {/* Tab con — chi "Gia phong" lam viec duoc */}
      <div className="mt-3 flex flex-wrap gap-1 rounded-lg bg-surface-muted p-1 text-sm">
        <span className="cursor-not-allowed rounded-md px-3 py-1.5 text-muted" title="Chưa có">Giá tuần</span>
        <span className="cursor-not-allowed rounded-md px-3 py-1.5 text-muted" title="Chưa có">Giá ngày</span>
        <span className="rounded-md bg-surface px-3 py-1.5 font-bold text-primary shadow-card">Giá phòng</span>
        <span className="cursor-not-allowed rounded-md px-3 py-1.5 text-muted" title="Chưa có">Giá phụ thu</span>
        <span className="cursor-not-allowed rounded-md px-3 py-1.5 text-muted" title="Chưa có">Giá phụ thu ngày</span>
      </div>

      {/* Loai phong — thanh chon rong het chieu ngang, chip nam trong thanh */}
      <div className="relative mt-4">
        <label className="mb-1 block text-xs font-bold text-muted">Loại phòng *</label>
        <button onClick={() => setShowTypeFilter((v) => !v)} className="flex min-h-10 w-full flex-wrap items-center gap-1.5 rounded-lg border border-line bg-surface px-2 py-1.5 text-left text-sm">
          {selectedTypes.length === 0 ? (
            <span className="text-muted">Chưa có loại phòng</span>
          ) : (
            <>
              {shownChips.map((t) => (
                <span key={t.id} className="inline-flex items-center gap-1 rounded-full bg-primary px-2.5 py-1 text-xs font-semibold text-white">
                  {t.name}
                  <span
                    role="button"
                    onClick={(e) => { e.stopPropagation(); toggleType(t.id); }}
                    className="cursor-pointer font-bold hover:opacity-70"
                    title="Bỏ loại phòng này"
                  >
                    ✕
                  </span>
                </span>
              ))}
              {extraChips > 0 && <span className="text-xs text-muted">(+{extraChips})</span>}
            </>
          )}
          <span className="ml-auto text-muted">▾</span>
        </button>
        {showTypeFilter && (
          <>
            <div className="fixed inset-0 z-20" onClick={() => setShowTypeFilter(false)} />
            <div className="absolute z-30 mt-1 w-64 rounded-xl border border-line bg-surface p-2 shadow-card">
              {roomTypesDb.map((t) => (
                <label key={t.id} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-primary-soft">
                  <input
                    type="checkbox"
                    checked={typeIds.length === 0 || typeIds.includes(t.id)}
                    onChange={() => toggleType(t.id)}
                  />
                  {t.name}
                </label>
              ))}
              <button
                onClick={() => { setTypeIds([]); setShowTypeFilter(false); }}
                className="mt-1 w-full rounded-lg px-2 py-1.5 text-left text-sm font-semibold text-primary hover:bg-primary-soft"
              >
                Chọn tất cả
              </button>
            </div>
          </>
        )}
      </div>

      {/* Hang mo: kenh ban + khoang ngay */}
      <div className="mt-3 flex flex-wrap items-center gap-5 text-sm">
        <label className="flex items-center gap-2">
          <span className="font-bold text-ink">Kênh bán</span>
          <select value={channel} onChange={(e) => setChannel(e.target.value)} className={`${inputCls} text-sm`} disabled={saving}>
            {CHANNELS.map((c) => (
              <option key={c.code} value={c.code}>{c.name}</option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2">
          <span className="font-bold text-ink">Khoảng ngày</span>
          <DateRangePicker from={range.from} to={range.to} onChange={(f, t) => setRange({ from: f, to: t })} />
        </label>
        <span className="flex items-center gap-1 text-xs">
          <span className="font-bold text-ink">Nhanh:</span>
          {[30, 90, 180, 365, 500].map((d) => (
            <button
              key={d}
              onClick={() => setQuickRange(d)}
              disabled={saving}
              className="rounded-full border border-line px-2 py-1 font-semibold text-muted hover:border-primary hover:text-primary disabled:opacity-50"
            >
              {d === 365 ? "1 năm" : `${d} ngày`}
            </button>
          ))}
        </span>
      </div>

      {/* Tieu de thu — 1 hang duy nhat, can theo o nhap */}
      <div className="mt-4 flex justify-end">
        <div className="flex items-start gap-2">
          <div className="w-7" />
          {DOW_ORDER.map((dow) => (
            <div key={dow} className={`w-[104px] text-center text-sm font-semibold ${dow === 0 || dow === 6 ? "text-danger" : "text-muted"}`}>
              {WEEKDAY_FULL[dow]}
            </div>
          ))}
        </div>
      </div>

      {/* Tung loai phong 1 khoi: ten sat trai, Master + 7 o chum phai */}
      {selectedTypes.map((type) => (
        <div key={type.id} className="border-t border-line py-3">
          <div className="flex items-start justify-between gap-6">
            <div className="shrink-0 pt-1">
              <div className="text-[15px] font-bold text-primary">{type.name}</div>
              <div className="mt-1 text-sm text-ink">{range.from && range.to ? `${range.from} - ${range.to}` : "Chưa chọn khoảng ngày"}</div>
            </div>
            <div className="shrink-0">
              <div className="mb-1 flex items-center justify-end gap-1.5 text-sm">
                <span className="font-semibold text-ink">Master</span>
                {channel !== "website" && channel !== "frontdesk" && (
                  <span className="text-muted">{factorText} + 0</span>
                )}
                {channel === "frontdesk" && <span className="text-muted">± 0</span>}
                <span className="cursor-help text-subtle" title={masterNote}>ⓘ</span>
              </div>
              <div className="flex items-start gap-2">
                <button
                  onClick={() => copyMonday(type.id)}
                  disabled={saving || !(values[`${type.id}|1`] ?? "").trim()}
                  className="mt-1.5 flex h-7 w-7 shrink-0 items-center justify-center rounded bg-primary text-white disabled:opacity-40"
                  title="Chép giá Thứ 2 sang các ngày còn lại trong hàng này"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                  </svg>
                </button>
                {DOW_ORDER.map((dow) => {
                  const cur = currentWeekdayPrice(type.id, dow);
                  return (
                    <div key={dow} className="w-[104px]">
                      <input
                        type="text"
                        inputMode="numeric"
                        value={fmtInput(values[`${type.id}|${dow}`] ?? "")}
                        onChange={(e) => {
                          const v = e.target.value.replace(/[^\d]/g, "");
                          setValues((prev) => ({ ...prev, [`${type.id}|${dow}`]: v }));
                        }}
                        disabled={saving}
                        placeholder="—"
                        className={`${inputCls} w-full text-right text-sm font-semibold tabular-nums`}
                      />
                      <span className="mt-0.5 block text-center text-[11px] text-subtle">
                        {cur !== undefined ? fmt(cur) : "—"}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      ))}

      {/* Nut luu cuoi trang */}
      <div className="mt-4 flex items-center justify-end gap-3 border-t border-line pt-4">
        {targets.length > 0 && (
          <span className="text-sm">
            Sẽ lưu <b>{targets.length} ô giá</b> · {chName}
            {rangeText ? ` · ${rangeText}` : ""}
          </span>
        )}
        <button onClick={() => void saveAll()} disabled={saving || targets.length === 0} className="cb-btn-primary px-5 py-2 text-sm disabled:opacity-50">
          {saving ? `Đang lưu… ${progress}%` : "Cập nhật"}
        </button>
      </div>

      {/* Thong bao + Hoan tac */}
      {toast && (
        <div className="fixed right-4 top-4 z-50 flex max-w-md items-center gap-3 rounded-xl bg-ink px-4 py-3 text-sm text-white shadow-card">
          <span>{toast.text}</span>
          {toast.onUndo && (
            <button onClick={() => { toast.onUndo?.(); setToast(null); }} className="shrink-0 rounded-lg bg-white px-2.5 py-1 font-bold text-ink">
              Hoàn tác
            </button>
          )}
          <button onClick={() => setToast(null)} className="shrink-0 font-bold opacity-70">✕</button>
        </div>
      )}
    </div>
  );
}
