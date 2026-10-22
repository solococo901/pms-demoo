"use client";

// ============================================================
// CHANNEX SETUP — components/ChannexSetup.tsx
// One card on the Channels page: shows which parts of the
// pilot hotel are already mirrored on Channex (Property /
// room types / OTA base rate plans) and a button that
// creates the missing ones via /api/channex/setup, then
// saves the Channex ids back into Supabase (the mapping).
// Website + Front Desk plans are NOT sent to Channex, and
// derived plans are created in step C3b — by design.
// ============================================================

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { currentHotelId } from "@/lib/current-hotel";

const HOTEL_ID = currentHotelId();
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
    const priceByPlan = new Map<string, number>();
    if (otaPlans.length > 0) {
      const { data: priceRows } = await supabase
        .from("rate_prices").select("rate_plan_id, date, price")
        .in("rate_plan_id", otaPlans.map((p) => p.id))
        .order("date");
      for (const pr of priceRows ?? []) {
        if (pr.date === "2026-10-21" || !priceByPlan.has(pr.rate_plan_id)) {
          priceByPlan.set(pr.rate_plan_id, pr.price);
        }
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
    setMsg("Đã tạo xong phần cấu trúc còn thiếu trên Channex và lưu mã ánh xạ về kho.");
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

  const row = (label: string, done: boolean, note?: string, rowKey?: string) => (
    <li key={rowKey ?? label} className="flex items-center justify-between rounded-lg bg-[#f4f7fb] px-3 py-1.5 text-sm">
      <span className="text-[#17293e]">{label}</span>
      <span className={done ? "font-medium text-[#0e7a56]" : "text-[#68707a]"}>
        {done ? "✓ Đã có trên Channex" : note ?? "○ Chưa tạo"}
      </span>
    </li>
  );

  return (
    <div className="cb-card mt-5 p-5">
      <h2 className="font-bold text-[#17293e]">Thiết lập cấu trúc trên Channex — {hotelName || HOTEL_ID}</h2>
      <p className="mt-1 text-sm text-[#68707a]">
        Channex cần biết khách sạn (Property), các loại phòng và các gói giá OTA trước khi nhận giá và tồn phòng.
        Gói Website và Lễ tân không gửi lên Channex (chỉ bán trong PMS).
      </p>
      {loading ? (
        <p className="mt-3 text-sm text-[#68707a]">Đang tải trạng thái ánh xạ...</p>
      ) : (
        <>
          <ul className="mt-3 space-y-1.5">
            {row(`Property — ${hotelName || HOTEL_ID}`, !!propertyId)}
            {types.map((t) => row(`Loại phòng — ${t.name} (${t.roomCount} phòng)`, !!t.channexId))}
            {plans.map((p) =>
              row(
                `Gói giá OTA — ${p.name}`,
                !!p.channexId,
                p.derived ? "○ Gói kế thừa — chưa tạo" : "○ Chưa tạo",
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
            {nothingToDo && <span className="text-sm text-[#0e7a56]">Cấu trúc gốc đã sẵn sàng cho bước đẩy giá & tồn (C3c).</span>}
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
              <span className="text-xs text-[#68707a]">Gói kế thừa dùng cơ chế giá dẫn xuất của Channex — khớp công thức trong PMS.</span>
            </div>
          )}
          {msg && <p className="mt-3 rounded-lg bg-[#e6f7f1] px-3 py-2 text-sm text-[#0e7a56]">{msg}</p>}
          {errors.length > 0 && (
            <div className="mt-3 rounded-lg bg-[#fdecec] px-3 py-2 text-sm text-[#e5484d]">
              {errors.map((e, i) => <p key={i}>{e}</p>)}
            </div>
          )}
        </>
      )}
    </div>
  );
}
