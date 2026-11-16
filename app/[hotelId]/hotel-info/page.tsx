"use client";

// ============================================================
// FILE HOTELINFO3 — app/[hotelId]/hotel-info/page.tsx
// Trang THONG TIN CHUNG rieng biet (theo yeu cau 2026-10-27):
// khong con thanh tab lon (Thong tin chung / Cau hinh / Loai
// phong & Phong chung 1 trang) nua. Trang nay co 4 tab con:
//   Thong tin dang ky | Tien ich | Hinh anh | Dia diem lan can
// (dung nhu anh Vos gui, them tab Dia diem lan can).
// HOTELINFO3 (2026-11-13, chuot lai tu tren xuong duoi):
//   - Ma khach san nhap duoc khi con trong, luu that vao DB.
//   - Logo + anh them bang link (co xem truoc, sua chu thich,
//     dat anh bia); tai file truc tiep can kho anh (buoc sau).
//   - Them tab Dia diem lan can (truc day khong co cho sua).
//   - Mui gio mo rong quoc te; sao co muc "Chua xep hang";
//     vi do/kinh do trong thi de trong thay vi 0; mo ta gioi
//     han that 3000 ky tu.
// Trang nay TU CHUA moi thu, khong dung chung component
// HotelDetailPage nua — dan 1 file nay la chay ngay.
// ============================================================

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { currentHotelId } from "@/lib/current-hotel";
import {
  AMENITY_GROUPS,
  type Hotel,
  type HotelAlerts,
  type HotelConfig,
  type HotelPhoto,
  type NamedPolicy,
  type NearbyCategory,
  type NearbyPlace,
  type PaymentMethods,
} from "@/lib/mock-data";

const inputCls =
  "w-full rounded-lg border border-[#dde3ea] bg-white px-3 py-2 text-sm outline-none focus:border-[#2563eb]";
// Ban input khong w-full, dung cho cac dong form nhieu o nam ngang.
const rowInputCls =
  "rounded-lg border border-[#dde3ea] bg-white px-3 py-2 text-sm outline-none focus:border-[#2563eb]";
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

const NEARBY_LABELS: Record<NearbyCategory, string> = {
  nearest: "Địa điểm gần nhất",
  popular: "Địa điểm nổi tiếng",
  airport: "Sân bay gần nhất",
  tourist: "Điểm du lịch",
  food: "Nhà hàng & chợ địa phương",
};

// ---------- defaults for a hotel that has not filled these in ----------
// (kept so SAVE writes the whole profile back untouched — the parts
// this page does not edit, like config, are never lost)
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

type SubTab = "info" | "amenities" | "photos" | "nearby";

export default function HotelInfoPage() {
  const params = useParams();
  const id = typeof params.hotelId === "string" ? params.hotelId : currentHotelId();

  // ----- state: profile (loaded from DB; unedited parts are kept as-is for save) -----
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
  const [sub, setSub] = useState<SubTab>("info");
  // ----- form them dia diem lan can -----
  const [nbCategory, setNbCategory] = useState<NearbyCategory>("tourist");
  const [nbName, setNbName] = useState("");
  const [nbDistance, setNbDistance] = useState(0);
  // ----- form them anh bang link -----
  const [newPhotoUrl, setNewPhotoUrl] = useState("");
  const [newPhotoCaption, setNewPhotoCaption] = useState("");

  // ----- LOAD this hotel's row from Supabase -----
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
      setLoading(false);
    })();
  }, [id]);

  // ----- SAVE: one update of the hotels row (whole profile, so nothing is lost) -----
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
      name: hotel.name, code: hotel.code || null, address: hotel.address || null, city: hotel.city || null,
      star_rating: hotel.starRating ?? null,
      timezone: hotel.timezone || null,
      check_in_time: hotel.checkInTime, check_out_time: hotel.checkOutTime,
      latitude: hotel.latitude ?? null, longitude: hotel.longitude ?? null,
      profile,
    }).eq("id", id);
    setSavedMsg(error ? "Lỗi khi lưu: " + error.message : "✓ Đã lưu vào cơ sở dữ liệu.");
  };

  const subBtn = (active: boolean) =>
    active
      ? "border-b-2 border-[#2563eb] px-4 py-2.5 text-sm font-semibold text-[#2563eb]"
      : "border-b-2 border-transparent px-4 py-2.5 text-sm text-[#68707a] hover:text-[#17293e]";

  return (
    <div>
      <Link href="/" className="text-sm font-medium text-[#2563eb] hover:underline">
        ← Tất cả khách sạn
      </Link>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold text-[#17293e]">{hotel.name}</h1>
        {hotel.code && (
          <span className="rounded-md bg-[#f0f3f7] px-2 py-0.5 text-xs font-semibold text-[#68707a]">{hotel.code}</span>
        )}
        {hotel.starRating && <span className="text-amber-500">{"★".repeat(hotel.starRating)}</span>}
      </div>
      <p className="mt-1 text-sm text-[#68707a]">
        Trang quản lí riêng của khách sạn này — không ảnh hưởng khách sạn khác.
      </p>
      {loading && <p className="mt-3 text-sm text-[#68707a]">Đang tải dữ liệu từ Supabase...</p>}
      {dbError && <p className="mt-3 rounded-lg bg-[#fdecec] px-3 py-2 text-sm text-[#e5484d]">Lỗi cơ sở dữ liệu: {dbError}</p>}

      {/* ===== 4 tab con cua Thong tin chung ===== */}
      <div className="mt-5 flex flex-wrap border-b border-[#dde3ea]">
        <button className={subBtn(sub === "info")} onClick={() => setSub("info")}>Thông tin đăng ký</button>
        <button className={subBtn(sub === "amenities")} onClick={() => setSub("amenities")}>Tiện ích</button>
        <button className={subBtn(sub === "photos")} onClick={() => setSub("photos")}>Hình ảnh</button>
        <button className={subBtn(sub === "nearby")} onClick={() => setSub("nearby")}>Địa điểm lân cận</button>
      </div>

      <div className="cb-card mt-5 p-5">
        {/* ----- registration info ----- */}
        {sub === "info" && (
          <div>
            <h2 className="text-[13px] font-bold uppercase tracking-wide text-[#68707a]">
              Thông tin đăng ký khách sạn
            </h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Mã khách sạn">
                <input
                  className={inputCls}
                  value={hotel.code ?? ""}
                  placeholder="Nhập mã, VD: DEMO"
                  disabled={!!hotel.code}
                  onChange={(e) => setHotel({ ...hotel, code: e.target.value || undefined })}
                />
              </Field>
              <Field label="Tên khách sạn *">
                <input className={inputCls} value={hotel.name} onChange={(e) => setHotel({ ...hotel, name: e.target.value })} />
              </Field>
              <Field label="Tên tiếng Anh">
                <input className={inputCls} value={hotel.nameEn ?? ""} onChange={(e) => setHotel({ ...hotel, nameEn: e.target.value })} />
              </Field>
              <Field label="Hạng sao">
                <select className={inputCls} value={hotel.starRating ?? ""} onChange={(e) => setHotel({ ...hotel, starRating: e.target.value === "" ? undefined : Number(e.target.value) })}>
                  <option value="">— Chưa xếp hạng —</option>
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
                  <option value="Asia/Jakarta">(GMT+07:00) Jakarta</option>
                  <option value="Asia/Singapore">(GMT+08:00) Singapore</option>
                  <option value="Asia/Kuala_Lumpur">(GMT+08:00) Kuala Lumpur</option>
                  <option value="Asia/Manila">(GMT+08:00) Manila</option>
                  <option value="Asia/Shanghai">(GMT+08:00) Thượng Hải</option>
                  <option value="Asia/Hong_Kong">(GMT+08:00) Hồng Kông</option>
                  <option value="Asia/Tokyo">(GMT+09:00) Tokyo</option>
                  <option value="Asia/Seoul">(GMT+09:00) Seoul</option>
                  <option value="Asia/Dubai">(GMT+04:00) Dubai</option>
                  <option value="Europe/London">(GMT+00:00) London</option>
                  <option value="Europe/Paris">(GMT+01:00) Paris</option>
                  <option value="America/New_York">(GMT-05:00) New York</option>
                  <option value="America/Los_Angeles">(GMT-08:00) Los Angeles</option>
                  <option value="Australia/Sydney">(GMT+11:00) Sydney</option>
                  <option value="Pacific/Auckland">(GMT+13:00) Auckland</option>
                  <option value="UTC">(GMT+00:00) UTC</option>
                </select>
              </Field>
              <Field label="Số điện thoại liên hệ *">
                <input className={inputCls} value={hotel.phone} onChange={(e) => setHotel({ ...hotel, phone: e.target.value })} />
              </Field>
              <Field label="Email *">
                <input className={inputCls} value={hotel.email} onChange={(e) => setHotel({ ...hotel, email: e.target.value })} />
              </Field>
              <Field label="Logo khách sạn">
                {hotel.logoUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={hotel.logoUrl} alt="Logo khách sạn" className="mb-2 h-12 w-auto rounded-lg border border-[#dde3ea] bg-white object-contain" />
                )}
                <input
                  className={inputCls}
                  value={hotel.logoUrl ?? ""}
                  placeholder="Dán link ảnh logo (https://...)"
                  onChange={(e) => setHotel({ ...hotel, logoUrl: e.target.value || undefined })}
                />
                {hotel.logoUrl && (
                  <button onClick={() => setHotel({ ...hotel, logoUrl: undefined })} className="mt-1 text-xs font-medium text-[#e5484d] hover:underline">
                    Xoá logo
                  </button>
                )}
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
                <textarea className={inputCls} rows={4} maxLength={3000} value={hotel.descriptionVi ?? ""} onChange={(e) => setHotel({ ...hotel, descriptionVi: e.target.value })} />
              </Field>
              <Field label={`Description (English) — ${(hotel.descriptionEn ?? "").length}/3000 ký tự`}>
                <textarea className={inputCls} rows={4} maxLength={3000} value={hotel.descriptionEn ?? ""} onChange={(e) => setHotel({ ...hotel, descriptionEn: e.target.value })} />
              </Field>
            </div>

            <GroupTitle>Vị trí trên bản đồ</GroupTitle>
            <div className="mt-3 grid gap-4 sm:grid-cols-3">
              <Field label="Vĩ độ">
                <input type="number" step="0.0001" className={inputCls} value={hotel.latitude ?? ""} onChange={(e) => setHotel({ ...hotel, latitude: e.target.value === "" ? undefined : Number(e.target.value) })} />
              </Field>
              <Field label="Kinh độ">
                <input type="number" step="0.0001" className={inputCls} value={hotel.longitude ?? ""} onChange={(e) => setHotel({ ...hotel, longitude: e.target.value === "" ? undefined : Number(e.target.value) })} />
              </Field>
              <Field label="Mức zoom">
                <input type="number" className={inputCls} value={hotel.mapZoom ?? 15} onChange={(e) => setHotel({ ...hotel, mapZoom: Number(e.target.value) })} />
              </Field>
            </div>

            <SaveRow msg={savedMsg} onSave={save} />
          </div>
        )}

        {/* ----- amenities ----- */}
        {sub === "amenities" && (
          <div>
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
        {sub === "photos" && (
          <div>
            <div className="rounded-xl border border-[#dde3ea] bg-[#f7f9fb] px-4 py-4">
              <div className="font-medium text-[#17293e]">Thêm ảnh bằng link</div>
              <div className="mt-1 text-sm text-[#68707a]">
                Dán link ảnh (https://...) — ảnh lưu vào hồ sơ khách sạn khi bấm Lưu bên dưới. Tải file ảnh trực tiếp từ máy lên sẽ có ở bước kho ảnh sau.
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <input className={`${rowInputCls} min-w-56 flex-1`} placeholder="Link ảnh, VD: https://..." value={newPhotoUrl} onChange={(e) => setNewPhotoUrl(e.target.value)} />
                <input className={`${rowInputCls} w-56`} placeholder="Chú thích ảnh" value={newPhotoCaption} onChange={(e) => setNewPhotoCaption(e.target.value)} />
                <button
                  onClick={() => {
                    if (!newPhotoUrl.trim().startsWith("http")) return alert("Link ảnh phải bắt đầu bằng http:// hoặc https://");
                    setPhotos((p) => [...p, { id: `photo-${Date.now()}`, url: newPhotoUrl.trim(), caption: newPhotoCaption.trim() || "Ảnh mới" }]);
                    setNewPhotoUrl("");
                    setNewPhotoCaption("");
                  }}
                  className="cb-btn-primary px-4 py-2 text-sm"
                >
                  + Thêm ảnh
                </button>
              </div>
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
                  <div className="px-3 py-2">
                    <input
                      className="w-full rounded-md border border-transparent px-1 py-0.5 text-[13px] text-[#17293e] outline-none focus:border-[#2563eb]"
                      value={ph.caption}
                      placeholder="Chú thích ảnh"
                      onChange={(e) => setPhotos((p) => p.map((x) => (x.id === ph.id ? { ...x, caption: e.target.value } : x)))}
                    />
                    {i > 0 && (
                      <button
                        onClick={() => setPhotos((p) => [ph, ...p.filter((x) => x.id !== ph.id)])}
                        className="mt-0.5 text-xs font-medium text-[#2563eb] hover:underline"
                      >
                        Đặt làm ảnh bìa
                      </button>
                    )}
                  </div>
                </div>
              ))}
              {photos.length === 0 && (
                <div className="py-6 text-sm text-[#68707a] sm:col-span-2 lg:col-span-3">
                  Chưa có ảnh nào — thêm ảnh đầu tiên bằng link ở trên.
                </div>
              )}
            </div>
            <div className="mt-4 text-[13px] text-[#68707a]">
              Kênh bán áp dụng: <b className="text-[#17293e]">Website (Booking Engine)</b> — ảnh chỉ phục vụ
              trang đặt phòng của khách sạn, không đẩy lên các OTA.
            </div>
            <SaveRow msg={savedMsg} onSave={save} />
          </div>
        )}

        {/* ----- nearby places ----- */}
        {sub === "nearby" && (
          <div>
            <p className="text-sm text-[#68707a]">
              Địa điểm xung quanh khách sạn — hiện trên trang đặt phòng để khách hình dung vị trí.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <select className={rowInputCls} value={nbCategory} onChange={(e) => setNbCategory(e.target.value as NearbyCategory)}>
                {(Object.keys(NEARBY_LABELS) as NearbyCategory[]).map((c) => (
                  <option key={c} value={c}>{NEARBY_LABELS[c]}</option>
                ))}
              </select>
              <input className={`${rowInputCls} min-w-56 flex-1`} placeholder="Tên địa điểm, VD: Hồ Xuân Hương" value={nbName} onChange={(e) => setNbName(e.target.value)} />
              <input type="number" step="0.1" min={0} className={`${rowInputCls} w-28`} value={nbDistance} onChange={(e) => setNbDistance(Number(e.target.value))} title="Khoảng cách (km)" />
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
            <SaveRow msg={savedMsg} onSave={save} />
          </div>
        )}
      </div>
    </div>
  );
}
