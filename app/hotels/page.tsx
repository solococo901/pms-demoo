"use client";

// NATEUI26 — app/hotels/page.tsx (trang danh sach khach san)
// Bang STT / Ten / Ma / Dia chi / Trang thai / Thao tac; "Truy cap" chon khach san do roi ve dashboard cua no; them khach san moi + Quan li ho so chi hien voi admin.
// Doi sang token toi gian 2026-11-21.

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
  const [form, setForm] = useState({ name: "", code: "", address: "", phone: "", email: "" });

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

  // Dang xuat tu trang dung doc lap (trang nay khong co khung app nen khong co nut Thoat cua sidebar).
  async function signOut() {
    await supabase.auth.signOut();
    router.replace("/login");
  }
  // Vao lam viec o khach san nay: luu lua chon roi nap lai toan bo app de moi trang deu nhan khach san moi.
  // Luu theo tab (sessionStorage): moi tab giu khach san rieng, mo song song nhieu khach san duoc.
  function enterHotel(id: string) {
    window.sessionStorage.setItem(HOTEL_STORAGE_KEY, id);
    window.location.href = `/${id}/dashboard`;
  }

  async function addHotel() {
    if (!form.name.trim()) return alert("Chưa nhập tên khách sạn.");
    const id = form.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    if (!id) return alert("Tên khách sạn cần có ít nhất một chữ cái hoặc số.");
    if (hotels.some((h) => h.id === id)) return alert("Khách sạn này đã có trong danh sách.");
    // Ma khach san: tu chon, khong bat buoc — de trong thi nhap sau o trang Thong tin chung; chi dung de hien thi + tim kiem, khong anh huong noi Channex.
    const code = form.code.trim().toUpperCase();
    if (code && hotels.some((h) => (h.code ?? "").toUpperCase() === code))
      return alert("Mã này đã dùng cho khách sạn khác.");
    const { error } = await supabase.from("hotels").insert({
      id,
      account_id: ACCOUNT_ID,
      code: code || null,
      name: form.name.trim(),
      address: form.address.trim() || null,
      city: null,
      profile: { phone: form.phone.trim(), email: form.email.trim() },
    });
    if (error) return alert("Tạo khách sạn trong cơ sở dữ liệu không thành công: " + error.message);
    setHotels((p) => [
      ...p,
      { id, code: code || undefined, name: form.name.trim(), address: form.address.trim() || "—" },
    ]);
    setForm({ name: "", code: "", address: "", phone: "", email: "" });
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
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-base font-bold text-white">
            P
          </div>
          <div>
            <div className="text-[15px] font-bold leading-tight text-ink">PMS Hotel</div>
            <div className="text-[11px] leading-tight text-muted">Hệ thống quản lí khách sạn</div>
          </div>
        </div>
        <button
          onClick={signOut}
          className="rounded-lg px-3 py-1.5 text-sm font-medium text-muted hover:bg-surface hover:text-danger"
        >
          Thoát
        </button>
      </div>

      {/* ===== Header ===== */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ink">Khách sạn</h1>
          <p className="mt-1 text-sm text-muted">
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

      {loading && <p className="mt-4 text-sm text-muted">Đang tải dữ liệu từ Supabase...</p>}
      {dbError && <p className="mt-4 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">Lỗi cơ sở dữ liệu: {dbError}</p>}

      {/* ===== Add-hotel form (admin only) ===== */}
      {showForm && role === "admin" && (
        <div className="cb-card mt-5 p-5">
          <h2 className="font-bold text-ink">Thêm khách sạn mới</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Tên khách sạn, VD: CityHouse Saigon *"
              className="rounded-lg border border-line px-3 py-2 text-sm outline-none focus:border-primary"
            />
            <input
              value={form.code}
              onChange={(e) => setForm({ ...form, code: e.target.value })}
              placeholder="Mã khách sạn, VD: DEMO (không bắt buộc)"
              className="rounded-lg border border-line px-3 py-2 text-sm uppercase outline-none focus:border-primary"
            />
            <input
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
              placeholder="Địa chỉ"
              className="rounded-lg border border-line px-3 py-2 text-sm outline-none focus:border-primary"
            />
            <input
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              placeholder="Số điện thoại"
              className="rounded-lg border border-line px-3 py-2 text-sm outline-none focus:border-primary"
            />
            <input
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              placeholder="Email"
              className="rounded-lg border border-line px-3 py-2 text-sm outline-none focus:border-primary"
            />
          </div>
          <div className="mt-4 flex items-center gap-3">
            <button onClick={addHotel} className="cb-btn-primary px-4 py-2 text-sm">
              Tạo khách sạn
            </button>
            <button onClick={() => setShowForm(false)} className="cb-btn-ghost px-4 py-2 text-sm">
              Huỷ
            </button>
            <span className="text-xs text-muted">
              Khách sạn mới tạo xong sẽ có 0 phòng — bấm Quản lí để khai báo tiếp.
            </span>
          </div>
        </div>
      )}

      {/* ===== Hotel table (ezCloud style) ===== */}
      <div className="cb-card mt-5 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
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
              <tr key={h.id} className="border-b border-line last:border-b-0">
                <td className="px-4 py-3 text-muted">{i + 1}</td>
                <td className="px-4 py-3 font-semibold text-ink">{h.name}</td>
                <td className="px-4 py-3 text-ink">{h.code ?? "—"}</td>
                <td className="px-4 py-3 text-muted">{h.address || "—"}</td>
                <td className="px-4 py-3">
                  <span className="flex items-center gap-1.5 font-medium text-success">
                    <span className="h-2 w-2 rounded-full bg-success" />
                    Đang hoạt động
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    onClick={() => enterHotel(h.id)}
                    className="font-semibold text-primary hover:underline"
                  >
                    Truy cập ↗
                  </button>
                  {role === "admin" && (
                    <Link
                      href={`/hotels/${h.id}`}
                      className="ml-4 font-medium text-muted hover:underline"
                    >
                      Quản lí
                    </Link>
                  )}
                </td>
              </tr>
            ))}
            {!loading && visible.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted">
                  Không tìm thấy khách sạn nào khớp với ô tìm kiếm.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <div className="border-t border-line px-4 py-3 text-right text-sm text-muted">
          Tổng: {visible.length} khách sạn
        </div>
      </div>
    </div>
  );
}
