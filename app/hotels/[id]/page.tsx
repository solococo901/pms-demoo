"use client";

// ============================================================
// FILE 6 — app/hotels/[id]/page.tsx (ezCloud structure,
// Cloudbeds style)
// Manage ONE hotel. [id] is a DYNAMIC ROUTE: one file serves
// every hotel (/hotels/cityhouse-mark, /hotels/riverside...).
//
// Sections follow ezCloud's hotel-info menu:
//   - Thông tin chung (general info): registration / amenities
//     / photos / nearby places — the CONTENT guests see.
//   - Cấu hình (configuration): general config / payment
//     policies / cancellation policies / payment methods /
//     alerts — the RULES the system runs by.
//   - Loại phòng & Phòng: room types + physical rooms.
//   - Gói giá: per-channel rate plans of this hotel.
// ============================================================

import { use, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import {
  AMENITY_GROUPS,
  CHANNELS,
  type Hotel,
  type HotelAlerts,
  type HotelConfig,
  type HotelPhoto,
  type NamedPolicy,
  type NearbyCategory,
  type NearbyPlace,
  type PaymentMethods,
  type RatePlan,
  type Room,
  type RoomType,
} from "@/lib/mock-data";

// ---------- shared styles ----------
const inputCls =
  "w-full rounded-lg border border-[#dde3ea] bg-white px-3 py-2 text-sm outline-none focus:border-[#2563eb]";
const inputSm =
  "rounded-lg border border-[#dde3ea] bg-white px-3 py-2 text-sm outline-none focus:border-[#2563eb]";
const fmt = (n: number) => n.toLocaleString("vi-VN");
const ACCOUNT_ID = "11111111-1111-1111-1111-111111111111";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="text-[#68707a]">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

function SaveRow({ msg, onSave }: { msg: string; onSave: () => void }) {
  return (
    <div className="mt-5 flex items-center gap-3 border-t border-[#eef1f5] pt-4">
      <button onClick={onSave} className="cb-btn-primary px-5 py-2 text-sm">
        Lưu
      </button>
      {msg && <span className="text-sm text-[#1db584]">{msg}</span>}
    </div>
  );
}

function GroupTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mt-6 text-[13px] font-bold uppercase tracking-wide text-[#2563eb] first:mt-0">
      {children}
    </h3>
  );
}

// ---------- defaults for a hotel that has not filled these in ----------
const DEFAULT_CONFIG: HotelConfig = {
  notifyEmail: "", ccEmail: "", bccEmail: "", cardEmail: "",
  autoCancelUnconfirmed: false, autoCancelFailedPaymentMinutes: 0,
  displayLanguages: ["vi"], primaryLanguage: "vi",
  weekendDays: [6, 0], currency: "VND",
  vatPercent: 10, serviceFeePercent: 5, pricesIncludeTax: true,
  infantMaxAge: 6, childMaxAge: 12, childPolicy: "",
  yearBuilt: 0, floors: 0,
  distanceAirportKm: 0, distanceCenterKm: 0, airportMinutes: 0,
  roomService: false, regulations: "",
};
const DEFAULT_METHODS: PaymentMethods = {
  bankTransfer: false, cash: true, credit: false, note: "", channelCode: "website",
};
const DEFAULT_ALERTS: HotelAlerts = { email: "", lowRoomThreshold: 2, enabled: false };

const NEARBY_LABELS: Record<NearbyCategory, string> = {
  nearest: "Địa điểm gần nhất",
  popular: "Địa điểm nổi tiếng",
  airport: "Sân bay gần nhất",
  tourist: "Điểm du lịch",
  food: "Nhà hàng & chợ địa phương",
};

const HK_LABELS: Record<Room["housekeepingStatus"], string> = {
  clean: "Sạch",
  dirty: "Chưa dọn",
  in_progress: "Đang dọn",
  out_of_order: "Ngừng bán",
};

// ---------- named-policy list (payment / cancellation) ----------
function PolicySection({
  items, setItems,
}: {
  items: NamedPolicy[];
  setItems: (f: (p: NamedPolicy[]) => NamedPolicy[]) => void;
}) {
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  function add() {
    if (!name.trim()) return alert("Chưa nhập tên chính sách.");
    setItems((p) => [
      ...p,
      { id: `policy-${Date.now()}`, name: name.trim(), description: desc.trim(), active: true },
    ]);
    setName("");
    setDesc("");
  }
  return (
    <div>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[#eef1f5] text-left text-xs uppercase tracking-wide text-[#68707a]">
            <th className="py-2 pr-3 font-semibold">Tên chính sách</th>
            <th className="py-2 pr-3 font-semibold">Mô tả</th>
            <th className="py-2 pr-3 font-semibold">Trạng thái</th>
            <th className="py-2 text-right font-semibold"></th>
          </tr>
        </thead>
        <tbody>
          {items.map((p) => (
            <tr key={p.id} className="border-b border-[#eef1f5]">
              <td className="py-2.5 pr-3 font-medium text-[#17293e]">{p.name}</td>
              <td className="py-2.5 pr-3 text-[#68707a]">{p.description || "—"}</td>
              <td className="py-2.5 pr-3">
                <button
                  onClick={() =>
                    setItems((prev) => prev.map((x) => (x.id === p.id ? { ...x, active: !x.active } : x)))
                  }
                  className={`relative h-5 w-9 rounded-full transition ${p.active ? "bg-[#2563eb]" : "bg-gray-300"}`}
                  title={p.active ? "Đang áp dụng" : "Đã tắt"}
                >
                  <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${p.active ? "left-[18px]" : "left-0.5"}`} />
                </button>
              </td>
              <td className="py-2.5 text-right">
                <button
                  onClick={() => setItems((prev) => prev.filter((x) => x.id !== p.id))}
                  className="font-medium text-[#e5484d] hover:underline"
                >
                  Xoá
                </button>
              </td>
            </tr>
          ))}
          {items.length === 0 && (
            <tr>
              <td colSpan={4} className="py-6 text-center text-[#68707a]">
                Chưa có chính sách nào — thêm mới bên dưới.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <div className="mt-4 flex flex-wrap gap-2">
        <input className={`${inputSm} min-w-52 flex-1`} placeholder="Tên chính sách mới" value={name} onChange={(e) => setName(e.target.value)} />
        <input className={`${inputSm} min-w-64 flex-[2]`} placeholder="Mô tả ngắn" value={desc} onChange={(e) => setDesc(e.target.value)} />
        <button onClick={add} className="cb-btn-primary px-4 py-2 text-sm">+ Thêm</button>
      </div>
    </div>
  );
}

// ============================================================
export default function HotelDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  // ----- state: profile + content + config (loaded from DB) -----
  const [hotel, setHotel] = useState<Hotel>({
    id, name: "Đang tải...", address: "", phone: "", email: "",
    checkInTime: "14:00", checkOutTime: "12:00",
  });
  const [config, setConfig] = useState<HotelConfig>(DEFAULT_CONFIG);
  const [amenities, setAmenities] = useState<string[]>([]);
  const [photos, setPhotos] = useState<HotelPhoto[]>([]);
  const [nearby, setNearby] = useState<NearbyPlace[]>([]);
  const [payPolicies, setPayPolicies] = useState<NamedPolicy[]>([]);
  const [cancelPolicies, setCancelPolicies] = useState<NamedPolicy[]>([]);
  const [methods, setMethods] = useState<PaymentMethods>(DEFAULT_METHODS);
  const [alerts, setAlerts] = useState<HotelAlerts>(DEFAULT_ALERTS);
  const [savedMsg, setSavedMsg] = useState("");
  const [loading, setLoading] = useState(true);
  const [dbError, setDbError] = useState("");
  const loadedRef = useRef(false);

  // ----- state: operations (room types, rooms, plans) -----
  const [roomTypes, setRoomTypes] = useState<RoomType[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [plans, setPlans] = useState<RatePlan[]>([]);
  const [activeRoomNumbers, setActiveRoomNumbers] = useState<Set<string>>(new Set());

  // ----- LOAD everything of this hotel from Supabase -----
  useEffect(() => {
    (async () => {
      const { data: row, error } = await supabase.from("hotels").select("*").eq("id", id).single();
      if (error || !row) {
        setDbError("Không tìm thấy khách sạn này trong cơ sở dữ liệu.");
        setLoading(false);
        return;
      }
      loadedRef.current = true;
      const profile = (row.profile ?? {}) as Record<string, any>;
      setHotel({
        id: row.id, code: row.code ?? undefined, name: row.name,
        nameEn: profile.nameEn, address: row.address ?? "", country: profile.country,
        city: row.city ?? undefined, ward: profile.ward, area: profile.area,
        phone: profile.phone ?? "", email: profile.email ?? "",
        starRating: row.star_rating ?? undefined,
        businessType: profile.businessType, timezone: row.timezone ?? undefined,
        checkInTime: (row.check_in_time ?? "14:00").slice(0, 5),
        checkOutTime: (row.check_out_time ?? "12:00").slice(0, 5),
        latitude: row.latitude ?? undefined, longitude: row.longitude ?? undefined,
        mapZoom: profile.mapZoom, logoUrl: profile.logoUrl,
        websiteUrl: profile.websiteUrl, bookingEngineUrl: profile.bookingEngineUrl,
        descriptionVi: profile.descriptionVi, descriptionEn: profile.descriptionEn,
      });
      if (profile.config) setConfig(profile.config as HotelConfig);
      setAmenities(profile.amenities ?? []);
      setPhotos(profile.photos ?? []);
      setNearby(profile.nearby ?? []);
      setPayPolicies(profile.paymentPolicies ?? []);
      setCancelPolicies(profile.cancellationPolicies ?? []);
      if (profile.paymentMethods) setMethods(profile.paymentMethods as PaymentMethods);
      if (profile.alerts) setAlerts(profile.alerts as HotelAlerts);

      const [typesRes, roomsRes, plansRes] = await Promise.all([
        supabase.from("room_types").select("*").eq("hotel_id", id),
        supabase.from("rooms").select("*").eq("hotel_id", id),
        supabase.from("rate_plans").select("*").eq("hotel_id", id),
      ]);
      const types: RoomType[] = (typesRes.data ?? []).map((t) => {
        const d = (t.details ?? {}) as Record<string, any>;
        return {
          id: t.id, code: t.code ?? undefined, name: t.name,
          maxOccupancy: t.occupancy, maxAdults: t.max_adults, maxChildren: t.max_children,
          maxInfants: t.max_infants, sizeM2: t.size_sqm ?? undefined,
          bedConfig: t.bed_config ?? "—", priceFloor: t.min_price ?? undefined, priceCeiling: t.max_price ?? undefined,
          descriptionVi: t.description_vi ?? undefined, descriptionEn: t.description_en ?? undefined,
          views: d.views ?? [], bedOptions: d.bedOptions ?? [], photos: d.photos ?? [], amenities: d.amenities ?? [],
          active: t.active !== false,
        };
      });
      setRoomTypes(types);
      if (types[0]) { setRoomTypeId(types[0].id); setPlanRoomType(types[0].id); }
      setRooms((roomsRes.data ?? []).map((r) => ({
        number: r.number, roomTypeId: r.room_type_id,
        housekeepingStatus: (r.housekeeping_status ?? "clean") as Room["housekeepingStatus"],
      })));
      const planRows = plansRes.data ?? [];
      const pricesByPlan = new Map<string, Record<string, number>>();
      if (planRows.length > 0) {
        const { data: priceRows } = await supabase
          .from("rate_prices").select("rate_plan_id, date, price")
          .in("rate_plan_id", planRows.map((pl) => pl.id));
        for (const pr of priceRows ?? []) {
          const m = pricesByPlan.get(pr.rate_plan_id) ?? {};
          m[pr.date] = pr.price;
          pricesByPlan.set(pr.rate_plan_id, m);
        }
      }
      setPlans(planRows.map((pl) => ({
        id: pl.id, channelCode: pl.channel_code, roomTypeId: pl.room_type_id, name: pl.name,
        publicName: pl.public_name ?? undefined,
        mealPlan: (pl.meal_plan ?? undefined) as RatePlan["mealPlan"],
        baseOccupancy: pl.base_occupancy ?? undefined,
        extraAdultFee: pl.extra_adult_fee ?? undefined, extraChildFee: pl.extra_child_fee ?? undefined,
        cancellationPolicy: (pl.cancellation_policy ?? "flexible") as RatePlan["cancellationPolicy"],
        derivedFromId: pl.derived_from_id ?? undefined, formulaId: pl.formula_id ?? undefined,
        prices: pl.derived_from_id ? {} : (pricesByPlan.get(pl.id) ?? {}),
      })));

      const { data: resRows } = await supabase
        .from("reservations").select("id, status").eq("hotel_id", id)
        .not("status", "in", '("cancelled","checked_out")');
      if (resRows && resRows.length > 0) {
        const { data: rr } = await supabase
          .from("reservation_rooms").select("room_number")
          .in("reservation_id", resRows.map((r) => r.id));
        setActiveRoomNumbers(new Set((rr ?? []).map((x) => x.room_number)));
      }
      setLoading(false);
    })();
  }, [id]);

  // ----- SAVE profile + config: one update of the hotels row -----
  const save = async () => {
    if (!loadedRef.current) return;
    const profile = {
      nameEn: hotel.nameEn, country: hotel.country, ward: hotel.ward, area: hotel.area,
      phone: hotel.phone, email: hotel.email, businessType: hotel.businessType,
      websiteUrl: hotel.websiteUrl, bookingEngineUrl: hotel.bookingEngineUrl, logoUrl: hotel.logoUrl,
      descriptionVi: hotel.descriptionVi, descriptionEn: hotel.descriptionEn, mapZoom: hotel.mapZoom,
      config, amenities, photos, nearby,
      paymentPolicies: payPolicies, cancellationPolicies: cancelPolicies,
      paymentMethods: methods, alerts,
    };
    const { error } = await supabase.from("hotels").update({
      name: hotel.name, address: hotel.address || null, city: hotel.city || null,
      star_rating: hotel.starRating ?? null,
      timezone: hotel.timezone || null,
      check_in_time: hotel.checkInTime, check_out_time: hotel.checkOutTime,
      latitude: hotel.latitude ?? null, longitude: hotel.longitude ?? null,
      profile,
    }).eq("id", id);
    setSavedMsg(error ? "Lỗi khi lưu: " + error.message : "✓ Đã lưu vào cơ sở dữ liệu.");
  };

  // ----- SYNC room types + rooms to the database -----
  useEffect(() => {
    if (!loadedRef.current) return;
    const t = setTimeout(async () => {
      const typeRows = roomTypes.map((rt) => ({
        id: rt.id, hotel_id: id, account_id: ACCOUNT_ID, code: rt.code ?? null, name: rt.name,
        max_adults: rt.maxAdults, max_children: rt.maxChildren, max_infants: rt.maxInfants ?? 0,
        occupancy: rt.maxOccupancy, size_sqm: rt.sizeM2 ?? null, bed_config: rt.bedConfig,
        min_price: rt.priceFloor ?? null, max_price: rt.priceCeiling ?? null,
        description_vi: rt.descriptionVi ?? null, description_en: rt.descriptionEn ?? null,
        active: rt.active !== false,
        details: { views: rt.views ?? [], bedOptions: rt.bedOptions ?? [], photos: rt.photos ?? [], amenities: rt.amenities ?? [] },
      }));
      if (typeRows.length > 0) {
        const { error } = await supabase.from("room_types").upsert(typeRows);
        if (error) { setDbError(error.message); return; }
      }
      const { data: dbTypes } = await supabase.from("room_types").select("id").eq("hotel_id", id);
      const keepT = new Set(roomTypes.map((x) => x.id));
      for (const d of dbTypes ?? []) {
        if (!keepT.has(d.id)) {
          const { error } = await supabase.from("room_types").delete().eq("id", d.id);
          if (error) { setDbError("Không xoá được loại phòng trong kho: " + error.message); return; }
        }
      }
      const roomRows = rooms.map((r) => ({
        id: `${id}-${r.number}`, hotel_id: id, account_id: ACCOUNT_ID,
        room_type_id: r.roomTypeId, number: r.number, floor: Number(r.number.charAt(0)) || 1,
        housekeeping_status: r.housekeepingStatus,
      }));
      if (roomRows.length > 0) {
        const { error } = await supabase.from("rooms").upsert(roomRows);
        if (error) { setDbError(error.message); return; }
      }
      const { data: dbRooms } = await supabase.from("rooms").select("id").eq("hotel_id", id);
      const keepR = new Set(roomRows.map((x) => x.id));
      for (const d of dbRooms ?? []) {
        if (!keepR.has(d.id)) await supabase.from("rooms").delete().eq("id", d.id);
      }
    }, 600);
    return () => clearTimeout(t);
  }, [roomTypes, rooms, id]);

  // ----- tabs -----
  const [mainTab, setMainTab] = useState<"general" | "config" | "rooms" | "plans">("general");
  const [generalSub, setGeneralSub] = useState<"info" | "amenities" | "photos" | "nearby">("info");
  const [configSub, setConfigSub] = useState<"general" | "pay" | "cancel" | "methods" | "alerts">("general");

  // ----- nearby form -----
  const [nbName, setNbName] = useState("");
  const [nbCategory, setNbCategory] = useState<NearbyCategory>("tourist");
  const [nbDistance, setNbDistance] = useState(1);

  // ----- room type / room / plan forms (same rules as before) -----
  const [typeName, setTypeName] = useState("");
  const [typeCode, setTypeCode] = useState("");
  const [typeAdults, setTypeAdults] = useState(2);
  const [typeChildren, setTypeChildren] = useState(0);
  const [typeBed, setTypeBed] = useState("");
  const [roomNumber, setRoomNumber] = useState("");
  const [roomTypeId, setRoomTypeId] = useState("");
  const [planChannel, setPlanChannel] = useState("booking_com");
  const [planRoomType, setPlanRoomType] = useState("");
  const [planName, setPlanName] = useState("");
  const [planPolicy, setPlanPolicy] = useState<"flexible" | "non_refundable">("flexible");
  const [planWeekday, setPlanWeekday] = useState(900_000);
  const [planWeekend, setPlanWeekend] = useState(1_100_000);
  const [planChannelFilter, setPlanChannelFilter] = useState("all");


  function addRoomType() {
    if (!typeName.trim()) return alert("Chưa nhập tên loại phòng.");
    const newId = typeName.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-");
    if (roomTypes.some((t) => t.id === newId)) return alert("Loại phòng này đã tồn tại ở khách sạn này.");
    setRoomTypes((p) => [
      ...p,
      {
        id: newId,
        code: typeCode.trim().toUpperCase() || undefined,
        name: typeName.trim(),
        maxOccupancy: typeAdults + typeChildren,
        maxAdults: typeAdults,
        maxChildren: typeChildren,
        bedConfig: typeBed || "—",
        active: true,
      },
    ]);
    setTypeName(""); setTypeCode(""); setTypeBed("");
  }

  function deleteRoomType(typeId: string) {
    if (rooms.some((r) => r.roomTypeId === typeId)) return alert("Không xoá được: khách sạn này vẫn còn phòng thuộc loại đó.");
    if (plans.some((p) => p.roomTypeId === typeId)) return alert("Không xoá được: vẫn còn gói giá thuộc loại này.");
    setRoomTypes((p) => p.filter((t) => t.id !== typeId));
  }

  function addRoom() {
    if (!roomNumber.trim()) return alert("Chưa nhập số phòng.");
    if (rooms.some((r) => r.number === roomNumber.trim())) return alert("Số phòng này đã có ở khách sạn này.");
    if (!roomTypeId) return alert("Tạo loại phòng trước, rồi mới thêm phòng.");
    setRooms((p) => [...p, { number: roomNumber.trim(), roomTypeId, housekeepingStatus: "clean" }]);
    setRoomNumber("");
  }

  function deleteRoom(number: string) {
    if (activeRoomNumbers.has(number))
      return alert(`Không xoá được: phòng ${number} đang có đơn đang hiệu lực.`);
    setRooms((p) => p.filter((r) => r.number !== number));
  }

  const weekPrices = (weekday: number, weekend: number) => ({
    "2026-10-21": weekday, "2026-10-22": weekday, "2026-10-23": weekday,
    "2026-10-24": weekend, "2026-10-25": weekend, "2026-10-26": weekend,
    "2026-10-27": weekday,
  });

  async function addPlan() {
    if (!planName.trim()) return alert("Chưa nhập tên gói giá.");
    if (!planRoomType) return alert("Tạo loại phòng trước, rồi mới tạo gói giá.");
    const newPlan: RatePlan = {
      id: `plan-${Date.now()}`, channelCode: planChannel, roomTypeId: planRoomType,
      name: planName.trim(), cancellationPolicy: planPolicy,
      prices: weekPrices(planWeekday, planWeekend),
    };
    const { error } = await supabase.from("rate_plans").insert({
      id: newPlan.id, hotel_id: id, account_id: ACCOUNT_ID,
      room_type_id: newPlan.roomTypeId, channel_code: newPlan.channelCode,
      name: newPlan.name, cancellation_policy: newPlan.cancellationPolicy,
    });
    if (error) return alert("Tạo gói giá trong cơ sở dữ liệu không thành công: " + error.message);
    await supabase.from("rate_prices").insert(
      Object.entries(newPlan.prices).map(([date, price]) => ({ rate_plan_id: newPlan.id, date, price }))
    );
    setPlans((p) => [...p, newPlan]);
    setPlanName("");
  }

  const visiblePlans = plans.filter((p) => planChannelFilter === "all" || p.channelCode === planChannelFilter);

  // ----- completeness (same 7 sections as the list page) -----
  const completenessChecks = [
    !!(hotel.name && hotel.address && hotel.phone && hotel.email),
    config !== DEFAULT_CONFIG,
    amenities.length > 0,
    photos.length > 0,
    nearby.length > 0,
    roomTypes.length > 0,
    plans.length > 0,
  ];
  const completenessDone = completenessChecks.filter(Boolean).length;

  const MAIN_TABS = [
    { key: "general", label: "Thông tin chung" },
    { key: "config", label: "Cấu hình khách sạn" },
    { key: "rooms", label: "Loại phòng & Phòng" },
    { key: "plans", label: "Gói giá" },
  ] as const;

  const tabBtn = (active: boolean) =>
    active
      ? "border-b-2 border-[#2563eb] px-4 py-2.5 text-sm font-semibold text-[#2563eb]"
      : "border-b-2 border-transparent px-4 py-2.5 text-sm text-[#68707a] hover:text-[#17293e]";

  const subBtn = (active: boolean) =>
    active
      ? "rounded-full bg-[#e8effe] px-3.5 py-1.5 text-[13px] font-semibold text-[#2563eb]"
      : "rounded-full px-3.5 py-1.5 text-[13px] text-[#68707a] hover:bg-[#f4f7fb]";

  return (
    <div>
      <Link href="/hotels" className="text-sm font-medium text-[#2563eb] hover:underline">
        ← Tất cả khách sạn
      </Link>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold text-[#17293e]">{hotel.name}</h1>
        {hotel.code && (
          <span className="rounded-md bg-[#f0f3f7] px-2 py-0.5 text-xs font-semibold text-[#68707a]">{hotel.code}</span>
        )}
        {hotel.starRating && <span className="text-amber-500">{"★".repeat(hotel.starRating)}</span>}
        <span className="rounded-full bg-[#e8effe] px-3 py-1 text-xs font-semibold text-[#2563eb]">
          Hoàn thiện hồ sơ: {completenessDone}/7
        </span>
      </div>
      <p className="mt-1 text-sm text-[#68707a]">
        Trang quản lí riêng của khách sạn này — không ảnh hưởng khách sạn khác.
      </p>
      {loading && <p className="mt-3 text-sm text-[#68707a]">Đang tải dữ liệu từ Supabase...</p>}
      {dbError && <p className="mt-3 rounded-lg bg-[#fdecec] px-3 py-2 text-sm text-[#e5484d]">Lỗi cơ sở dữ liệu: {dbError}</p>}

      {/* ===== main tabs ===== */}
      <div className="mt-5 flex flex-wrap border-b border-[#dde3ea]">
        {MAIN_TABS.map((t) => (
          <button key={t.key} onClick={() => setMainTab(t.key)} className={tabBtn(mainTab === t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ================================================= GENERAL */}
      {mainTab === "general" && (
        <div className="cb-card mt-5 p-5">
          <div className="flex flex-wrap gap-1.5">
            <button className={subBtn(generalSub === "info")} onClick={() => setGeneralSub("info")}>Thông tin đăng ký</button>
            <button className={subBtn(generalSub === "amenities")} onClick={() => setGeneralSub("amenities")}>Tiện ích</button>
            <button className={subBtn(generalSub === "photos")} onClick={() => setGeneralSub("photos")}>Hình ảnh</button>
            <button className={subBtn(generalSub === "nearby")} onClick={() => setGeneralSub("nearby")}>Địa điểm lân cận</button>
          </div>

          {/* ----- registration info ----- */}
          {generalSub === "info" && (
            <div className="mt-5">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <Field label="Mã khách sạn">
                  <input className={inputCls} value={hotel.code ?? "—"} disabled />
                </Field>
                <Field label="Tên khách sạn *">
                  <input className={inputCls} value={hotel.name} onChange={(e) => setHotel({ ...hotel, name: e.target.value })} />
                </Field>
                <Field label="Tên tiếng Anh">
                  <input className={inputCls} value={hotel.nameEn ?? ""} onChange={(e) => setHotel({ ...hotel, nameEn: e.target.value })} />
                </Field>
                <Field label="Hạng sao">
                  <select className={inputCls} value={hotel.starRating ?? 3} onChange={(e) => setHotel({ ...hotel, starRating: Number(e.target.value) })}>
                    {[1, 2, 3, 4, 5].map((s) => (<option key={s} value={s}>{s} sao</option>))}
                  </select>
                </Field>
                <Field label="Loại hình kinh doanh">
                  <select className={inputCls} value={hotel.businessType ?? "Hotel"} onChange={(e) => setHotel({ ...hotel, businessType: e.target.value })}>
                    {["Hotel", "Apartment", "Resort", "Homestay", "Villa"].map((t) => (<option key={t}>{t}</option>))}
                  </select>
                </Field>
                <Field label="Múi giờ của khách sạn">
                  <select className={inputCls} value={hotel.timezone ?? "Asia/Ho_Chi_Minh"} onChange={(e) => setHotel({ ...hotel, timezone: e.target.value })}>
                    <option value="Asia/Ho_Chi_Minh">(GMT+07:00) Hồ Chí Minh</option>
                    <option value="Asia/Bangkok">(GMT+07:00) Bangkok</option>
                    <option value="Asia/Singapore">(GMT+08:00) Singapore</option>
                    <option value="Asia/Tokyo">(GMT+09:00) Tokyo</option>
                  </select>
                </Field>
                <Field label="Số điện thoại liên hệ *">
                  <input className={inputCls} value={hotel.phone} onChange={(e) => setHotel({ ...hotel, phone: e.target.value })} />
                </Field>
                <Field label="Email *">
                  <input className={inputCls} value={hotel.email} onChange={(e) => setHotel({ ...hotel, email: e.target.value })} />
                </Field>
                <Field label="Logo khách sạn">
                  <div className="flex h-[38px] items-center rounded-lg border border-dashed border-[#c4cedb] px-3 text-[13px] text-[#68707a]">
                    {hotel.logoUrl ? "Đã có logo" : "Chưa có logo — tải lên ở Vòng B"}
                  </div>
                </Field>
                <Field label="Website">
                  <input className={inputCls} value={hotel.websiteUrl ?? ""} onChange={(e) => setHotel({ ...hotel, websiteUrl: e.target.value })} />
                </Field>
                <Field label="Trang đặt phòng (Booking Engine)">
                  <input className={inputCls} value={hotel.bookingEngineUrl ?? ""} onChange={(e) => setHotel({ ...hotel, bookingEngineUrl: e.target.value })} />
                </Field>
                <Field label="Địa chỉ">
                  <input className={inputCls} value={hotel.address} onChange={(e) => setHotel({ ...hotel, address: e.target.value })} />
                </Field>
                <Field label="Quốc gia">
                  <input className={inputCls} value={hotel.country ?? ""} onChange={(e) => setHotel({ ...hotel, country: e.target.value })} />
                </Field>
                <Field label="Tỉnh / Thành phố">
                  <input className={inputCls} value={hotel.city ?? ""} onChange={(e) => setHotel({ ...hotel, city: e.target.value })} />
                </Field>
                <Field label="Phường / Xã">
                  <input className={inputCls} value={hotel.ward ?? ""} onChange={(e) => setHotel({ ...hotel, ward: e.target.value })} />
                </Field>
                <Field label="Khu vực">
                  <input className={inputCls} value={hotel.area ?? ""} onChange={(e) => setHotel({ ...hotel, area: e.target.value })} />
                </Field>
              </div>

              <div className="mt-4 grid gap-4 lg:grid-cols-2">
                <Field label={`Mô tả (Tiếng Việt) — ${(hotel.descriptionVi ?? "").length}/3000 ký tự`}>
                  <textarea className={inputCls} rows={4} value={hotel.descriptionVi ?? ""} onChange={(e) => setHotel({ ...hotel, descriptionVi: e.target.value })} />
                </Field>
                <Field label={`Description (English) — ${(hotel.descriptionEn ?? "").length}/3000 ký tự`}>
                  <textarea className={inputCls} rows={4} value={hotel.descriptionEn ?? ""} onChange={(e) => setHotel({ ...hotel, descriptionEn: e.target.value })} />
                </Field>
              </div>

              <GroupTitle>Vị trí trên bản đồ</GroupTitle>
              <div className="mt-3 grid gap-4 sm:grid-cols-3">
                <Field label="Vĩ độ">
                  <input type="number" step="0.0001" className={inputCls} value={hotel.latitude ?? 0} onChange={(e) => setHotel({ ...hotel, latitude: Number(e.target.value) })} />
                </Field>
                <Field label="Kinh độ">
                  <input type="number" step="0.0001" className={inputCls} value={hotel.longitude ?? 0} onChange={(e) => setHotel({ ...hotel, longitude: Number(e.target.value) })} />
                </Field>
                <Field label="Mức zoom">
                  <input type="number" className={inputCls} value={hotel.mapZoom ?? 15} onChange={(e) => setHotel({ ...hotel, mapZoom: Number(e.target.value) })} />
                </Field>
              </div>

              <SaveRow msg={savedMsg} onSave={save} />
            </div>
          )}

          {/* ----- amenities ----- */}
          {generalSub === "amenities" && (
            <div className="mt-5">
              <p className="text-sm text-[#68707a]">
                Tick chọn tiện ích khách sạn có — phần này hiện trên trang đặt phòng của khách sạn.
                Đã chọn <b className="text-[#17293e]">{amenities.length}</b> tiện ích.
              </p>
              {AMENITY_GROUPS.map((g) => (
                <div key={g.id} className="mt-5">
                  <h3 className="text-sm font-bold text-[#17293e]">{g.name}</h3>
                  <div className="mt-2 grid gap-x-4 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
                    {g.items.map((item) => (
                      <label key={item.id} className="flex cursor-pointer items-center gap-2.5 text-sm">
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-[#2563eb]"
                          checked={amenities.includes(item.id)}
                          onChange={(e) =>
                            setAmenities((prev) =>
                              e.target.checked ? [...prev, item.id] : prev.filter((x) => x !== item.id)
                            )
                          }
                        />
                        {item.name}
                      </label>
                    ))}
                  </div>
                </div>
              ))}
              <SaveRow msg={savedMsg} onSave={save} />
            </div>
          )}

          {/* ----- photos ----- */}
          {generalSub === "photos" && (
            <div className="mt-5">
              <div className="rounded-xl border-2 border-dashed border-[#c4cedb] px-4 py-8 text-center">
                <div className="font-medium text-[#17293e]">Kéo thả ảnh vào đây</div>
                <div className="mt-1 text-sm text-[#68707a]">
                  Tải ảnh thật (tối đa 5MB/ảnh) hoạt động ở Vòng B — hiện đang dùng ảnh mẫu bên dưới.
                </div>
                <button
                  onClick={() =>
                    setPhotos((p) => [
                      ...p,
                      { id: `photo-${Date.now()}`, url: `https://picsum.photos/seed/${Date.now()}/800/600`, caption: "Ảnh mới" },
                    ])
                  }
                  className="cb-btn-primary mt-3 px-4 py-2 text-sm"
                >
                  + Thêm ảnh mẫu
                </button>
              </div>
              <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {photos.map((ph, i) => (
                  <div key={ph.id} className="group relative overflow-hidden rounded-xl border border-[#dde3ea]">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={ph.url} alt={ph.caption} className="h-40 w-full object-cover" />
                    {i === 0 && (
                      <span className="absolute left-2 top-2 rounded-full bg-[#2563eb] px-2.5 py-0.5 text-[11px] font-semibold text-white">
                        Ảnh bìa
                      </span>
                    )}
                    <button
                      onClick={() => setPhotos((p) => p.filter((x) => x.id !== ph.id))}
                      className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-white/90 text-sm text-[#e5484d] opacity-0 shadow transition group-hover:opacity-100"
                      title="Xoá ảnh"
                    >
                      ✕
                    </button>
                    <div className="px-3 py-2 text-[13px] text-[#68707a]">{ph.caption}</div>
                  </div>
                ))}
                {photos.length === 0 && (
                  <div className="py-6 text-sm text-[#68707a] sm:col-span-2 lg:col-span-3">
                    Chưa có ảnh nào — bấm "+ Thêm ảnh mẫu" để xem thử bố cục.
                  </div>
                )}
              </div>
              <div className="mt-4 text-[13px] text-[#68707a]">
                Kênh bán áp dụng: <b className="text-[#17293e]">Website (Booking Engine)</b> — ảnh chỉ phục vụ
                trang đặt phòng của khách sạn, không đẩy lên các OTA.
              </div>
            </div>
          )}

          {/* ----- nearby ----- */}
          {generalSub === "nearby" && (
            <div className="mt-5">
              <div className="flex flex-wrap gap-2">
                <select className={inputSm} value={nbCategory} onChange={(e) => setNbCategory(e.target.value as NearbyCategory)}>
                  {(Object.keys(NEARBY_LABELS) as NearbyCategory[]).map((c) => (
                    <option key={c} value={c}>{NEARBY_LABELS[c]}</option>
                  ))}
                </select>
                <input className={`${inputSm} min-w-56 flex-1`} placeholder="Tên địa điểm, VD: Hồ Xuân Hương" value={nbName} onChange={(e) => setNbName(e.target.value)} />
                <input type="number" step="0.1" min={0} className={`${inputSm} w-28`} value={nbDistance} onChange={(e) => setNbDistance(Number(e.target.value))} title="Khoảng cách (km)" />
                <span className="self-center text-sm text-[#68707a]">km</span>
                <button
                  onClick={() => {
                    if (!nbName.trim()) return alert("Chưa nhập tên địa điểm.");
                    setNearby((p) => [...p, { category: nbCategory, name: nbName.trim(), distanceKm: nbDistance }]);
                    setNbName("");
                  }}
                  className="cb-btn-primary px-4 py-2 text-sm"
                >
                  + Thêm
                </button>
              </div>
              {(Object.keys(NEARBY_LABELS) as NearbyCategory[]).map((cat) => {
                const items = nearby.filter((n) => n.category === cat);
                if (items.length === 0) return null;
                return (
                  <div key={cat} className="mt-5">
                    <h3 className="text-sm font-bold text-[#17293e]">{NEARBY_LABELS[cat]}</h3>
                    <div className="mt-2 divide-y divide-[#eef1f5]">
                      {items.map((n) => (
                        <div key={n.name} className="flex items-center justify-between py-2 text-sm">
                          <span>{n.name}</span>
                          <span className="flex items-center gap-4">
                            <span className="text-[#68707a]">{n.distanceKm} km</span>
                            <button
                              onClick={() => setNearby((p) => p.filter((x) => x !== n))}
                              className="font-medium text-[#e5484d] hover:underline"
                            >
                              Xoá
                            </button>
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
              {nearby.length === 0 && (
                <p className="mt-4 text-sm text-[#68707a]">Chưa có địa điểm nào — thêm địa điểm đầu tiên ở trên.</p>
              )}
              <div className="mt-4 text-[13px] text-[#68707a]">
                Kênh bán áp dụng: <b className="text-[#17293e]">Website (Booking Engine)</b>.
              </div>
            </div>
          )}
        </div>
      )}

      {/* ================================================= CONFIG */}
      {mainTab === "config" && (
        <div className="cb-card mt-5 p-5">
          <div className="flex flex-wrap gap-1.5">
            <button className={subBtn(configSub === "general")} onClick={() => setConfigSub("general")}>Cấu hình chung</button>
            <button className={subBtn(configSub === "pay")} onClick={() => setConfigSub("pay")}>Chính sách thanh toán</button>
            <button className={subBtn(configSub === "cancel")} onClick={() => setConfigSub("cancel")}>Chính sách huỷ đặt phòng</button>
            <button className={subBtn(configSub === "methods")} onClick={() => setConfigSub("methods")}>Phương thức thanh toán</button>
            <button className={subBtn(configSub === "alerts")} onClick={() => setConfigSub("alerts")}>Phương thức cảnh báo</button>
          </div>

          {configSub === "general" && (
            <div className="mt-5">
              <GroupTitle>Cấu hình email</GroupTitle>
              <div className="mt-3 grid gap-4 sm:grid-cols-2">
                <Field label="Email nhận thông báo đặt phòng *">
                  <input className={inputCls} value={config.notifyEmail} onChange={(e) => setConfig({ ...config, notifyEmail: e.target.value })} />
                </Field>
                <Field label="Email nhận mã truy cập thẻ (OTA)">
                  <input className={inputCls} value={config.cardEmail} onChange={(e) => setConfig({ ...config, cardEmail: e.target.value })} />
                </Field>
                <Field label="Email đồng gửi (cc)">
                  <input className={inputCls} value={config.ccEmail} onChange={(e) => setConfig({ ...config, ccEmail: e.target.value })} />
                </Field>
                <Field label="Email đồng gửi (bcc)">
                  <input className={inputCls} value={config.bccEmail} onChange={(e) => setConfig({ ...config, bccEmail: e.target.value })} />
                </Field>
              </div>
              <div className="mt-3 space-y-2 text-sm">
                <label className="flex items-center gap-2.5">
                  <input type="checkbox" className="h-4 w-4 accent-[#2563eb]" checked={config.autoCancelUnconfirmed} onChange={(e) => setConfig({ ...config, autoCancelUnconfirmed: e.target.checked })} />
                  Cho phép huỷ tự động nếu booking không được xác nhận
                </label>
                <label className="flex flex-wrap items-center gap-2.5">
                  <input
                    type="checkbox" className="h-4 w-4 accent-[#2563eb]"
                    checked={config.autoCancelFailedPaymentMinutes > 0}
                    onChange={(e) => setConfig({ ...config, autoCancelFailedPaymentMinutes: e.target.checked ? 30 : 0 })}
                  />
                  Cho phép huỷ tự động nếu booking thanh toán thất bại, sau
                  <input
                    type="number" min={0} className={`${inputSm} w-20`}
                    value={config.autoCancelFailedPaymentMinutes}
                    onChange={(e) => setConfig({ ...config, autoCancelFailedPaymentMinutes: Number(e.target.value) })}
                  />
                  phút
                </label>
              </div>

              <GroupTitle>Ngôn ngữ hiển thị & ngày cuối tuần</GroupTitle>
              <div className="mt-3 grid gap-4 sm:grid-cols-2">
                <Field label="Ngôn ngữ hiển thị">
                  <div className="flex gap-4 pt-1.5 text-sm">
                    {[{ code: "vi", label: "Tiếng Việt" }, { code: "en", label: "English" }].map((l) => (
                      <label key={l.code} className="flex items-center gap-2">
                        <input
                          type="checkbox" className="h-4 w-4 accent-[#2563eb]"
                          checked={config.displayLanguages.includes(l.code)}
                          onChange={(e) =>
                            setConfig({
                              ...config,
                              displayLanguages: e.target.checked
                                ? [...config.displayLanguages, l.code]
                                : config.displayLanguages.filter((x) => x !== l.code),
                            })
                          }
                        />
                        {l.label}
                      </label>
                    ))}
                  </div>
                </Field>
                <Field label="Ngôn ngữ sử dụng chính">
                  <div className="flex gap-4 pt-1.5 text-sm">
                    {[{ code: "vi", label: "Tiếng Việt" }, { code: "en", label: "English" }].map((l) => (
                      <label key={l.code} className="flex items-center gap-2">
                        <input
                          type="radio" name="primaryLang" className="h-4 w-4 accent-[#2563eb]"
                          checked={config.primaryLanguage === l.code}
                          onChange={() => setConfig({ ...config, primaryLanguage: l.code })}
                        />
                        {l.label}
                      </label>
                    ))}
                  </div>
                </Field>
              </div>
              <div className="mt-3">
                <span className="text-sm text-[#68707a]">Ngày cuối tuần (căn cứ tính giá cuối tuần)</span>
                <div className="mt-2 flex gap-2">
                  {[
                    { d: 1, l: "T2" }, { d: 2, l: "T3" }, { d: 3, l: "T4" }, { d: 4, l: "T5" },
                    { d: 5, l: "T6" }, { d: 6, l: "T7" }, { d: 0, l: "CN" },
                  ].map(({ d, l }) => {
                    const on = config.weekendDays.includes(d);
                    return (
                      <button
                        key={d}
                        onClick={() =>
                          setConfig({
                            ...config,
                            weekendDays: on ? config.weekendDays.filter((x) => x !== d) : [...config.weekendDays, d],
                          })
                        }
                        className={
                          on
                            ? "h-10 w-10 rounded-full bg-[#2563eb] text-sm font-semibold text-white"
                            : "h-10 w-10 rounded-full bg-[#eef1f5] text-sm font-medium text-[#68707a] hover:bg-[#e2e8f0]"
                        }
                      >
                        {l}
                      </button>
                    );
                  })}
                </div>
              </div>

              <GroupTitle>Đơn vị tiền tệ & mức thuế / phí</GroupTitle>
              <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Field label="Đơn vị tiền tệ">
                  <select className={inputCls} value={config.currency} onChange={(e) => setConfig({ ...config, currency: e.target.value })}>
                    <option value="VND">VND</option>
                    <option value="USD">USD</option>
                    <option value="EUR">EUR</option>
                  </select>
                </Field>
                <Field label="Thuế VAT (%)">
                  <input type="number" className={inputCls} value={config.vatPercent} onChange={(e) => setConfig({ ...config, vatPercent: Number(e.target.value) })} />
                </Field>
                <Field label="Phí dịch vụ (%)">
                  <input type="number" className={inputCls} value={config.serviceFeePercent} onChange={(e) => setConfig({ ...config, serviceFeePercent: Number(e.target.value) })} />
                </Field>
                <Field label="Giá hiển thị">
                  <label className="flex items-center gap-2.5 pt-2 text-sm">
                    <input type="checkbox" className="h-4 w-4 accent-[#2563eb]" checked={config.pricesIncludeTax} onChange={(e) => setConfig({ ...config, pricesIncludeTax: e.target.checked })} />
                    Giá đã bao gồm thuế / phí
                  </label>
                </Field>
              </div>

              <GroupTitle>Quy định về độ tuổi trẻ em</GroupTitle>
              <div className="mt-3 grid gap-4 sm:grid-cols-2">
                <Field label="Độ tuổi em bé tối đa">
                  <input type="number" min={0} className={inputCls} value={config.infantMaxAge} onChange={(e) => setConfig({ ...config, infantMaxAge: Number(e.target.value) })} />
                </Field>
                <Field label="Độ tuổi trẻ em tối đa">
                  <input type="number" min={0} className={inputCls} value={config.childMaxAge} onChange={(e) => setConfig({ ...config, childMaxAge: Number(e.target.value) })} />
                </Field>
              </div>
              <div className="mt-3">
                <Field label="Chính sách trẻ em">
                  <textarea className={inputCls} rows={2} value={config.childPolicy} onChange={(e) => setConfig({ ...config, childPolicy: e.target.value })} />
                </Field>
              </div>

              <GroupTitle>Thông tin khác</GroupTitle>
              <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <Field label="Giờ nhận phòng">
                  <input type="time" className={inputCls} value={hotel.checkInTime} onChange={(e) => setHotel({ ...hotel, checkInTime: e.target.value })} />
                </Field>
                <Field label="Giờ trả phòng">
                  <input type="time" className={inputCls} value={hotel.checkOutTime} onChange={(e) => setHotel({ ...hotel, checkOutTime: e.target.value })} />
                </Field>
                <Field label="Tổng số phòng (tự đếm)">
                  <input className={inputCls} value={rooms.length} disabled />
                </Field>
                <Field label="Năm xây dựng">
                  <input type="number" className={inputCls} value={config.yearBuilt} onChange={(e) => setConfig({ ...config, yearBuilt: Number(e.target.value) })} />
                </Field>
                <Field label="Tổng số tầng">
                  <input type="number" className={inputCls} value={config.floors} onChange={(e) => setConfig({ ...config, floors: Number(e.target.value) })} />
                </Field>
                <Field label="Dịch vụ phòng">
                  <select className={inputCls} value={config.roomService ? "yes" : "no"} onChange={(e) => setConfig({ ...config, roomService: e.target.value === "yes" })}>
                    <option value="yes">Có</option>
                    <option value="no">Không</option>
                  </select>
                </Field>
                <Field label="Khoảng cách tới sân bay (km)">
                  <input type="number" className={inputCls} value={config.distanceAirportKm} onChange={(e) => setConfig({ ...config, distanceAirportKm: Number(e.target.value) })} />
                </Field>
                <Field label="Thời gian tới sân bay (phút)">
                  <input type="number" className={inputCls} value={config.airportMinutes} onChange={(e) => setConfig({ ...config, airportMinutes: Number(e.target.value) })} />
                </Field>
                <Field label="Khoảng cách tới trung tâm (km)">
                  <input type="number" step="0.1" className={inputCls} value={config.distanceCenterKm} onChange={(e) => setConfig({ ...config, distanceCenterKm: Number(e.target.value) })} />
                </Field>
              </div>
              <div className="mt-3">
                <Field label="Quy định của khách sạn">
                  <textarea className={inputCls} rows={2} value={config.regulations} onChange={(e) => setConfig({ ...config, regulations: e.target.value })} />
                </Field>
              </div>

              <SaveRow msg={savedMsg} onSave={save} />
            </div>
          )}

          {configSub === "pay" && <div className="mt-5"><PolicySection items={payPolicies} setItems={setPayPolicies} /></div>}
          {configSub === "cancel" && <div className="mt-5"><PolicySection items={cancelPolicies} setItems={setCancelPolicies} /></div>}

          {configSub === "methods" && (
            <div className="mt-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Kênh bán áp dụng">
                  <select className={inputCls} value={methods.channelCode} onChange={(e) => setMethods({ ...methods, channelCode: e.target.value })}>
                    {CHANNELS.map((c) => (<option key={c.code} value={c.code}>{c.name}</option>))}
                  </select>
                </Field>
              </div>
              <div className="mt-4 space-y-2.5 text-sm">
                <label className="flex items-center gap-2.5">
                  <input type="checkbox" className="h-4 w-4 accent-[#2563eb]" checked={methods.bankTransfer} onChange={(e) => setMethods({ ...methods, bankTransfer: e.target.checked })} />
                  Thanh toán chuyển khoản
                </label>
                <label className="flex items-center gap-2.5">
                  <input type="checkbox" className="h-4 w-4 accent-[#2563eb]" checked={methods.cash} onChange={(e) => setMethods({ ...methods, cash: e.target.checked })} />
                  Thanh toán tiền mặt
                </label>
                <label className="flex items-center gap-2.5">
                  <input type="checkbox" className="h-4 w-4 accent-[#2563eb]" checked={methods.credit} onChange={(e) => setMethods({ ...methods, credit: e.target.checked })} />
                  Thanh toán công nợ (cho công ty / đại lý)
                </label>
              </div>
              <div className="mt-4">
                <Field label="Nội dung hiển thị cho khách">
                  <textarea className={inputCls} rows={3} value={methods.note} onChange={(e) => setMethods({ ...methods, note: e.target.value })} placeholder="Nhập nội dung hiển thị" />
                </Field>
              </div>
              <SaveRow msg={savedMsg} onSave={save} />
            </div>
          )}

          {configSub === "alerts" && (
            <div className="mt-5">
              <GroupTitle>Phương thức nhận cảnh báo</GroupTitle>
              <div className="mt-3 grid gap-4 sm:grid-cols-2">
                <Field label="Phương thức">
                  <select className={inputCls} value="email" disabled>
                    <option value="email">Email</option>
                  </select>
                </Field>
                <Field label="Nhập email *">
                  <input className={inputCls} value={alerts.email} onChange={(e) => setAlerts({ ...alerts, email: e.target.value })} />
                </Field>
              </div>
              <GroupTitle>Cảnh báo khi số lượng phòng đạt ngưỡng</GroupTitle>
              <label className="mt-3 flex flex-wrap items-center gap-2.5 text-sm">
                <input type="checkbox" className="h-4 w-4 accent-[#2563eb]" checked={alerts.enabled} onChange={(e) => setAlerts({ ...alerts, enabled: e.target.checked })} />
                Gửi cảnh báo khi số phòng còn lại của một loại phòng còn
                <input
                  type="number" min={0} className={`${inputSm} w-20`}
                  value={alerts.lowRoomThreshold}
                  disabled={!alerts.enabled}
                  onChange={(e) => setAlerts({ ...alerts, lowRoomThreshold: Number(e.target.value) })}
                />
                phòng trở xuống
              </label>
              <SaveRow msg={savedMsg} onSave={save} />
            </div>
          )}
        </div>
      )}

      {/* ================================================= ROOMS */}
      {mainTab === "rooms" && (
        <>
          <div className="cb-card mt-5 p-5">
            <h2 className="text-base font-bold text-[#17293e]">Loại phòng của khách sạn này</h2>
            <p className="mt-0.5 text-sm text-[#68707a]">Mỗi loại phòng có mã ngắn để khớp nối với các kênh bán. Tắt công tắc = ngừng bán mà không xoá dữ liệu.</p>
            <table className="mt-4 w-full text-sm">
              <thead>
                <tr className="border-b border-[#eef1f5] text-left text-xs uppercase tracking-wide text-[#68707a]">
                  <th className="py-2 pr-3 font-semibold">Mã</th>
                  <th className="py-2 pr-3 font-semibold">Tên loại phòng</th>
                  <th className="py-2 pr-3 font-semibold">Sức chứa</th>
                  <th className="py-2 pr-3 font-semibold">Giường</th>
                  <th className="py-2 pr-3 font-semibold">Số phòng</th>
                  <th className="py-2 pr-3 font-semibold">Đang bán</th>
                  <th className="py-2 text-right font-semibold"></th>
                </tr>
              </thead>
              <tbody>
                {roomTypes.map((t) => (
                  <tr key={t.id} className="border-b border-[#eef1f5]">
                    <td className="py-2.5 pr-3">
                      <span className="rounded-md bg-[#f0f3f7] px-2 py-0.5 text-xs font-semibold text-[#68707a]">{t.code ?? "—"}</span>
                    </td>
                    <td className="py-2.5 pr-3 font-medium">
                      <Link href={`/hotels/${id}/room-types/${t.id}`} className="text-[#2563eb] hover:underline" title="Mở trang quản lí loại phòng này">
                        {t.name}
                      </Link>
                    </td>
                    <td className="py-2.5 pr-3">
                      {t.maxAdults !== undefined ? `${t.maxAdults} người lớn, ${t.maxChildren ?? 0} trẻ em` : `${t.maxOccupancy} khách`}
                    </td>
                    <td className="py-2.5 pr-3">{t.bedConfig}</td>
                    <td className="py-2.5 pr-3">{rooms.filter((r) => r.roomTypeId === t.id).length} phòng</td>
                    <td className="py-2.5 pr-3">
                      <button
                        onClick={() => setRoomTypes((p) => p.map((x) => (x.id === t.id ? { ...x, active: !(x.active ?? true) } : x)))}
                        className={`relative h-5 w-9 rounded-full transition ${t.active ?? true ? "bg-[#2563eb]" : "bg-gray-300"}`}
                        title="Đang bán / ngừng bán"
                      >
                        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${t.active ?? true ? "left-[18px]" : "left-0.5"}`} />
                      </button>
                    </td>
                    <td className="py-2.5 text-right">
                      <button onClick={() => deleteRoomType(t.id)} className="font-medium text-[#e5484d] hover:underline">Xoá</button>
                    </td>
                  </tr>
                ))}
                {roomTypes.length === 0 && (
                  <tr><td colSpan={7} className="py-6 text-center text-[#68707a]">Chưa có loại phòng nào — tạo mới bên dưới.</td></tr>
                )}
              </tbody>
            </table>
            <div className="mt-4 flex flex-wrap items-end gap-2">
              <input className={inputSm} placeholder="Tên loại phòng mới" value={typeName} onChange={(e) => setTypeName(e.target.value)} />
              <input className={`${inputSm} w-24`} placeholder="Mã, VD: DLX" value={typeCode} onChange={(e) => setTypeCode(e.target.value)} />
              <label className="text-xs text-[#68707a]">Người lớn<input type="number" min={1} className={`${inputSm} mt-0.5 w-20`} value={typeAdults} onChange={(e) => setTypeAdults(Number(e.target.value))} /></label>
              <label className="text-xs text-[#68707a]">Trẻ em<input type="number" min={0} className={`${inputSm} mt-0.5 w-20`} value={typeChildren} onChange={(e) => setTypeChildren(Number(e.target.value))} /></label>
              <input className={inputSm} placeholder="Kiểu giường" value={typeBed} onChange={(e) => setTypeBed(e.target.value)} />
              <button className="cb-btn-primary px-4 py-2 text-sm" onClick={addRoomType}>+ Thêm loại phòng</button>
            </div>
          </div>

          <div className="cb-card mt-5 p-5">
            <h2 className="text-base font-bold text-[#17293e]">Phòng vật lý của khách sạn này</h2>
            <p className="mt-0.5 text-sm text-[#68707a]">Từng số phòng cụ thể — đây là các hàng trong Lịch phòng của lễ tân.</p>
            <table className="mt-4 w-full text-sm">
              <thead>
                <tr className="border-b border-[#eef1f5] text-left text-xs uppercase tracking-wide text-[#68707a]">
                  <th className="py-2 pr-3 font-semibold">Số phòng</th>
                  <th className="py-2 pr-3 font-semibold">Loại phòng</th>
                  <th className="py-2 pr-3 font-semibold">Trạng thái dọn phòng</th>
                  <th className="py-2 text-right font-semibold"></th>
                </tr>
              </thead>
              <tbody>
                {rooms.map((r) => (
                  <tr key={r.number} className="border-b border-[#eef1f5]">
                    <td className="py-2.5 pr-3 font-bold text-[#17293e]">{r.number}</td>
                    <td className="py-2.5 pr-3">{roomTypes.find((t) => t.id === r.roomTypeId)?.name ?? "—"}</td>
                    <td className="py-2.5 pr-3">
                      <select
                        className="rounded-lg border border-[#dde3ea] px-2 py-1 text-[13px] outline-none focus:border-[#2563eb]"
                        value={r.housekeepingStatus}
                        onChange={(e) =>
                          setRooms((p) =>
                            p.map((x) => (x.number === r.number ? { ...x, housekeepingStatus: e.target.value as Room["housekeepingStatus"] } : x))
                          )
                        }
                      >
                        {(Object.keys(HK_LABELS) as Room["housekeepingStatus"][]).map((s) => (
                          <option key={s} value={s}>{HK_LABELS[s]}</option>
                        ))}
                      </select>
                    </td>
                    <td className="py-2.5 text-right">
                      <button onClick={() => deleteRoom(r.number)} className="font-medium text-[#e5484d] hover:underline">Xoá</button>
                    </td>
                  </tr>
                ))}
                {rooms.length === 0 && (
                  <tr><td colSpan={4} className="py-6 text-center text-[#68707a]">Chưa có phòng nào.</td></tr>
                )}
              </tbody>
            </table>
            <div className="mt-4 flex flex-wrap gap-2">
              <input className={`${inputSm} w-36`} placeholder="Số phòng, VD: 105" value={roomNumber} onChange={(e) => setRoomNumber(e.target.value)} />
              <select className={inputSm} value={roomTypeId} onChange={(e) => setRoomTypeId(e.target.value)}>
                {roomTypes.map((t) => (<option key={t.id} value={t.id}>{t.name}</option>))}
              </select>
              <button className="cb-btn-primary px-4 py-2 text-sm" onClick={addRoom}>+ Thêm phòng</button>
            </div>
          </div>
        </>
      )}

      {/* ================================================= PLANS */}
      {mainTab === "plans" && (
        <div className="cb-card mt-5 p-5">
          <h2 className="text-base font-bold text-[#17293e]">Gói giá theo kênh của khách sạn này</h2>
          <p className="mt-0.5 text-sm text-[#68707a]">Mỗi gói thuộc đúng 1 kênh + 1 loại phòng của khách sạn này. Giá từng ngày sửa ở trang Lịch giá.</p>
          <div className="mb-3 mt-4 flex items-center gap-2 text-sm">
            <span className="text-[#68707a]">Lọc theo kênh:</span>
            <select className={inputSm} value={planChannelFilter} onChange={(e) => setPlanChannelFilter(e.target.value)}>
              <option value="all">Tất cả kênh</option>
              {CHANNELS.map((c) => (<option key={c.code} value={c.code}>{c.name}</option>))}
            </select>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#eef1f5] text-left text-xs uppercase tracking-wide text-[#68707a]">
                <th className="py-2 pr-3 font-semibold">Kênh</th>
                <th className="py-2 pr-3 font-semibold">Gói giá</th>
                <th className="py-2 pr-3 font-semibold">Loại phòng</th>
                <th className="py-2 pr-3 font-semibold">Chính sách huỷ</th>
                <th className="py-2 pr-3 font-semibold">Giá ngày thường</th>
                <th className="py-2 pr-3 font-semibold">Giá cuối tuần</th>
                <th className="py-2 text-right font-semibold"></th>
              </tr>
            </thead>
            <tbody>
              {visiblePlans.map((p) => (
                <tr key={p.id} className="border-b border-[#eef1f5]">
                  <td className="py-2.5 pr-3">{CHANNELS.find((c) => c.code === p.channelCode)?.name}</td>
                  <td className="py-2.5 pr-3 font-medium text-[#17293e]">{p.name}</td>
                  <td className="py-2.5 pr-3">{roomTypes.find((t) => t.id === p.roomTypeId)?.name}</td>
                  <td className="py-2.5 pr-3">{p.cancellationPolicy === "flexible" ? "Huỷ linh hoạt" : "Không hoàn tiền"}</td>
                  <td className="py-2.5 pr-3">{fmt(p.prices["2026-10-21"] ?? 0)}₫</td>
                  <td className="py-2.5 pr-3">{fmt(p.prices["2026-10-24"] ?? 0)}₫</td>
                  <td className="py-2.5 text-right">
                    <button onClick={() => setPlans((prev) => prev.filter((x) => x.id !== p.id))} className="font-medium text-[#e5484d] hover:underline">Xoá</button>
                  </td>
                </tr>
              ))}
              {visiblePlans.length === 0 && (
                <tr><td colSpan={7} className="py-6 text-center text-[#68707a]">Chưa có gói giá nào khớp — tạo mới bên dưới.</td></tr>
              )}
            </tbody>
          </table>
          <div className="mt-4 flex flex-wrap items-end gap-2">
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
            <label className="text-xs text-[#68707a]">Ngày thường<input type="number" step={1000} className={`${inputSm} mt-0.5 w-32`} value={planWeekday} onChange={(e) => setPlanWeekday(Number(e.target.value))} /></label>
            <label className="text-xs text-[#68707a]">Cuối tuần<input type="number" step={1000} className={`${inputSm} mt-0.5 w-32`} value={planWeekend} onChange={(e) => setPlanWeekend(Number(e.target.value))} /></label>
            <button className="cb-btn-primary px-4 py-2 text-sm" onClick={addPlan}>+ Tạo gói giá</button>
          </div>
        </div>
      )}
    </div>
  );
}
