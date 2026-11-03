"use client";
// ============================================================
// app/[hotelId]/rate-plans/page.tsx — trang Gói giá, kieu "bang
// dieu khien gia theo kenh": gom theo tung kenh, moi kenh 1 muc.
//   - Moi dong goi chi hien: ten goi, loai phong, huy, GIA HOM NAY
//     that (lay tu rate_prices ngay hien tai) — khong co gia mau,
//     khong co goi an (hien tai khach san chua kem goi an).
//   - Goi ke thua khong hien gia ao: chi ghi 1 dong "Theo: <goi
//     goc> <cong thuc>" (gia that chay theo goi goc, xem o Lich gia).
//   - Tao goi chi hoi: kenh, loai phong, ten, huy. Goi moi khong
//     co gia san — sang Lich gia set gia moi ban duoc.
//   - Sua goi: doi ten + huy (2 thu chi nam o PMS, khong day
//     sang kenh). Xoa goi: xoa that xuong DB, nhung chan khi goi
//     da noi Channex hoac dang co don dung.
// ============================================================

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { CHANNELS, getFormula, type RatePlan, type RoomType } from "@/lib/mock-data";
import { supabase } from "@/lib/supabase";
import { currentHotelId } from "@/lib/current-hotel";

const ACCOUNT_ID = "11111111-1111-1111-1111-111111111111";
const fmt = (n: number) => n.toLocaleString("vi-VN");
const inputSm =
  "rounded-lg border border-[#dde3ea] bg-white px-3 py-2 text-sm outline-none focus:border-[#2563eb]";

// RatePlan cua app + ma noi Channex (de chan xoa goi da noi kenh)
// + co dang ban (cot active cua bang rate_plans).
type PlanRow = RatePlan & { channexId?: string; active?: boolean };

export default function RatePlansPage() {
  const params = useParams();
  const HOTEL_ID = typeof params.hotelId === "string" ? params.hotelId : currentHotelId();
  const [roomTypes, setRoomTypes] = useState<RoomType[]>([]);
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [currency, setCurrency] = useState("VND");
  const [todayStr, setTodayStr] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [planChannel, setPlanChannel] = useState("booking_com");
  const [planRoomType, setPlanRoomType] = useState("");
  const [planName, setPlanName] = useState("");
  const [planPolicy, setPlanPolicy] = useState<"flexible" | "non_refundable">("flexible");

  // Cac muc kenh mo san (giong dropdown aside: an de dong, an nua de mo).
  const [openChannels, setOpenChannels] = useState<Set<string>>(() => new Set(CHANNELS.map((c) => c.code)));
  const toggleChannel = (code: string) =>
    setOpenChannels((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });

  // Sua goi (chi ten + huy).
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editPolicy, setEditPolicy] = useState<"flexible" | "non_refundable">("flexible");

  const fmtMoney = (n: number) =>
    currency === "USD" ? `$${n.toLocaleString("en-US")}` : `${fmt(n)}₫`;

  const formulaText = (p: PlanRow) => {
    const f = getFormula(p.formulaId);
    if (!f) return "theo gói gốc";
    if (f.kind === "percent") return f.value < 0 ? `−${-f.value}%` : `+${f.value}%`;
    return f.value < 0 ? `−${fmtMoney(-f.value)}` : `+${fmtMoney(f.value)}`;
  };

  useEffect(() => {
    (async () => {
      const [typesRes, plansRes, hotelRes] = await Promise.all([
        supabase.from("room_types").select("*").eq("hotel_id", HOTEL_ID),
        supabase.from("rate_plans").select("*").eq("hotel_id", HOTEL_ID),
        supabase.from("hotels").select("currency").eq("id", HOTEL_ID).single(),
      ]);
      if (typesRes.error || plansRes.error) {
        setLoadError((typesRes.error ?? plansRes.error)?.message ?? "Không đọc được dữ liệu");
        setLoading(false);
        return;
      }
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
      if (types[0]) setPlanRoomType(types[0].id);
      const planRows = plansRes.data ?? [];
      // Supabase tra toi da 1000 dong/lan — phai lay theo trang.
      let priceRows: { rate_plan_id: string; date: string; price: number }[] = [];
      if (planRows.length > 0) {
        for (let from = 0; ; from += 1000) {
          const { data: page } = await supabase
            .from("rate_prices").select("rate_plan_id, date, price")
            .in("rate_plan_id", planRows.map((p) => p.id))
            .range(from, from + 999);
          priceRows = [...priceRows, ...(page ?? [])];
          if (!page || page.length < 1000) break;
        }
      }
      const pricesByPlan = new Map<string, Record<string, number>>();
      for (const pr of priceRows) {
        const m = pricesByPlan.get(pr.rate_plan_id) ?? {};
        m[pr.date] = pr.price;
        pricesByPlan.set(pr.rate_plan_id, m);
      }
      setPlans(planRows.map((pl) => ({
        id: pl.id, channelCode: pl.channel_code, roomTypeId: pl.room_type_id, name: pl.name,
        policyId: pl.policy_id ?? undefined,
        publicName: pl.public_name ?? undefined,
        mealPlan: (pl.meal_plan ?? undefined) as PlanRow["mealPlan"],
        baseOccupancy: pl.base_occupancy ?? undefined,
        extraAdultFee: pl.extra_adult_fee ?? undefined, extraChildFee: pl.extra_child_fee ?? undefined,
        cancellationPolicy: (pl.cancellation_policy ?? "flexible") as PlanRow["cancellationPolicy"],
        derivedFromId: pl.derived_from_id ?? undefined, formulaId: pl.formula_id ?? undefined,
        channexId: pl.channex_id ?? undefined,
        active: pl.active !== false,
        prices: pricesByPlan.get(pl.id) ?? {},
      })));
      if (hotelRes.data?.currency) setCurrency(hotelRes.data.currency);
      // Ngay hien tai theo gio dia phuong (tinh o client, sau khi
      // mount, de khong lech ngay khi render phia may chu).
      const d = new Date();
      setTodayStr(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function addPlan() {
    if (!planName.trim()) return alert("Chưa nhập tên gói giá.");
    if (!planRoomType) return alert("Tạo loại phòng trước, rồi mới tạo gói giá.");
    const newPlan: PlanRow = {
      id: `plan-${Date.now()}`, channelCode: planChannel, roomTypeId: planRoomType,
      name: planName.trim(), cancellationPolicy: planPolicy, mealPlan: "room_only",
      prices: {},
    };
    const { error } = await supabase.from("rate_plans").insert({
      id: newPlan.id, hotel_id: HOTEL_ID, account_id: ACCOUNT_ID,
      room_type_id: newPlan.roomTypeId, channel_code: newPlan.channelCode,
      name: newPlan.name, cancellation_policy: newPlan.cancellationPolicy,
      meal_plan: "room_only",
      policy_id: null,
    });
    if (error) return alert("Tạo gói giá trong cơ sở dữ liệu không thành công: " + error.message);
    setPlans((p) => [...p, newPlan]);
    setPlanName("");
  }

  function startEdit(p: PlanRow) {
    setEditingId(p.id);
    setEditName(p.name);
    setEditPolicy(p.cancellationPolicy);
  }

  async function saveEdit() {
    if (!editingId || !editName.trim()) return alert("Chưa nhập tên gói giá.");
    const { error } = await supabase.from("rate_plans")
      .update({ name: editName.trim(), cancellation_policy: editPolicy })
      .eq("id", editingId);
    if (error) return alert("Lưu không thành công: " + error.message);
    setPlans((prev) => prev.map((p) => (p.id === editingId ? { ...p, name: editName.trim(), cancellationPolicy: editPolicy } : p)));
    setEditingId(null);
  }

  async function deletePlan(p: PlanRow) {
    if (p.channexId) return alert("Gói này đã nối Channex — cần gỡ nối ở trang Kênh bán trước khi xoá.");
    const { count, error: cntErr } = await supabase.from("reservations")
      .select("id", { count: "exact", head: true }).eq("rate_plan_id", p.id);
    if (cntErr) return alert("Không kiểm tra được đơn dùng gói: " + cntErr.message);
    if (count && count > 0) return alert(`Gói đang có ${count} đơn dùng, không xoá được.`);
    if (!window.confirm(`Xoá gói "${p.name}"? Giá của gói cũng bị xoá theo.`)) return;
    const { error: priceErr } = await supabase.from("rate_prices").delete().eq("rate_plan_id", p.id);
    if (priceErr) return alert("Xoá giá không thành công: " + priceErr.message);
    const { error } = await supabase.from("rate_plans").delete().eq("id", p.id);
    if (error) return alert("Xoá gói không thành công: " + error.message);
    setPlans((prev) => prev.filter((x) => x.id !== p.id));
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-[#17293e]">Gói giá</h1>
      <p className="mt-1 text-sm text-[#68707a]">
        Giá bán theo từng kênh, gom theo kênh. Giá từng ngày sửa ở trang{" "}
        <Link href={`/${HOTEL_ID}/rates`} className="text-[#2563eb] hover:underline">Lịch giá</Link>.
      </p>

      {loading && <p className="mt-4 text-sm text-[#68707a]">Đang tải dữ liệu từ Supabase...</p>}
      {loadError && <p className="mt-4 text-sm text-[#e5484d]">Không đọc được dữ liệu từ Supabase: {loadError}</p>}

      {/* ---------- Sua goi (chi ten + huy) ---------- */}
      {editingId && (
        <div className="cb-card mt-5 p-5">
          <h2 className="text-base font-bold text-[#17293e]">Sửa gói giá</h2>
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <input className={inputSm} value={editName} onChange={(e) => setEditName(e.target.value)} />
            <select className={inputSm} value={editPolicy} onChange={(e) => setEditPolicy(e.target.value as typeof editPolicy)}>
              <option value="flexible">Huỷ linh hoạt</option>
              <option value="non_refundable">Không hoàn tiền</option>
            </select>
            <button className="cb-btn-primary px-4 py-2 text-sm" onClick={saveEdit}>Lưu</button>
            <button className="cb-btn-ghost px-4 py-2 text-sm" onClick={() => setEditingId(null)}>Huỷ</button>
          </div>
        </div>
      )}

      {/* ---------- Cac muc kenh ---------- */}
      {CHANNELS.map((ch) => {
        const chPlans = plans.filter((p) => p.channelCode === ch.code);
        const open = openChannels.has(ch.code);
        return (
          <div key={ch.code} className="cb-card mt-5 p-5">
            <button
              onClick={() => toggleChannel(ch.code)}
              aria-expanded={open}
              className="flex w-full items-center justify-between text-left"
            >
              <span className="text-base font-bold text-[#17293e]">
                {ch.name} <span className="ml-1 text-sm font-normal text-[#68707a]">({chPlans.length} gói)</span>
              </span>
              <svg className={`h-4 w-4 shrink-0 text-[#68707a] transition-transform ${open ? "" : "rotate-180"}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M6 15l6-6 6 6" />
              </svg>
            </button>
            {open && (
              <table className="mt-3 w-full text-sm">
                <thead>
                  <tr className="border-b border-[#eef1f5] text-left text-xs uppercase tracking-wide text-[#68707a]">
                    <th className="py-2 pr-3 font-semibold">Gói giá</th>
                    <th className="py-2 pr-3 font-semibold">Loại phòng</th>
                    <th className="py-2 pr-3 font-semibold">Chính sách huỷ</th>
                    <th className="py-2 pr-3 font-semibold">Giá hôm nay</th>
                    <th className="py-2 text-right font-semibold"></th>
                  </tr>
                </thead>
                <tbody>
                  {chPlans.map((p) => (
                    <tr key={p.id} className="border-b border-[#eef1f5]">
                      <td className="py-2.5 pr-3 font-medium text-[#17293e]">
                        {p.name}
                        {p.active === false && (
                          <span className="ml-2 rounded-full bg-[#fef3f2] px-2 py-0.5 text-xs font-medium text-[#e5484d]">Ngừng bán</span>
                        )}
                      </td>
                      <td className="py-2.5 pr-3">{roomTypes.find((t) => t.id === p.roomTypeId)?.name ?? p.roomTypeId}</td>
                      <td className="py-2.5 pr-3">{p.cancellationPolicy === "flexible" ? "Huỷ linh hoạt" : "Không hoàn tiền"}</td>
                      <td className="py-2.5 pr-3">
                        {p.derivedFromId ? (
                          <span className="text-[#68707a]">
                            Theo: {plans.find((b) => b.id === p.derivedFromId)?.name ?? "gói gốc"} {formulaText(p)}
                          </span>
                        ) : todayStr && p.prices[todayStr] !== undefined ? (
                          fmtMoney(p.prices[todayStr])
                        ) : (
                          <span className="text-[#e5484d]">Chưa set giá</span>
                        )}
                      </td>
                      <td className="py-2.5 text-right">
                        <button onClick={() => startEdit(p)} className="mr-3 font-medium text-[#2563eb] hover:underline">Sửa</button>
                        <button onClick={() => deletePlan(p)} className="font-medium text-[#e5484d] hover:underline">Xoá</button>
                      </td>
                    </tr>
                  ))}
                  {chPlans.length === 0 && (
                    <tr><td colSpan={5} className="py-6 text-center text-[#68707a]">Chưa có gói giá nào.</td></tr>
                  )}
                </tbody>
              </table>
            )}
          </div>
        );
      })}

      {/* ---------- Tao goi moi (khong hoi gia, khong hoi goi an) ---------- */}
      <div className="cb-card mt-5 p-5">
        <h2 className="text-base font-bold text-[#17293e]">Tạo gói giá mới</h2>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <select className={inputSm} value={planChannel} onChange={(e) => setPlanChannel(e.target.value)}>
            {CHANNELS.map((c) => (<option key={c.code} value={c.code}>{c.name}</option>))}
          </select>
          <select className={inputSm} value={planRoomType} onChange={(e) => setPlanRoomType(e.target.value)}>
            {roomTypes.map((t) => (<option key={t.id} value={t.id}>{t.name}</option>))}
          </select>
          <input className={inputSm} placeholder="Tên gói, VD: BDC - Flexible" value={planName} onChange={(e) => setPlanName(e.target.value)} />
          <select className={inputSm} value={planPolicy} onChange={(e) => setPlanPolicy(e.target.value as typeof planPolicy)}>
            <option value="flexible">Huỷ linh hoạt</option>
            <option value="non_refundable">Không hoàn tiền</option>
          </select>
          <button className="cb-btn-primary px-4 py-2 text-sm" onClick={addPlan}>+ Tạo gói giá</button>
        </div>
        <p className="mt-2 text-xs text-[#68707a]">Gói mới chưa có giá — sang Lịch giá set giá mới bán được.</p>
      </div>
    </div>
  );
}
