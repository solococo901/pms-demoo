"use client";

// ============================================================
// FILE B44d2 — app/hotels/page.tsx (Cloudbeds style)
// The hotels LIST page, now reading from Supabase:
//   - Hotel basics come from the hotels table (name, code,
//     address, stars) + the profile "pouch" (phone, email,
//     cover photo, config presence, amenities/photos/nearby
//     counts for the completeness meter).
//   - Room / room-type / plan counts are counted live from
//     their tables, per hotel.
//   - "Add hotel" INSERTS a real row — the new hotel exists
//     in the database immediately (with 0 rooms, to be filled
//     in on its own management page).
// ============================================================

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

const ACCOUNT_ID = "11111111-1111-1111-1111-111111111111";

type HotelCard = {
  id: string;
  code?: string;
  name: string;
  address: string;
  phone: string;
  email: string;
  starRating?: number;
  coverUrl?: string;
  coverCaption?: string;
  roomsCount: number;
  typesCount: number;
  plansCount: number;
  hasConfig: boolean;
  amenitiesCount: number;
  photosCount: number;
  nearbyCount: number;
};

// The 7 sections of a complete hotel profile (ezCloud style).
function completeness(h: HotelCard) {
  const checks = [
    { label: "Thông tin đăng ký", done: !!(h.name && h.address && h.phone && h.email) },
    { label: "Cấu hình", done: h.hasConfig },
    { label: "Tiện ích", done: h.amenitiesCount > 0 },
    { label: "Hình ảnh", done: h.photosCount > 0 },
    { label: "Địa điểm lân cận", done: h.nearbyCount > 0 },
    { label: "Loại phòng", done: h.typesCount > 0 },
    { label: "Gói giá", done: h.plansCount > 0 },
  ];
  const done = checks.filter((c) => c.done).length;
  return {
    checks,
    done,
    total: checks.length,
    pct: Math.round((done / checks.length) * 100),
    missing: checks.filter((c) => !c.done).map((c) => c.label),
  };
}

export default function HotelsPage() {
  const [hotels, setHotels] = useState<HotelCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [dbError, setDbError] = useState("");
  const [query, setQuery] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: "", address: "", phone: "", email: "" });

  useEffect(() => {
    (async () => {
      const [hotelsRes, typesRes, roomsRes, plansRes] = await Promise.all([
        supabase.from("hotels").select("*").eq("account_id", ACCOUNT_ID).order("name"),
        supabase.from("room_types").select("hotel_id"),
        supabase.from("rooms").select("hotel_id"),
        supabase.from("rate_plans").select("hotel_id"),
      ]);
      const err = hotelsRes.error ?? typesRes.error ?? roomsRes.error ?? plansRes.error;
      if (err) {
        setDbError(err.message);
        setLoading(false);
        return;
      }
      const countBy = (rows: { hotel_id: string }[] | null) => {
        const m = new Map<string, number>();
        for (const r of rows ?? []) m.set(r.hotel_id, (m.get(r.hotel_id) ?? 0) + 1);
        return m;
      };
      const typeCounts = countBy(typesRes.data);
      const roomCounts = countBy(roomsRes.data);
      const planCounts = countBy(plansRes.data);
      setHotels(
        (hotelsRes.data ?? []).map((row) => {
          const profile = (row.profile ?? {}) as Record<string, any>;
          const photos = (profile.photos ?? []) as { url: string; caption: string }[];
          return {
            id: row.id,
            code: row.code ?? undefined,
            name: row.name,
            address: row.address ?? "",
            phone: profile.phone ?? "",
            email: profile.email ?? "",
            starRating: row.star_rating ?? undefined,
            coverUrl: photos[0]?.url,
            coverCaption: photos[0]?.caption,
            roomsCount: roomCounts.get(row.id) ?? 0,
            typesCount: typeCounts.get(row.id) ?? 0,
            plansCount: planCounts.get(row.id) ?? 0,
            hasConfig: !!profile.config,
            amenitiesCount: (profile.amenities ?? []).length,
            photosCount: photos.length,
            nearbyCount: (profile.nearby ?? []).length,
          };
        })
      );
      setLoading(false);
    })();
  }, []);

  async function addHotel() {
    if (!form.name.trim()) return alert("Chưa nhập tên khách sạn.");
    const id = form.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    if (!id) return alert("Tên khách sạn cần có ít nhất một chữ cái hoặc số.");
    if (hotels.some((h) => h.id === id)) return alert("Khách sạn này đã có trong danh sách.");
    const { error } = await supabase.from("hotels").insert({
      id,
      account_id: ACCOUNT_ID,
      name: form.name.trim(),
      address: form.address.trim() || null,
      city: null,
      profile: { phone: form.phone.trim(), email: form.email.trim() },
    });
    if (error) return alert("Tạo khách sạn trong cơ sở dữ liệu không thành công: " + error.message);
    setHotels((p) => [
      ...p,
      {
        id,
        name: form.name.trim(),
        address: form.address.trim() || "—",
        phone: form.phone.trim(),
        email: form.email.trim(),
        roomsCount: 0,
        typesCount: 0,
        plansCount: 0,
        hasConfig: false,
        amenitiesCount: 0,
        photosCount: 0,
        nearbyCount: 0,
      },
    ]);
    setForm({ name: "", address: "", phone: "", email: "" });
    setShowForm(false);
  }

  const visible = hotels.filter(
    (h) =>
      h.name.toLowerCase().includes(query.toLowerCase()) ||
      h.address.toLowerCase().includes(query.toLowerCase())
  );

  return (
    <div>
      {/* ===== Header ===== */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[#17293e]">Khách sạn</h1>
          <p className="mt-1 text-sm text-[#68707a]">
            Hệ thống quản lí nhiều khách sạn. Bấm vào một khách sạn để quản lí
            hồ sơ, phòng, loại phòng và gói giá của riêng khách sạn đó.
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Tìm khách sạn..."
            className="cb-input-pill px-4 py-2 text-sm"
          />
          <button
            onClick={() => setShowForm((v) => !v)}
            className="cb-btn-primary px-4 py-2 text-sm"
          >
            + Thêm khách sạn
          </button>
        </div>
      </div>

      {loading && <p className="mt-4 text-sm text-[#68707a]">Đang tải dữ liệu từ Supabase...</p>}
      {dbError && <p className="mt-4 rounded-lg bg-[#fdecec] px-3 py-2 text-sm text-[#e5484d]">Lỗi cơ sở dữ liệu: {dbError}</p>}

      {/* ===== Add-hotel form ===== */}
      {showForm && (
        <div className="cb-card mt-5 p-5">
          <h2 className="font-bold text-[#17293e]">Thêm khách sạn mới</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Tên khách sạn, VD: CityHouse Saigon *"
              className="rounded-lg border border-[#dde3ea] px-3 py-2 text-sm outline-none focus:border-[#2563eb]"
            />
            <input
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
              placeholder="Địa chỉ"
              className="rounded-lg border border-[#dde3ea] px-3 py-2 text-sm outline-none focus:border-[#2563eb]"
            />
            <input
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              placeholder="Số điện thoại"
              className="rounded-lg border border-[#dde3ea] px-3 py-2 text-sm outline-none focus:border-[#2563eb]"
            />
            <input
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              placeholder="Email"
              className="rounded-lg border border-[#dde3ea] px-3 py-2 text-sm outline-none focus:border-[#2563eb]"
            />
          </div>
          <div className="mt-4 flex items-center gap-3">
            <button onClick={addHotel} className="cb-btn-primary px-4 py-2 text-sm">
              Tạo khách sạn
            </button>
            <button onClick={() => setShowForm(false)} className="cb-btn-ghost px-4 py-2 text-sm">
              Huỷ
            </button>
            <span className="text-xs text-[#68707a]">
              Khách sạn mới tạo xong sẽ có 0 phòng — bấm vào thẻ của nó để khai báo tiếp.
            </span>
          </div>
        </div>
      )}

      {/* ===== Hotel cards ===== */}
      <div className="mt-5 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {visible.map((h) => {
          const c = completeness(h);
          return (
            <Link
              key={h.id}
              href={`/hotels/${h.id}`}
              className="cb-card block overflow-hidden transition hover:shadow-md"
            >
              {h.coverUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={h.coverUrl} alt={h.coverCaption ?? h.name} className="h-36 w-full object-cover" />
              ) : (
                <div className="flex h-36 w-full items-center justify-center bg-gradient-to-br from-[#e8effe] to-[#dbe7fd] text-4xl">
                  🏨
                </div>
              )}
              <div className="p-5">
                <div className="flex items-start justify-between gap-2">
                  <div className="text-[17px] font-bold leading-snug text-[#17293e]">
                    {h.name}
                  </div>
                  {h.code && (
                    <span className="shrink-0 rounded-md bg-[#f0f3f7] px-2 py-0.5 text-[11px] font-semibold text-[#68707a]">
                      {h.code}
                    </span>
                  )}
                </div>
                <div className="mt-1 flex items-center gap-2 text-sm text-[#68707a]">
                  {h.starRating && (
                    <span className="text-amber-500">
                      {"★".repeat(h.starRating)}
                      <span className="text-[#d4dae1]">{"★".repeat(5 - h.starRating)}</span>
                    </span>
                  )}
                  <span>📍 {h.address}</span>
                </div>

                <div className="mt-4 flex gap-4 text-sm text-[#17293e]">
                  <span><b>{h.roomsCount}</b> phòng</span>
                  <span><b>{h.typesCount}</b> loại phòng</span>
                  <span><b>{h.plansCount}</b> gói giá</span>
                </div>

                {/* Completeness meter */}
                <div className="mt-4 border-t border-[#eef1f5] pt-4">
                  <div className="flex items-center justify-between text-[13px]">
                    <span className="text-[#68707a]">Hoàn thiện hồ sơ</span>
                    <b className="text-[#17293e]">{c.done}/{c.total} · {c.pct}%</b>
                  </div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-[#e6ebf0]">
                    <div
                      className={`h-full rounded-full ${c.pct === 100 ? "bg-[#1db584]" : "bg-[#2563eb]"}`}
                      style={{ width: `${c.pct}%` }}
                    />
                  </div>
                  {c.missing.length > 0 && (
                    <div className="mt-2 text-xs text-[#68707a]">
                      Còn thiếu: {c.missing.join(", ")}
                    </div>
                  )}
                </div>

                <div className="mt-4 text-sm font-semibold text-[#2563eb]">
                  Vào quản lí →
                </div>
              </div>
            </Link>
          );
        })}
        {!loading && visible.length === 0 && (
          <div className="cb-card p-8 text-center text-sm text-[#68707a] md:col-span-2 xl:col-span-3">
            Không tìm thấy khách sạn nào khớp với ô tìm kiếm.
          </div>
        )}
      </div>
    </div>
  );
}
