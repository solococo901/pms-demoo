"use client";

// ============================================================
// app/page.tsx — TRANG DANH SACH KHACH SAN (trang / , trang dau
// tien sau khi dang nhap, kieu ezCloud "He thong dat phong tap
// trung"): bang STT / Ten / Ma / Dia chi / Trang thai / Thao tac.
// "Truy cap" chon khach san do lam khach san hien tai roi ve
// dashboard (/) cua khach san do. Them khach san moi + link
// Quan li ho so chi hien voi admin; nhan vien chi thay bang +
// nut Truy cap.
// THEME1c (2026-11-10): doi mau sang tone cityhousemore.com
// (nen kem, chu navy, nut dong) — mau chu/vien doc tu bien
// --cb-* trong globals.css; xanh la trang thai giu nguyen.
// ============================================================

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { HOTEL_STORAGE_KEY } from "@/lib/current-hotel";
import { useCurrentRole } from "@/lib/current-role";

const ACCOUNT_ID = "11111111-1111-1111-1111-111111111111";

type HotelRow = {
  id: string;
  code?: string;
  name: string;
  address: string;
};

export default function HotelsPage() {
  const role = useCurrentRole();
  const router = useRouter();
  const [hotels, setHotels] = useState<HotelRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [dbError, setDbError] = useState("");
  const [query, setQuery] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: "", address: "", phone: "", email: "" });

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from("hotels")
        .select("id, code, name, address")
        .eq("account_id", ACCOUNT_ID)
        .order("name");
      if (error) {
        setDbError(error.message);
        setLoading(false);
        return;
      }
      setHotels(
        (data ?? []).map((row) => ({
          id: row.id,
          code: row.code ?? undefined,
          name: row.name,
          address: row.address ?? "",
        }))
      );
      setLoading(false);
    })();
  }, []);

  // Dang xuat tu trang dung doc lap (trang nay khong co khung app
  // nen khong co nut Thoat cua sidebar).
  async function signOut() {
    await supabase.auth.signOut();
    router.replace("/login");
  }
  // Vao lam viec o khach san nay: luu lua chon roi nap lai toan bo
  // app (giong o chon khach san tren thanh tren) de moi trang deu
  // nhan khach san moi, ke ca cac module doc khach san luc nap.
  // Luu theo tab (sessionStorage): moi tab giu khach san rieng, mo
  // song song nhieu khach san duoc.
  function enterHotel(id: string) {
    window.sessionStorage.setItem(HOTEL_STORAGE_KEY, id);
    window.location.href = `/${id}/dashboard`;
  }

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
      { id, name: form.name.trim(), address: form.address.trim() || "—" },
    ]);
    setForm({ name: "", address: "", phone: "", email: "" });
    setShowForm(false);
  }

  const q = query.trim().toLowerCase();
  const visible = hotels.filter(
    (h) =>
      h.name.toLowerCase().includes(q) ||
      (h.code ?? "").toLowerCase().includes(q) ||
      h.address.toLowerCase().includes(q)
  );

  return (
    <div>
      {/* ===== Top row rieng cua trang dung doc lap: logo + thoat ===== */}
      <div className="mb-5 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#B9887B] text-base font-bold text-[#F4EFEA]">
            P
          </div>
          <div>
            <div className="text-[15px] font-bold leading-tight text-[var(--cb-text)]">PMS Hotel</div>
            <div className="text-[11px] leading-tight text-[var(--cb-muted)]">Hệ thống quản lí khách sạn</div>
          </div>
        </div>
        <button
          onClick={signOut}
          className="rounded-lg px-3 py-1.5 text-sm font-medium text-[var(--cb-muted)] hover:bg-white hover:text-[#e5484d]"
        >
          Thoát
        </button>
      </div>

      {/* ===== Header ===== */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[var(--cb-text)]">Khách sạn</h1>
          <p className="mt-1 text-sm text-[var(--cb-muted)]">
            Danh sách khách sạn trong hệ thống. Bấm Truy cập để vào dashboard
            của khách sạn đó.
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Nhập thông tin mã hoặc tên khách sạn"
            className="cb-input-pill px-4 py-2 text-sm"
          />
          {role === "admin" && (
            <button
              onClick={() => setShowForm((v) => !v)}
              className="cb-btn-primary px-4 py-2 text-sm"
            >
              + Thêm khách sạn
            </button>
          )}
        </div>
      </div>

      {loading && <p className="mt-4 text-sm text-[var(--cb-muted)]">Đang tải dữ liệu từ Supabase...</p>}
      {dbError && <p className="mt-4 rounded-lg bg-[#fdecec] px-3 py-2 text-sm text-[#e5484d]">Lỗi cơ sở dữ liệu: {dbError}</p>}

      {/* ===== Add-hotel form (admin only) ===== */}
      {showForm && role === "admin" && (
        <div className="cb-card mt-5 p-5">
          <h2 className="font-bold text-[var(--cb-text)]">Thêm khách sạn mới</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Tên khách sạn, VD: CityHouse Saigon *"
              className="rounded-lg border border-[var(--cb-border)] px-3 py-2 text-sm outline-none focus:border-[var(--cb-blue)]"
            />
            <input
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
              placeholder="Địa chỉ"
              className="rounded-lg border border-[var(--cb-border)] px-3 py-2 text-sm outline-none focus:border-[var(--cb-blue)]"
            />
            <input
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              placeholder="Số điện thoại"
              className="rounded-lg border border-[var(--cb-border)] px-3 py-2 text-sm outline-none focus:border-[var(--cb-blue)]"
            />
            <input
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              placeholder="Email"
              className="rounded-lg border border-[var(--cb-border)] px-3 py-2 text-sm outline-none focus:border-[var(--cb-blue)]"
            />
          </div>
          <div className="mt-4 flex items-center gap-3">
            <button onClick={addHotel} className="cb-btn-primary px-4 py-2 text-sm">
              Tạo khách sạn
            </button>
            <button onClick={() => setShowForm(false)} className="cb-btn-ghost px-4 py-2 text-sm">
              Huỷ
            </button>
            <span className="text-xs text-[var(--cb-muted)]">
              Khách sạn mới tạo xong sẽ có 0 phòng — bấm Quản lí để khai báo tiếp.
            </span>
          </div>
        </div>
      )}

      {/* ===== Hotel table (ezCloud style) ===== */}
      <div className="cb-card mt-5 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--cb-border)] text-left text-xs uppercase tracking-wide text-[var(--cb-muted)]">
              <th className="px-4 py-3 font-semibold">STT</th>
              <th className="px-4 py-3 font-semibold">Tên khách sạn</th>
              <th className="px-4 py-3 font-semibold">Mã khách sạn</th>
              <th className="px-4 py-3 font-semibold">Địa chỉ</th>
              <th className="px-4 py-3 font-semibold">Trạng thái</th>
              <th className="px-4 py-3 text-right font-semibold">Thao tác</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((h, i) => (
              <tr key={h.id} className="border-b border-[var(--cb-border)] last:border-b-0">
                <td className="px-4 py-3 text-[var(--cb-muted)]">{i + 1}</td>
                <td className="px-4 py-3 font-semibold text-[var(--cb-text)]">{h.name}</td>
                <td className="px-4 py-3 text-[var(--cb-text)]">{h.code ?? "—"}</td>
                <td className="px-4 py-3 text-[var(--cb-muted)]">{h.address || "—"}</td>
                <td className="px-4 py-3">
                  <span className="flex items-center gap-1.5 font-medium text-[#1db584]">
                    <span className="h-2 w-2 rounded-full bg-[#1db584]" />
                    Đang hoạt động
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    onClick={() => enterHotel(h.id)}
                    className="font-semibold text-[var(--cb-blue)] hover:underline"
                  >
                    Truy cập ↗
                  </button>
                  {role === "admin" && (
                    <Link
                      href={`/hotels/${h.id}`}
                      className="ml-4 font-medium text-[var(--cb-muted)] hover:underline"
                    >
                      Quản lí
                    </Link>
                  )}
                </td>
              </tr>
            ))}
            {!loading && visible.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-[var(--cb-muted)]">
                  Không tìm thấy khách sạn nào khớp với ô tìm kiếm.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <div className="border-t border-[var(--cb-border)] px-4 py-3 text-right text-sm text-[var(--cb-muted)]">
          Tổng: {visible.length} khách sạn
        </div>
      </div>
    </div>
  );
}
