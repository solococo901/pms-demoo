"use client";

// ============================================================
// FILE HOTELPHOTOS2 — app/[hotelId]/hotel-photos/page.tsx
// Trang THU VIEN ANH rieng biet (buoc 2 trong luong thiet lap
// khach san moi): truoc day chi la vo boc 8 dong mo component
// HotelDetailPage (1.088 dong) dung muc con "Hinh anh".
// Trang nay TU CHUA moi thu: nap anh tu profile.photos cua
// khach san, them bang link, sua chu thich, dat anh bia, xoa,
// luu that vao DB. Khong dung HotelDetailPage nua — sau khi
// dan file nay, khong con cho nao import HotelDetailPage nua.
// ============================================================

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { currentHotelId } from "@/lib/current-hotel";
import type { HotelPhoto } from "@/lib/mock-data";

const inputCls =
  "w-full rounded-lg border border-[#dde3ea] bg-white px-3 py-2 text-sm outline-none focus:border-[#2563eb]";
const rowInputCls =
  "rounded-lg border border-[#dde3ea] bg-white px-3 py-2 text-sm outline-none focus:border-[#2563eb]";

export default function HotelPhotosPage() {
  const params = useParams();
  const id = typeof params.hotelId === "string" ? params.hotelId : currentHotelId();

  const [hotelName, setHotelName] = useState("Đang tải...");
  const [hotelCode, setHotelCode] = useState<string | undefined>(undefined);
  // Giu nguyen toan bo profile goc — khi luu chi thay photos, cac
  // phan khac (thong tin, tien ich, dia diem...) khong bi mat.
  const [profile, setProfile] = useState<Record<string, any> | null>(null);
  const [photos, setPhotos] = useState<HotelPhoto[]>([]);
  const [newPhotoUrl, setNewPhotoUrl] = useState("");
  const [newPhotoCaption, setNewPhotoCaption] = useState("");
  const [savedMsg, setSavedMsg] = useState("");
  const [loading, setLoading] = useState(true);
  const [dbError, setDbError] = useState("");
  const loadedRef = useRef(false);

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
      setHotelName(row.name);
      setHotelCode(row.code ?? undefined);
      const p = (row.profile ?? {}) as Record<string, any>;
      setProfile(p);
      setPhotos(p.photos ?? []);
      setLoading(false);
    })();
  }, [id]);

  // ----- SAVE: chi thay photos trong profile, giu nguyen phan con lai -----
  const save = async () => {
    if (!loadedRef.current) return;
    const { error } = await supabase.from("hotels").update({
      profile: { ...(profile ?? {}), photos },
    }).eq("id", id);
    setSavedMsg(error ? "Lỗi khi lưu: " + error.message : "✓ Đã lưu vào cơ sở dữ liệu.");
  };

  return (
    <div>
      <Link href="/" className="text-sm font-medium text-[#2563eb] hover:underline">
        ← Tất cả khách sạn
      </Link>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold text-[#17293e]">{hotelName}</h1>
        {hotelCode && (
          <span className="rounded-md bg-[#f0f3f7] px-2 py-0.5 text-xs font-semibold text-[#68707a]">{hotelCode}</span>
        )}
      </div>
      <p className="mt-1 text-sm text-[#68707a]">
        Thư viện ảnh của khách sạn này — ảnh đầu tiên là ảnh bìa, hiện ở trang đặt phòng.
        Đang có <b className="text-[#17293e]">{photos.length}</b> ảnh.
      </p>
      {loading && <p className="mt-3 text-sm text-[#68707a]">Đang tải dữ liệu từ Supabase...</p>}
      {dbError && <p className="mt-3 rounded-lg bg-[#fdecec] px-3 py-2 text-sm text-[#e5484d]">Lỗi cơ sở dữ liệu: {dbError}</p>}

      <div className="cb-card mt-5 p-5">
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

        <div className="mt-5 flex items-center gap-3 border-t border-[#eef1f5] pt-4">
          <button onClick={save} className="cb-btn-primary px-5 py-2 text-sm">
            Lưu
          </button>
          {savedMsg && <span className="text-sm text-[#1db584]">{savedMsg}</span>}
        </div>
      </div>
    </div>
  );
}
