"use client";

// ============================================================
// FILE HOTELCONFIG3 — app/[hotelId]/hotel-config/page.tsx
// Trang CAU HINH KHACH SAN rieng biet (theo yeu cau 2026-10-27):
// khong con thanh tab lon (Thong tin chung / Cau hinh / Loai
// phong & Phong chung 1 trang) nua. Trang nay chi co 5 tab con:
//   Cau hinh chung | Chinh sach thanh toan | Chinh sach huy
//   dat phong | Phuong thuc thanh toan | Phuong thuc canh bao
// (dung nhu anh Vos gui). Trang nay TU CHUA moi thu, khong
// dung chung component HotelDetailPage nua — dan 1 file nay
// la chay ngay. Ham luu ghi lai toan bo profile nen cac phan
// khac (thong tin chung, tien ich, hinh anh...) khong bi mat.
// HOTELCONFIG3 (2026-11-13, chuot lai tu tren xuong duoi):
//   - Tien te mo rong quoc te (12 loai thay vi 3).
//   - Nam xay dung / so tang / khoang cach de trong khi chua
//     nhap, thay vi hien 0.
//   - Ten + mo ta chinh sach sua duoc ngay trong bang (truoc
//     day muon sua phai xoa roi them lai).
//   - O "Phuong thuc" canh bao bo select khoa cung chi co
//     Email, doi thanh dong chu ro rang.
//   - Ghi ro 2 cai dat chi luu chu chua chay that (huy tu
//     dong, canh bao phong sap het) — can may chu 24/7 o GĐ4.
// ============================================================

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { currentHotelId } from "@/lib/current-hotel";
import {
  CHANNELS,
  type Hotel,
  type HotelAlerts,
  type HotelConfig,
  type HotelPhoto,
  type NamedPolicy,
  type NearbyPlace,
  type PaymentMethods,
} from "@/lib/mock-data";

const inputCls =
  "w-full rounded-lg border border-[#dde3ea] bg-white px-3 py-2 text-sm outline-none focus:border-[#2563eb]";
const inputSm =
  "rounded-lg border border-[#dde3ea] bg-white px-3 py-2 text-sm outline-none focus:border-[#2563eb]";

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
              <td className="py-2.5 pr-3">
                <input
                  className={`${inputSm} w-full font-medium text-[#17293e]`}
                  value={p.name}
                  onChange={(e) => setItems((prev) => prev.map((x) => (x.id === p.id ? { ...x, name: e.target.value } : x)))}
                />
              </td>
              <td className="py-2.5 pr-3">
                <input
                  className={`${inputSm} w-full text-[#68707a]`}
                  value={p.description}
                  placeholder="—"
                  onChange={(e) => setItems((prev) => prev.map((x) => (x.id === p.id ? { ...x, description: e.target.value } : x)))}
                />
              </td>
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

type SubTab = "general" | "pay" | "cancel" | "methods" | "alerts";

export default function HotelConfigPage() {
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
  const [roomCount, setRoomCount] = useState(0);
  const [savedMsg, setSavedMsg] = useState("");
  const [loading, setLoading] = useState(true);
  const [dbError, setDbError] = useState("");
  const loadedRef = useRef(false);
  const [sub, setSub] = useState<SubTab>("general");

  // ----- LOAD this hotel's row + room count from Supabase -----
  useEffect(() => {
    (async () => {
      const [{ data: row, error }, roomsRes] = await Promise.all([
        supabase.from("hotels").select("*").eq("id", id).single(),
        supabase.from("rooms").select("number").eq("hotel_id", id),
      ]);
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
      setRoomCount((roomsRes.data ?? []).length);
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
      name: hotel.name, address: hotel.address || null, city: hotel.city || null,
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
      ? "rounded-full bg-[#e8effe] px-3.5 py-1.5 text-[13px] font-semibold text-[#2563eb]"
      : "rounded-full px-3.5 py-1.5 text-[13px] text-[#68707a] hover:bg-[#f4f7fb]";

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

      {/* ===== 5 tab con cua Cau hinh khach san ===== */}
      <div className="cb-card mt-5 p-5">
        <div className="flex flex-wrap gap-1.5">
          <button className={subBtn(sub === "general")} onClick={() => setSub("general")}>Cấu hình chung</button>
          <button className={subBtn(sub === "pay")} onClick={() => setSub("pay")}>Chính sách thanh toán</button>
          <button className={subBtn(sub === "cancel")} onClick={() => setSub("cancel")}>Chính sách huỷ đặt phòng</button>
          <button className={subBtn(sub === "methods")} onClick={() => setSub("methods")}>Phương thức thanh toán</button>
          <button className={subBtn(sub === "alerts")} onClick={() => setSub("alerts")}>Phương thức cảnh báo</button>
        </div>

        {/* ----- general config ----- */}
        {sub === "general" && (
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
            <p className="mt-2 text-[13px] text-[#68707a]">
              Huỷ tự động chỉ chạy khi có máy chủ chạy 24/7 — hiện chỉ lưu cài đặt, chưa tự huỷ (làm ở GĐ4).
            </p>

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
                  {["VND", "USD", "EUR", "GBP", "JPY", "KRW", "SGD", "THB", "AUD", "CAD", "CNY", "HKD"].map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
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
                <input className={inputCls} value={roomCount} disabled />
              </Field>
              <Field label="Năm xây dựng">
                <input type="number" className={inputCls} value={config.yearBuilt || ""} onChange={(e) => setConfig({ ...config, yearBuilt: Number(e.target.value) || 0 })} />
              </Field>
              <Field label="Tổng số tầng">
                <input type="number" className={inputCls} value={config.floors || ""} onChange={(e) => setConfig({ ...config, floors: Number(e.target.value) || 0 })} />
              </Field>
              <Field label="Dịch vụ phòng">
                <select className={inputCls} value={config.roomService ? "yes" : "no"} onChange={(e) => setConfig({ ...config, roomService: e.target.value === "yes" })}>
                  <option value="yes">Có</option>
                  <option value="no">Không</option>
                </select>
              </Field>
              <Field label="Khoảng cách tới sân bay (km)">
                <input type="number" className={inputCls} value={config.distanceAirportKm || ""} onChange={(e) => setConfig({ ...config, distanceAirportKm: Number(e.target.value) || 0 })} />
              </Field>
              <Field label="Thời gian tới sân bay (phút)">
                <input type="number" className={inputCls} value={config.airportMinutes || ""} onChange={(e) => setConfig({ ...config, airportMinutes: Number(e.target.value) || 0 })} />
              </Field>
              <Field label="Khoảng cách tới trung tâm (km)">
                <input type="number" step="0.1" className={inputCls} value={config.distanceCenterKm || ""} onChange={(e) => setConfig({ ...config, distanceCenterKm: Number(e.target.value) || 0 })} />
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

        {/* ----- payment policies ----- */}
        {sub === "pay" && (
          <div className="mt-5">
            <PolicySection items={payPolicies} setItems={setPayPolicies} />
            <SaveRow msg={savedMsg} onSave={save} />
          </div>
        )}

        {/* ----- cancellation policies ----- */}
        {sub === "cancel" && (
          <div className="mt-5">
            <PolicySection items={cancelPolicies} setItems={setCancelPolicies} />
            <SaveRow msg={savedMsg} onSave={save} />
          </div>
        )}

        {/* ----- payment methods ----- */}
        {sub === "methods" && (
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

        {/* ----- alert methods ----- */}
        {sub === "alerts" && (
          <div className="mt-5">
            <GroupTitle>Phương thức nhận cảnh báo</GroupTitle>
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <Field label="Phương thức">
                <div className="rounded-lg border border-[#dde3ea] bg-[#f7f9fb] px-3 py-2 text-sm text-[#17293e]">
                  Email <span className="text-[#68707a]">— SMS / Zalo sẽ có sau</span>
                </div>
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
            <p className="mt-3 text-[13px] text-[#68707a]">
              Cảnh báo chỉ gửi được khi có email + máy chủ kiểm tra tồn phòng — hiện chỉ lưu cài đặt (làm ở GĐ4).
            </p>
            <SaveRow msg={savedMsg} onSave={save} />
          </div>
        )}
      </div>
    </div>
  );
}
