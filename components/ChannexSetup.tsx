"use client";

// NATEUI23 — components/ChannexSetup.tsx (the tao cau truc tren Channex)
// Cho biet phan nao cua khach san da co tren Channex (Property / loai phong / goi gia OTA) va nut tao phan con thieu, roi luu ma anh xa ve Supabase.
// Doi sang token toi gian 2026-11-21.

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { currentHotelId } from "@/lib/current-hotel";
import { useParams } from "next/navigation";

const OTA_CHANNELS = ["booking_com", "expedia", "airbnb", "agoda"];

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

// PMS formulas -> Channex derived-option rules.
const FORMULA_RULES: Record<string, [string, string]> = {
  "f-minus10": ["decrease_by_percent", "10"],
  "f-minus5": ["decrease_by_percent", "5"],
  "f-plus2": ["increase_by_percent", "2"],
  "f-plus100k": ["increase_by_amount", "100000"],
};

export default function ChannexSetup() {
  // Khach san lay tu URL khi co, khong thi dung khach san da luu theo tab.
  const params = useParams();
  const HOTEL_ID = typeof params.hotelId === "string" ? params.hotelId : currentHotelId();
  const [loading, setLoading] = useState(true);
  const [propertyId, setPropertyId] = useState<string | null>(null);
  const [types, setTypes] = useState<TypeRow[]>([]);
  const [plans, setPlans] = useState<PlanRow[]>([]);
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
  const missingPlans = plans.filter((p) => !p.channexId && !p.derived);
  const nothingToDo = !!propertyId && missingTypes.length === 0 && missingPlans.length === 0;

  async function runSetup() {
    setBusy(true);
    setMsg("");
    setErrors([]);
    const res = await fetch("/api/channex/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        propertyId,
        property: hotelPayload,
        // SETUP2: gui kem ma Channex cua loai phong DA CO — dot chay them (Expedia) khong con loai phong nao thieu
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
    if (!data.ok) {
      setMsg("");
      setErrors([data.error ?? "Thiết lập thất bại."]);
      setBusy(false);
      return;
    }
    // Save the mapping back into Supabase.
    if (data.propertyId && data.propertyId !== propertyId) {
      await supabase.from("channel_connections")
        .update({ external_property_id: data.propertyId, status: "connected" })
        .eq("hotel_id", HOTEL_ID).eq("provider", "channex");
    }
    for (const [pmsId, cid] of Object.entries(data.roomTypeIds ?? {})) {
      await supabase.from("room_types").update({ channex_id: cid }).eq("id", pmsId);
    }
    for (const [pmsId, cid] of Object.entries(data.ratePlanIds ?? {})) {
      await supabase.from("rate_plans").update({ channex_id: cid }).eq("id", pmsId);
    }
    setErrors(data.errors ?? []);
    // SETUP2: co loi thi dung noi "da tao xong" nua — thong bao xanh hien cung o do rat de hieu lam.
    setMsg(
      (data.errors ?? []).length > 0
        ? "Đã tạo được một phần — còn lỗi ở dưới, xem rồi báo tôi."
        : "Đã tạo xong phần cấu trúc còn thiếu trên Channex và lưu mã ánh xạ về kho."
    );
    await load();
    setBusy(false);
  }

  const derivedMissing = plans.filter((p) => p.derived && !p.channexId);
  const [busyDerived, setBusyDerived] = useState(false);

  async function runDerived() {
    if (!propertyId) return;
    setBusyDerived(true);
    setMsg("");
    setErrors([]);
    const payloadPlans = [];
    const localErrors: string[] = [];
    for (const p of derivedMissing) {
      const parent = plans.find((x) => x.id === p.parentPmsId);
      const typeRow = types.find((t) => t.id === p.roomTypeId);
      const rule = p.formulaId ? FORMULA_RULES[p.formulaId] : undefined;
      if (!parent?.channexId || !typeRow?.channexId || !rule) {
        localErrors.push(`Gói ${p.name}: thiếu gói gốc, loại phòng hoặc công thức để tạo kế thừa.`);
        continue;
      }
      payloadPlans.push({
        pmsId: p.id, title: p.name, mealType: p.mealPlan, occupancy: p.baseOccupancy,
        roomTypeChannexId: typeRow.channexId, parentChannexId: parent.channexId, rule,
      });
    }
    if (payloadPlans.length > 0) {
      const res = await fetch("/api/channex/setup-derived", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ propertyId, plans: payloadPlans }),
      });
      const data = await res.json();
      if (!data.ok) {
        localErrors.push(data.error ?? "Tạo gói kế thừa thất bại.");
      } else {
        for (const [pmsId, cid] of Object.entries(data.ratePlanIds ?? {})) {
          await supabase.from("rate_plans").update({ channex_id: cid }).eq("id", pmsId);
        }
        localErrors.push(...(data.errors ?? []));
        if (Object.keys(data.ratePlanIds ?? {}).length > 0) {
          setMsg("Đã tạo các gói kế thừa trên Channex — giá của chúng sẽ tự chạy theo gói gốc.");
        }
      }
    }
    setErrors(localErrors);
    await load();
    setBusyDerived(false);
  }

  // Gia goc hien cho nguoi xem truoc khi bam tao — phai la gia ngay hom nay, khong phai gia ngay mau.
  const fmtRate = (rate: string) => {
    const n = Number(rate);
    return (hotelPayload.currency ?? "VND") === "USD"
      ? `$${n.toLocaleString("en-US")}`
      : `${n.toLocaleString("vi-VN")}₫`;
  };

  const row = (label: string, done: boolean, note?: string, rowKey?: string) => (
    <li key={rowKey ?? label} className="flex items-center justify-between rounded-lg bg-primary-soft px-3 py-1.5 text-sm">
      <span className="text-ink">{label}</span>
      <span className={done ? "font-medium text-success" : "text-muted"}>
        {done ? "✓ Đã có trên Channex" : note ?? "○ Chưa tạo"}
      </span>
    </li>
  );

  return (
    <div className="cb-card mt-5 p-5">
      <h2 className="font-bold text-ink">Thiết lập cấu trúc trên Channex — {hotelName || HOTEL_ID}</h2>
      <p className="mt-1 text-sm text-muted">
        Channex cần biết khách sạn (Property), các loại phòng và các gói giá OTA trước khi nhận giá và tồn phòng.
        Gói Website và Lễ tân không gửi lên Channex (chỉ bán trong PMS).
      </p>
      {loading ? (
        <p className="mt-3 text-sm text-muted">Đang tải trạng thái ánh xạ...</p>
      ) : (
        <>
          <ul className="mt-3 space-y-1.5">
            {row(`Property — ${hotelName || HOTEL_ID}`, !!propertyId)}
            {types.map((t) => row(`Loại phòng — ${t.name} (${t.roomCount} phòng)`, !!t.channexId))}
            {plans.map((p) =>
              row(
                `Gói giá OTA — ${p.name}`,
                !!p.channexId,
                p.derived ? "○ Gói kế thừa — chưa tạo" : `○ Chưa tạo · giá gốc ${fmtRate(p.rate)}`,
                p.id
              )
            )}
          </ul>
          <div className="mt-4 flex items-center gap-3">
            <button
              onClick={runSetup}
              disabled={busy || nothingToDo}
              className="cb-btn-primary px-4 py-2 text-sm disabled:opacity-60"
            >
              {busy ? "Đang tạo trên Channex..." : nothingToDo ? "Đã thiết lập đủ" : "Tạo cấu trúc trên Channex"}
            </button>
            {nothingToDo && <span className="text-sm text-success">Cấu trúc gốc đã sẵn sàng cho bước đẩy giá & tồn (C3c).</span>}
          </div>
          {derivedMissing.length > 0 && (
            <div className="mt-3 flex items-center gap-3">
              <button
                onClick={runDerived}
                disabled={busyDerived || !propertyId}
                className="cb-btn-ghost px-4 py-2 text-sm disabled:opacity-60"
              >
                {busyDerived ? "Đang tạo gói kế thừa..." : `Tạo ${derivedMissing.length} gói kế thừa trên Channex`}
              </button>
              <span className="text-xs text-muted">Gói kế thừa dùng cơ chế giá dẫn xuất của Channex — khớp công thức trong PMS.</span>
            </div>
          )}
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
