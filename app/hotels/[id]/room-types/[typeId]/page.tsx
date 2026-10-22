"use client";
// ============================================================
// FILE B — app/hotels/[id]/room-types/[typeId]/page.tsx
// Detail page of ONE room type (ezCloud-style, 3 tabs):
//   1. Thông tin phòng — name, descriptions, occupancy (4
//      numbers), size, safe price range, bed options, views,
//      and a READ-ONLY summary of the prices per channel.
//      (Prices are NOT edited here — in this PMS prices live
//      in per-channel rate plans, edited on /rates.)
//   2. Tiện ích phòng — amenities of this room type only.
//   3. Hình ảnh phòng — photos of this room type; the first
//      photo is its cover on the booking engine.
// Total rooms is COUNTED from the physical rooms list (the
// hotel detail page), never typed by hand.
// Round A: everything is local state — F5 resets, saves are
// simulated, exactly like the other pages.
// ============================================================

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import {
  ROOM_AMENITY_GROUPS,
  ROOM_VIEWS,
  getChannelName,
  resolvePlanPrice,
  type HotelPhoto,
  type RatePlan,
  type RoomType,
} from "@/lib/mock-data";

const fmt = (n: number) => n.toLocaleString("vi-VN");
const inputCls = "w-full rounded-lg border border-[#dde3ea] px-3 py-2 text-sm text-[#17293e] outline-none focus:border-[#2563eb]";
const labelCls = "block text-xs font-medium text-[#68707a]";

type TabKey = "info" | "amenities" | "photos";
const TABS: { key: TabKey; label: string }[] = [
  { key: "info", label: "Thông tin phòng" },
  { key: "amenities", label: "Tiện ích phòng" },
  { key: "photos", label: "Hình ảnh phòng" },
];

export default function RoomTypeDetailPage({ params }: { params: Promise<{ id: string; typeId: string }> }) {
  const { id, typeId } = use(params);

  const [hotelName, setHotelName] = useState("");
  const [tab, setTab] = useState<TabKey>("info");
  const [type, setType] = useState<RoomType | null>(null);
  const [roomCount, setRoomCount] = useState(0);
  const [typePlans, setTypePlans] = useState<RatePlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [dbError, setDbError] = useState("");
  const [savedMsg, setSavedMsg] = useState("");
  const [newBed, setNewBed] = useState("");

  // ----- LOAD this room type (+ its plans) from Supabase -----
  useEffect(() => {
    (async () => {
      const { data: hotelRow } = await supabase.from("hotels").select("name").eq("id", id).single();
      if (hotelRow) setHotelName(hotelRow.name);
      const { data: t, error } = await supabase.from("room_types").select("*").eq("id", typeId).single();
      if (error || !t) { setLoading(false); return; }
      const d = (t.details ?? {}) as Record<string, any>;
      setType({
        id: t.id, code: t.code ?? undefined, name: t.name,
        maxOccupancy: t.occupancy, maxAdults: t.max_adults, maxChildren: t.max_children,
        maxInfants: t.max_infants, sizeM2: t.size_sqm ?? undefined,
        bedConfig: t.bed_config ?? "—", priceFloor: t.min_price ?? undefined, priceCeiling: t.max_price ?? undefined,
        descriptionVi: t.description_vi ?? undefined, descriptionEn: t.description_en ?? undefined,
        views: d.views ?? [], bedOptions: d.bedOptions ?? [], photos: d.photos ?? [], amenities: d.amenities ?? [],
        active: t.active !== false,
      });
      const { data: roomRows } = await supabase.from("rooms").select("id").eq("hotel_id", id).eq("room_type_id", typeId);
      setRoomCount(roomRows?.length ?? 0);

      const { data: planRows } = await supabase.from("rate_plans").select("*").eq("hotel_id", id);
      const allPlans: RatePlan[] = (planRows ?? []).map((pl) => ({
        id: pl.id, channelCode: pl.channel_code, roomTypeId: pl.room_type_id, name: pl.name,
        publicName: pl.public_name ?? undefined,
        mealPlan: (pl.meal_plan ?? undefined) as RatePlan["mealPlan"],
        baseOccupancy: pl.base_occupancy ?? undefined,
        extraAdultFee: pl.extra_adult_fee ?? undefined, extraChildFee: pl.extra_child_fee ?? undefined,
        cancellationPolicy: (pl.cancellation_policy ?? "flexible") as RatePlan["cancellationPolicy"],
        derivedFromId: pl.derived_from_id ?? undefined, formulaId: pl.formula_id ?? undefined,
        prices: {},
      }));
      if (allPlans.length > 0) {
        const { data: priceRows } = await supabase
          .from("rate_prices").select("rate_plan_id, date, price")
          .in("rate_plan_id", allPlans.map((pl) => pl.id));
        const overrides: Record<string, number> = {};
        for (const pr of priceRows ?? []) {
          const plan = allPlans.find((pl) => pl.id === pr.rate_plan_id);
          if (!plan) continue;
          if (plan.derivedFromId) overrides[`${pr.rate_plan_id}|${pr.date}`] = pr.price;
          else plan.prices[pr.date] = pr.price;
        }
        for (const plan of allPlans) {
          if (!plan.derivedFromId) continue;
          for (const date of ["2026-10-21", "2026-10-24"]) {
            const v = resolvePlanPrice(plan, date, allPlans, overrides);
            if (v !== undefined) plan.prices[date] = v;
          }
        }
      }
      setTypePlans(allPlans.filter((pl) => pl.roomTypeId === typeId));
      setLoading(false);
    })();
  }, [id, typeId]);

  if (loading) {
    return (
      <div>
        <Link href={`/hotels/${id}`} className="text-sm text-[#2563eb] hover:underline">← Quay lại khách sạn</Link>
        <p className="mt-4 text-sm text-[#68707a]">Đang tải dữ liệu từ Supabase...</p>
      </div>
    );
  }

  if (!type) {
    return (
      <div>
        <Link href={`/hotels/${id}`} className="text-sm text-[#2563eb] hover:underline">← Quay lại khách sạn</Link>
        <div className="cb-card mt-4 p-8 text-center text-[#68707a]">Không tìm thấy loại phòng này trong khách sạn {hotelName || id}.</div>
      </div>
    );
  }

  const set = <K extends keyof RoomType>(field: K, value: RoomType[K]) => {
    setType((prev) => (prev ? { ...prev, [field]: value } : prev));
    setSavedMsg("");
  };
  const toggleIn = (field: "views" | "amenities", key: string) => {
    const list = type[field] ?? [];
    set(field, list.includes(key) ? list.filter((k) => k !== key) : [...list, key]);
  };
  const save = async () => {
    const { error } = await supabase.from("room_types").update({
      code: type.code ?? null, name: type.name,
      max_adults: type.maxAdults ?? 2, max_children: type.maxChildren ?? 0,
      max_infants: type.maxInfants ?? 0, occupancy: type.maxOccupancy,
      size_sqm: type.sizeM2 ?? null, bed_config: type.bedConfig,
      min_price: type.priceFloor ?? null, max_price: type.priceCeiling ?? null,
      description_vi: type.descriptionVi ?? null, description_en: type.descriptionEn ?? null,
      active: type.active !== false,
      details: {
        views: type.views ?? [], bedOptions: type.bedOptions ?? [],
        photos: type.photos ?? [], amenities: type.amenities ?? [],
      },
    }).eq("id", typeId);
    if (error) setDbError(error.message);
    setSavedMsg(error ? "Lỗi khi lưu: " + error.message : "✓ Đã lưu vào cơ sở dữ liệu.");
  };

  return (
    <div>
      <Link href={`/hotels/${id}`} className="text-sm text-[#2563eb] hover:underline">← Quay lại {hotelName || "khách sạn"}</Link>
      {dbError && <p className="mt-3 rounded-lg bg-[#fdecec] px-3 py-2 text-sm text-[#e5484d]">Lỗi cơ sở dữ liệu: {dbError}</p>}

      {/* header */}
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold text-[#17293e]">{type.name}</h1>
        {type.code && <span className="rounded bg-[#eef1f5] px-2 py-0.5 text-xs font-semibold text-[#68707a]">{type.code}</span>}
        <button
          onClick={() => set("active", type.active === false ? true : false)}
          className={`rounded-full px-3 py-1 text-xs font-medium ${type.active === false ? "bg-[#eef1f5] text-[#68707a]" : "bg-[#e6f7f1] text-[#0e7a56]"}`}
          title="Bấm để bật/tắt bán loại phòng này"
        >
          {type.active === false ? "○ Đã ngừng bán" : "● Đang bán"}
        </button>
        <span className="text-sm text-[#68707a]">
          {roomCount} phòng vật lý{type.sizeM2 ? ` · ${type.sizeM2} m²` : ""} · tối đa {type.maxOccupancy} khách
        </span>
      </div>

      {/* tabs */}
      <div className="mt-4 flex gap-1 border-b border-[#dde3ea]">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`border-b-2 px-4 py-2 text-sm ${tab === t.key ? "border-[#2563eb] font-semibold text-[#2563eb]" : "border-transparent text-[#68707a] hover:text-[#17293e]"}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ================= TAB 1 — info ================= */}
      {tab === "info" && (
        <div className="cb-card mt-4 space-y-6 p-5">
          <div>
            <GroupTitle title="THÔNG TIN PHÒNG" />
            <div className="grid gap-3">
              <div>
                <label className={labelCls}>Tên loại phòng</label>
                <input className={inputCls} value={type.name} maxLength={250} onChange={(e) => set("name", e.target.value)} />
                <div className="mt-0.5 text-right text-[11px] text-[#9aa7b4]">{type.name.length} / 250</div>
              </div>
              <div>
                <label className={labelCls}>Mô tả (tiếng Việt)</label>
                <textarea className={inputCls} rows={3} maxLength={3000} value={type.descriptionVi ?? ""} onChange={(e) => set("descriptionVi", e.target.value)} />
                <div className="mt-0.5 text-right text-[11px] text-[#9aa7b4]">{(type.descriptionVi ?? "").length} / 3000</div>
              </div>
              <div>
                <label className={labelCls}>Mô tả (English)</label>
                <textarea className={inputCls} rows={3} maxLength={3000} value={type.descriptionEn ?? ""} onChange={(e) => set("descriptionEn", e.target.value)} />
                <div className="mt-0.5 text-right text-[11px] text-[#9aa7b4]">{(type.descriptionEn ?? "").length} / 3000</div>
              </div>
            </div>
          </div>

          <div>
            <GroupTitle title="CẤU HÌNH BUỒNG PHÒNG" />
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <label className={labelCls}>Mã loại phòng (dùng để mapping kênh)</label>
                <input className={`${inputCls} bg-[#f7f9fb]`} value={type.code ?? ""} readOnly />
              </div>
              <div>
                <label className={labelCls}>Kiểu giường chính</label>
                <input className={inputCls} value={type.bedConfig} onChange={(e) => set("bedConfig", e.target.value)} />
              </div>
              <div>
                <label className={labelCls}>Tổng số phòng (tự đếm)</label>
                <input className={`${inputCls} bg-[#f7f9fb]`} value={roomCount} readOnly />
              </div>
              <div>
                <label className={labelCls}>Kích thước phòng (m²)</label>
                <input type="number" min={0} className={inputCls} value={type.sizeM2 ?? ""} onChange={(e) => set("sizeM2", e.target.value ? Number(e.target.value) : undefined)} />
              </div>
              <div>
                <label className={labelCls}>Số khách tối đa</label>
                <input type="number" min={1} className={inputCls} value={type.maxOccupancy} onChange={(e) => set("maxOccupancy", Number(e.target.value))} />
              </div>
              <div>
                <label className={labelCls}>Số người lớn tối đa</label>
                <input type="number" min={0} className={inputCls} value={type.maxAdults ?? ""} onChange={(e) => set("maxAdults", e.target.value ? Number(e.target.value) : undefined)} />
              </div>
              <div>
                <label className={labelCls}>Số trẻ em tối đa</label>
                <input type="number" min={0} className={inputCls} value={type.maxChildren ?? ""} onChange={(e) => set("maxChildren", e.target.value ? Number(e.target.value) : undefined)} />
              </div>
              <div>
                <label className={labelCls}>Số em bé tối đa</label>
                <input type="number" min={0} className={inputCls} value={type.maxInfants ?? ""} onChange={(e) => set("maxInfants", e.target.value ? Number(e.target.value) : undefined)} />
              </div>
            </div>
          </div>

          <div>
            <GroupTitle title="KHOẢNG GIÁ AN TOÀN" />
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className={labelCls}>Giá tối thiểu (VNĐ)</label>
                <input type="number" min={0} step={10000} className={inputCls} value={type.priceFloor ?? ""} onChange={(e) => set("priceFloor", e.target.value ? Number(e.target.value) : undefined)} />
              </div>
              <div>
                <label className={labelCls}>Giá tối đa (VNĐ)</label>
                <input type="number" min={0} step={10000} className={inputCls} value={type.priceCeiling ?? ""} onChange={(e) => set("priceCeiling", e.target.value ? Number(e.target.value) : undefined)} />
              </div>
            </div>
            <p className="mt-2 text-xs text-[#68707a]">Rào chắn: giá ở các gói giá theo kênh không được thấp hơn giá tối thiểu hoặc cao hơn giá tối đa này — chống gõ nhầm giá 0₫ hoặc thừa một số 0. (Kiểm tra tự động khi sửa giá sẽ nối ở Vòng B.)</p>
          </div>

          <div>
            <GroupTitle title="CẤU HÌNH LOẠI GIƯỜNG" />
            <div className="space-y-2">
              {(type.bedOptions ?? []).map((b, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    className={inputCls}
                    value={b}
                    onChange={(e) => set("bedOptions", (type.bedOptions ?? []).map((x, j) => (j === i ? e.target.value : x)))}
                  />
                  <button onClick={() => set("bedOptions", (type.bedOptions ?? []).filter((_, j) => j !== i))} className="cb-btn-ghost px-3 py-2 text-xs text-[#e5484d]">Xoá</button>
                </div>
              ))}
              <div className="flex items-center gap-2">
                <input className={inputCls} value={newBed} onChange={(e) => setNewBed(e.target.value)} placeholder="VD: 1 giường Queen + 1 giường phụ" />
                <button
                  onClick={() => { if (newBed.trim()) { set("bedOptions", [...(type.bedOptions ?? []), newBed.trim()]); setNewBed(""); } }}
                  className="cb-btn-ghost whitespace-nowrap px-3 py-2 text-xs"
                >
                  + Thêm tuỳ chọn
                </button>
              </div>
            </div>
          </div>

          <div>
            <GroupTitle title="HƯỚNG PHÒNG" />
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {ROOM_VIEWS.map((v) => (
                <label key={v.key} className="flex cursor-pointer items-center gap-2 text-sm text-[#17293e]">
                  <input type="checkbox" className="accent-[#2563eb]" checked={(type.views ?? []).includes(v.key)} onChange={() => toggleIn("views", v.key)} />
                  {v.label}
                </label>
              ))}
            </div>
          </div>

          <div>
            <GroupTitle title="GIÁ ĐANG BÁN THEO KÊNH (chỉ xem)" />
            {typePlans.length === 0 ? (
              <p className="text-sm text-[#68707a]">Loại phòng này chưa có gói giá nào — tạo ở tab Gói giá của khách sạn.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[#eef1f5] text-left text-xs text-[#68707a]">
                      <th className="py-2 pr-3">Kênh</th>
                      <th className="py-2 pr-3">Gói giá</th>
                      <th className="py-2 pr-3">Chính sách huỷ</th>
                      <th className="py-2 pr-3 text-right">Giá ngày thường (21/10)</th>
                      <th className="py-2 text-right">Giá cuối tuần (24/10)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {typePlans.map((p) => {
                      const outOfRange =
                        (type.priceFloor !== undefined && (p.prices["2026-10-21"] ?? Infinity) < type.priceFloor) ||
                        (type.priceCeiling !== undefined && (p.prices["2026-10-21"] ?? 0) > type.priceCeiling);
                      return (
                        <tr key={p.id} className="border-b border-[#eef1f5]">
                          <td className="py-2 pr-3 font-medium text-[#17293e]">{getChannelName(p.channelCode)}</td>
                          <td className="py-2 pr-3 text-[#17293e]">{p.name}</td>
                          <td className="py-2 pr-3 text-[#68707a]">{p.cancellationPolicy === "flexible" ? "Huỷ linh hoạt" : "Không hoàn tiền"}</td>
                          <td className={`py-2 pr-3 text-right ${outOfRange ? "font-semibold text-[#e5484d]" : "text-[#17293e]"}`}>
                            {p.prices["2026-10-21"] !== undefined ? `${fmt(p.prices["2026-10-21"])}₫` : "—"}
                            {outOfRange && <span className="ml-1 text-[11px]">(ngoài khoảng an toàn!)</span>}
                          </td>
                          <td className="py-2 text-right text-[#17293e]">{p.prices["2026-10-24"] !== undefined ? `${fmt(p.prices["2026-10-24"])}₫` : "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <p className="mt-2 text-xs text-[#68707a]">
              Giá nằm ở gói giá theo kênh — sửa giá ở trang <Link href="/rates" className="text-[#2563eb] hover:underline">Lịch giá</Link>, không sửa tại đây. Đây là điểm khác ezCloud (họ để giá gốc ngay trên loại phòng).
            </p>
          </div>

          <SaveRow savedMsg={savedMsg} onSave={save} />
        </div>
      )}

      {/* ================= TAB 2 — amenities ================= */}
      {tab === "amenities" && (
        <div className="cb-card mt-4 p-5">
          <div className="flex items-center justify-between">
            <GroupTitle title="TIỆN ÍCH PHÒNG" />
            <span className="text-xs text-[#68707a]">Đã chọn {(type.amenities ?? []).length} tiện ích</span>
          </div>
          <div className="grid gap-5 md:grid-cols-3">
            {ROOM_AMENITY_GROUPS.map((g) => (
              <div key={g.title}>
                <div className="text-xs font-semibold text-[#17293e]">{g.title}</div>
                <div className="mt-2 space-y-1.5">
                  {g.items.map((item) => (
                    <label key={item.key} className="flex cursor-pointer items-center gap-2 text-sm text-[#17293e]">
                      <input type="checkbox" className="accent-[#2563eb]" checked={(type.amenities ?? []).includes(item.key)} onChange={() => toggleIn("amenities", item.key)} />
                      {item.label}
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <p className="mt-4 border-t border-[#eef1f5] pt-3 text-xs text-[#68707a]">Kênh bán áp dụng: Website (Booking Engine) — tiện ích của loại phòng hiện cùng thông tin phòng khi khách đặt online.</p>
          <SaveRow savedMsg={savedMsg} onSave={save} />
        </div>
      )}

      {/* ================= TAB 3 — photos ================= */}
      {tab === "photos" && (
        <div className="cb-card mt-4 p-5">
          <GroupTitle title="HÌNH ẢNH PHÒNG" />
          <p className="mt-1 text-xs text-[#68707a]">Mẹo: ảnh đại diện của loại phòng là ảnh đầu tiên. Tải ảnh thật lên làm ở Vòng B — ở vòng này bấm nút dưới để thêm ảnh mẫu.</p>
          <button
            onClick={() =>
              set("photos", [
                ...(type.photos ?? []),
                { id: `rt-${Date.now()}`, url: `https://picsum.photos/seed/${typeId}-${(type.photos ?? []).length + 1}-${Date.now() % 1000}/800/500`, caption: "Ảnh mẫu" },
              ])
            }
            className="cb-btn-ghost mt-3 px-3 py-2 text-sm"
          >
            + Thêm ảnh mẫu
          </button>
          {(type.photos ?? []).length === 0 ? (
            <div className="mt-4 rounded-xl border border-dashed border-[#dde3ea] p-8 text-center text-sm text-[#9aa7b4]">Chưa có ảnh nào cho loại phòng này.</div>
          ) : (
            <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3">
              {(type.photos ?? []).map((p: HotelPhoto, i: number) => (
                <div key={p.url + i} className="group relative overflow-hidden rounded-xl border border-[#dde3ea]">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.url} alt={p.caption ?? "Ảnh phòng"} className="h-36 w-full object-cover" />
                  {i === 0 && <span className="absolute left-2 top-2 rounded-full bg-[#2563eb] px-2 py-0.5 text-[11px] font-medium text-white">Ảnh bìa</span>}
                  <button
                    onClick={() => set("photos", (type.photos ?? []).filter((_, j) => j !== i))}
                    className="absolute right-2 top-2 hidden rounded-full bg-white/90 px-2 py-0.5 text-xs text-[#e5484d] shadow group-hover:block"
                  >
                    Xoá
                  </button>
                  {p.caption && <div className="truncate px-2 py-1.5 text-xs text-[#68707a]">{p.caption}</div>}
                </div>
              ))}
            </div>
          )}
          <SaveRow savedMsg={savedMsg} onSave={save} />
        </div>
      )}
    </div>
  );
}

function GroupTitle({ title }: { title: string }) {
  return <div className="mb-3 text-xs font-bold tracking-wide text-[#2563eb]">{title}</div>;
}

function SaveRow({ savedMsg, onSave }: { savedMsg: string; onSave: () => void }) {
  return (
    <div className="mt-5 flex items-center gap-3 border-t border-[#eef1f5] pt-4">
      <button onClick={onSave} className="cb-btn-primary px-5 py-2 text-sm">Lưu</button>
      {savedMsg && <span className="text-sm text-[#0e7a56]">{savedMsg}</span>}
    </div>
  );
}
