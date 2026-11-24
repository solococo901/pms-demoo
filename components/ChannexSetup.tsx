"use client";

// SETUP5 — components/ChannexSetup.tsx (thiet lap Channex ro rang hon)
// Viet lai giao dien thanh 3 buoc co danh so (Khach san -> Loai phong -> Goi gia tung kenh), gom goi theo kenh
// (khong liet ke tung goi theo loai phong nua) va CHI 1 NUT "Tao phan con thieu" chay ca tao cau truc + goi suy ra
// theo dung thu tu. Bo chu "cau truc" / "goi ke thua" kho hieu khoi giao dien; phan xu ly ben trong giu nguyen SETUP4.

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { currentHotelId } from "@/lib/current-hotel";
import { useParams } from "next/navigation";
import { getFormula } from "@/lib/mock-data";

const OTA_CHANNELS = ["booking_com", "expedia", "airbnb", "agoda"];
const CHANNEL_NAMES: Record<string, string> = {
  booking_com: "Booking.com",
  expedia: "Expedia",
  airbnb: "Airbnb",
  agoda: "Agoda",
};

type TypeRow = {
  id: string; name: string; channexId: string | null;
  maxAdults: number; maxChildren: number; maxInfants: number; roomCount: number;
};
type PlanRow = {
  id: string; name: string; channelCode: string; roomTypeId: string;
  channexId: string | null; derived: boolean; mealPlan: string;
  baseOccupancy: number; rate: string;
  parentPmsId: string | null; formulaId: string | null;
};

export default function ChannexSetup() {
  // Khach san lay tu URL khi co, khong thi dung khach san da luu theo tab.
  const params = useParams();
  const HOTEL_ID = typeof params.hotelId === "string" ? params.hotelId : currentHotelId();
  const [loading, setLoading] = useState(true);
  const [propertyId, setPropertyId] = useState<string | null>(null);
  const [types, setTypes] = useState<TypeRow[]>([]);
  const [plans, setPlans] = useState<PlanRow[]>([]);
  // Bang tra kenh theo id goi (gom ca goi Website) — de biet goi suy ra ke tu goi nao. Danh sach `plans` chi co goi OTA
  // nen khong dung no de tim goi goc Website duoc (SETUP3 bi loi o day: tim khong thay -> mac dinh la goi ke thua).
  const [planChannelById, setPlanChannelById] = useState<Record<string, string>>({});
  const [hotelPayload, setHotelPayload] = useState<Record<string, string>>({});
  const [hotelName, setHotelName] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [errors, setErrors] = useState<string[]>([]);

  const load = useCallback(async () => {
    const [connRes, hotelRes, typesRes, roomsRes, plansRes] = await Promise.all([
      supabase.from("channel_connections").select("*").eq("hotel_id", HOTEL_ID).eq("provider", "channex").single(),
      supabase.from("hotels").select("*").eq("id", HOTEL_ID).single(),
      supabase.from("room_types").select("*").eq("hotel_id", HOTEL_ID),
      supabase.from("rooms").select("room_type_id").eq("hotel_id", HOTEL_ID),
      supabase.from("rate_plans").select("*").eq("hotel_id", HOTEL_ID),
    ]);
    if (connRes.data) setPropertyId(connRes.data.external_property_id ?? null);
    if (hotelRes.data) {
      const h = hotelRes.data;
      setHotelName(h.name);
      const profile = (h.profile ?? {}) as Record<string, string>;
      setHotelPayload({
        title: h.name,
        currency: h.currency ?? "VND",
        email: profile.email ?? "",
        phone: profile.phone ?? "",
        country: "VN",
        city: h.city ?? "",
        address: h.address ?? "",
        timezone: h.timezone ?? "Asia/Ho_Chi_Minh",
        propertyType: "hotel",
        latitude: h.latitude != null ? String(h.latitude) : "",
        longitude: h.longitude != null ? String(h.longitude) : "",
      });
    }
    const counts = new Map<string, number>();
    for (const r of roomsRes.data ?? []) counts.set(r.room_type_id, (counts.get(r.room_type_id) ?? 0) + 1);
    setTypes((typesRes.data ?? []).map((t) => ({
      id: t.id, name: t.name, channexId: t.channex_id ?? null,
      maxAdults: t.max_adults ?? 2, maxChildren: t.max_children ?? 0, maxInfants: t.max_infants ?? 0,
      roomCount: counts.get(t.id) ?? 0,
    })));
    const otaPlans = (plansRes.data ?? []).filter((p) => OTA_CHANNELS.includes(p.channel_code));
    const chById: Record<string, string> = {};
    for (const p of plansRes.data ?? []) chById[p.id] = p.channel_code;
    setPlanChannelById(chById);
    // Gia goc khi tao goi tren Channex: gia cua NGAY HOM NAY THAT — hom nay chua co gia thi lay gia gan nhat sau do,
    // khong co gia tuong lai thi lay gia gan nhat truoc do (truoc day lay gia ngay mau 2026-10-21 — sai khi ngay do khong phai ngay hien tai).
    const today = (() => {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    })();
    const priceByPlan = new Map<string, number>();
    if (otaPlans.length > 0) {
      // Lay theo trang (Supabase tra toi da 1000 dong/lan), sap theo ngay tang dan.
      let priceRows: { rate_plan_id: string; date: string; price: number }[] = [];
      for (let from = 0; ; from += 1000) {
        const { data: page } = await supabase
          .from("rate_prices").select("rate_plan_id, date, price")
          .in("rate_plan_id", otaPlans.map((p) => p.id))
          .order("date")
          .range(from, from + 999);
        priceRows = [...priceRows, ...(page ?? [])];
        if (!page || page.length < 1000) break;
      }
      const byPlan = new Map<string, { date: string; price: number }[]>();
      for (const pr of priceRows) {
        const list = byPlan.get(pr.rate_plan_id) ?? [];
        list.push({ date: pr.date, price: pr.price });
        byPlan.set(pr.rate_plan_id, list);
      }
      for (const [planId, list] of byPlan) {
        const future = list.find((r) => r.date >= today);
        priceByPlan.set(planId, (future ?? list[list.length - 1]).price);
      }
    }
    setPlans(otaPlans.map((p) => ({
      id: p.id, name: p.name, channelCode: p.channel_code, roomTypeId: p.room_type_id,
      channexId: p.channex_id ?? null, derived: !!p.derived_from_id,
      mealPlan: p.meal_plan ?? "none", baseOccupancy: p.base_occupancy ?? 2,
      rate: (priceByPlan.get(p.id) ?? 0).toFixed(2),
      parentPmsId: p.derived_from_id ?? null, formulaId: p.formula_id ?? null,
    })));
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const missingTypes = types.filter((t) => !t.channexId);
  // Gói chuan OTA suy ra tu gia Website thi tao tren Channex dang DOC LAP (PMS tu tinh gia roi gui len),
  // khong phai gói ke thua — vi Channex khong suy gia tu gói Website duoc (gói Website khong phai gói OTA tren Channex).
  // Chi gói suy ra tu gói OTA (vd gói khong hoan huy suy ra tu gói linh hoat cung kenh) moi la gói ke thua.
  const parentChannelOf = (p: PlanRow) => (p.parentPmsId ? planChannelById[p.parentPmsId] : undefined);
  const isWebsiteDerived = (p: PlanRow) => {
    if (!p.derived) return false;
    const pc = parentChannelOf(p);
    return pc !== undefined && !OTA_CHANNELS.includes(pc);
  };
  const missingPlans = plans.filter((p) => {
    if (p.channexId) return false;
    if (!p.derived) return true;
    return isWebsiteDerived(p);
  });
  const derivedMissing = plans.filter((p) => p.derived && !p.channexId && !isWebsiteDerived(p));
  const nothingToDo = !!propertyId && missingTypes.length === 0 && missingPlans.length === 0 && derivedMissing.length === 0;

  // Buoc A — tao khach san (neu chua co) + loai phong + goi chuan con thieu tren Channex.
  // Tra ve ten cac muc da tao, loi (neu co) va ma khach san hieu luc (moi tao hoac da co).
  async function runSetupCore(): Promise<{ created: string[]; errors: string[]; propertyId: string | null }> {
    if (propertyId && missingTypes.length === 0 && missingPlans.length === 0) {
      return { created: [], errors: [], propertyId };
    }
    const created: string[] = [];
    const res = await fetch("/api/channex/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        propertyId,
        property: hotelPayload,
        // Gui kem ma Channex cua loai phong DA CO — dot chay them khong con loai phong nao thieu
        // nen may chu khong biet goi gia moi thuoc loai phong nao va bao loi neu khong gui kem.
        roomTypeMap: Object.fromEntries(
          types.filter((t) => t.channexId).map((t) => [t.id, t.channexId as string])
        ),
        roomTypes: missingTypes.map((t) => ({
          pmsId: t.id, title: t.name, countOfRooms: Math.max(t.roomCount, 1),
          occAdults: t.maxAdults, occChildren: t.maxChildren, occInfants: t.maxInfants,
        })),
        ratePlans: missingPlans.map((p) => ({
          pmsId: p.id, pmsRoomTypeId: p.roomTypeId, title: p.name,
          mealType: p.mealPlan, occupancy: p.baseOccupancy, rate: p.rate,
        })),
      }),
    });
    const data = await res.json();
    if (!data.ok) return { created, errors: [data.error ?? "Thiết lập thất bại."], propertyId };
    let effPropertyId = propertyId;
    if (data.propertyId && data.propertyId !== propertyId) {
      effPropertyId = data.propertyId;
      await supabase.from("channel_connections")
        .update({ external_property_id: data.propertyId, status: "connected" })
        .eq("hotel_id", HOTEL_ID).eq("provider", "channex");
      created.push(`Khách sạn ${hotelName || HOTEL_ID}`);
    }
    for (const [pmsId, cid] of Object.entries(data.roomTypeIds ?? {})) {
      await supabase.from("room_types").update({ channex_id: cid }).eq("id", pmsId);
      const t = types.find((x) => x.id === pmsId);
      if (t) created.push(`Loại phòng ${t.name}`);
    }
    for (const [pmsId, cid] of Object.entries(data.ratePlanIds ?? {})) {
      await supabase.from("rate_plans").update({ channex_id: cid }).eq("id", pmsId);
      const p = plans.find((x) => x.id === pmsId);
      if (p) created.push(`Gói giá ${CHANNEL_NAMES[p.channelCode] ?? p.name}`);
    }
    return { created, errors: data.errors ?? [], propertyId: effPropertyId };
  }

  // Buoc B — tao goi suy ra tu goi OTA (vd goi khong hoan huy) con thieu.
  // Doc lai goi + loai phong moi nhat tu DB (state cu chua cap nhat sau buoc A) de biet dung goi goc da co ma Channex.
  async function runDerivedCore(effPropertyId: string | null): Promise<{ created: string[]; errors: string[] }> {
    const created: string[] = [];
    const errors: string[] = [];
    if (!effPropertyId) return { created, errors };
    const [plansRes, typesRes] = await Promise.all([
      supabase.from("rate_plans").select("*").eq("hotel_id", HOTEL_ID),
      supabase.from("room_types").select("id, channex_id").eq("hotel_id", HOTEL_ID),
    ]);
    const freshPlans = plansRes.data ?? [];
    const freshTypes = new Map((typesRes.data ?? []).map((t) => [t.id, t.channex_id as string | null]));
    const chById: Record<string, string> = {};
    for (const p of freshPlans) chById[p.id] = p.channel_code;
    const missing = freshPlans.filter((p) => {
      if (!p.derived_from_id || p.channex_id) return false;
      const pc = chById[p.derived_from_id];
      return pc !== undefined && OTA_CHANNELS.includes(pc);
    });
    if (missing.length === 0) return { created, errors };
    const payloadPlans = [];
    for (const p of missing) {
      const parent = freshPlans.find((x) => x.id === p.derived_from_id);
      const typeChannexId = freshTypes.get(p.room_type_id) ?? null;
      // Tinh quy tac dan xuat tu cong thuc (bat ky % nao cung duoc) thay vi tra bang co dinh — bang cu thieu f-plus12/14/15/16/18.
      const formula = p.formula_id ? getFormula(p.formula_id) : undefined;
      const rule: [string, string] | undefined = formula
        ? formula.kind === "percent"
          ? [formula.value >= 0 ? "increase_by_percent" : "decrease_by_percent", String(Math.abs(formula.value))]
          : ["increase_by_amount", String(formula.value)]
        : undefined;
      if (!parent?.channex_id || !typeChannexId || !rule) {
        errors.push(`Gói ${p.name}: chưa tạo được vì thiếu gói gốc hoặc loại phòng trên Channex.`);
        continue;
      }
      payloadPlans.push({
        pmsId: p.id, title: p.name, mealType: p.meal_plan ?? "none", occupancy: p.base_occupancy ?? 2,
        roomTypeChannexId: typeChannexId, parentChannexId: parent.channex_id, rule,
      });
    }
    if (payloadPlans.length === 0) return { created, errors };
    const res = await fetch("/api/channex/setup-derived", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ propertyId: effPropertyId, plans: payloadPlans }),
    });
    const data = await res.json();
    if (!data.ok) return { created, errors: [...errors, data.error ?? "Tạo gói giá suy ra thất bại."] };
    for (const [pmsId, cid] of Object.entries(data.ratePlanIds ?? {})) {
      await supabase.from("rate_plans").update({ channex_id: cid }).eq("id", pmsId);
      const p = freshPlans.find((x) => x.id === pmsId);
      if (p) created.push(`Gói giá ${CHANNEL_NAMES[p.channel_code] ?? p.name}`);
    }
    errors.push(...(data.errors ?? []));
    return { created, errors };
  }

  // Nut duy nhat: chay buoc A (khach san + loai phong + goi chuan) roi buoc B (goi suy ra tu goi OTA),
  // xong tai lai trang thai va bao 1 cau duy nhat bang tieng Viet doi thuong.
  async function runAllMissing() {
    if (busy) return;
    setBusy(true);
    setMsg("");
    setErrors([]);
    const allCreated: string[] = [];
    const allErrors: string[] = [];
    const setup = await runSetupCore();
    allCreated.push(...setup.created);
    allErrors.push(...setup.errors);
    if (setup.propertyId) {
      const derived = await runDerivedCore(setup.propertyId);
      allCreated.push(...derived.created);
      allErrors.push(...derived.errors);
    }
    await load();
    setBusy(false);
    setErrors(allErrors);
    if (allCreated.length > 0 && allErrors.length === 0) {
      setMsg(`Đã tạo xong trên Channex: ${allCreated.join(", ")}.`);
    } else if (allCreated.length > 0) {
      setMsg(`Đã tạo được một phần: ${allCreated.join(", ")} — còn lỗi ở dưới, xem rồi báo tôi.`);
    } else if (allErrors.length === 0) {
      setMsg("Không còn mục nào thiếu để tạo.");
    }
  }

  const stepNum = (n: number) => (
    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-white">{n}</span>
  );
  const statusText = (done: boolean, note?: string) => (
    <span className={done ? "font-medium text-success" : "text-muted"}>{done ? "✓ Đã có" : note ?? "○ Chưa có"}</span>
  );

  return (
    <div className="cb-card mt-5 p-5">
      <h2 className="font-bold text-ink">Thiết lập Channex — {hotelName || HOTEL_ID}</h2>
      <p className="mt-1 text-sm text-muted">
        Để gửi giá và tồn phòng lên các kênh, Channex cần có 3 thứ theo thứ tự dưới đây. Mục nào còn thiếu thì bấm nút ở cuối để tạo.
        Gói Website và Lễ tân chỉ bán trong PMS, không gửi lên Channex.
      </p>
      {loading ? (
        <p className="mt-3 text-sm text-muted">Đang tải trạng thái...</p>
      ) : (
        <>
          <div className="mt-4">
            <div className="flex items-center gap-2">
              {stepNum(1)}
              <span className="font-semibold text-ink">Khách sạn</span>
              <span className="ml-auto text-sm">{statusText(!!propertyId)}</span>
            </div>
            <p className="mt-1 pl-8 text-xs text-muted">Channex cần biết khách sạn của anh trước — {hotelName || HOTEL_ID}.</p>
          </div>
          <div className="mt-4">
            <div className="flex items-center gap-2">
              {stepNum(2)}
              <span className="font-semibold text-ink">Loại phòng</span>
            </div>
            <p className="mt-1 pl-8 text-xs text-muted">Mỗi loại phòng cần có trên Channex thì mới gửi được tồn phòng.</p>
            <ul className="mt-2 space-y-1.5 pl-8">
              {types.map((t) => (
                <li key={t.id} className="flex items-center justify-between rounded-lg bg-primary-soft px-3 py-1.5 text-sm">
                  <span className="text-ink">{t.name} ({t.roomCount} phòng)</span>
                  {statusText(!!t.channexId)}
                </li>
              ))}
            </ul>
          </div>
          <div className="mt-4">
            <div className="flex items-center gap-2">
              {stepNum(3)}
              <span className="font-semibold text-ink">Gói giá từng kênh</span>
            </div>
            <p className="mt-1 pl-8 text-xs text-muted">Mỗi kênh cần 1 gói giá trên Channex thì PMS mới gửi giá lên được. Giá gói này do PMS tự tính từ giá gốc.</p>
            <ul className="mt-2 space-y-1.5 pl-8">
              {OTA_CHANNELS.map((code) => {
                const ps = plans.filter((p) => p.channelCode === code);
                const done = ps.length > 0 && ps.every((p) => !!p.channexId);
                const note = ps.length === 0 ? "○ Chưa có gói giá — nhập giá ở Lịch giá trước" : undefined;
                return (
                  <li key={code} className="flex items-center justify-between rounded-lg bg-primary-soft px-3 py-1.5 text-sm">
                    <span className="text-ink">{CHANNEL_NAMES[code]}</span>
                    {statusText(done, note)}
                  </li>
                );
              })}
            </ul>
          </div>
          <div className="mt-4 flex items-center gap-3">
            <button
              onClick={runAllMissing}
              disabled={busy || nothingToDo}
              className="cb-btn-primary px-4 py-2 text-sm disabled:opacity-60"
            >
              {busy ? "Đang tạo trên Channex..." : nothingToDo ? "Đã thiết lập đủ" : "Tạo phần còn thiếu trên Channex"}
            </button>
            {nothingToDo && <span className="text-sm text-success">Đã đủ — giá và tồn phòng đã có thể gửi lên Channex.</span>}
          </div>
          {msg && <p className="mt-3 rounded-lg bg-success-soft px-3 py-2 text-sm text-success">{msg}</p>}
          {errors.length > 0 && (
            <div className="mt-3 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
              {errors.map((e, i) => <p key={i}>{e}</p>)}
            </div>
          )}
        </>
      )}
    </div>
  );
}
