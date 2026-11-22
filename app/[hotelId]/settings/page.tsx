"use client";
// SETTINGS1 — app/[hotelId]/settings/page.tsx (Cai dat)
// Bo muc Nguoi dung & vai tro cu + cong tac dong bo dem (ca 2 deu khong con dung).
// Chi tuy chon toan he thong: ngon ngu, mui gio, tien te, dinh dang ngay.

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";

const inputCls = "rounded-lg border border-line px-3 py-2 text-sm text-ink outline-none focus:border-primary";

const ACCOUNT_ID = "11111111-1111-1111-1111-111111111111";

export default function SettingsPage() {
  // Trang nay nam duoi /<ten-khach-san>/... nen ma khach san lay tu URL.
  const params = useParams();
  const hotelId = typeof params.hotelId === "string" ? params.hotelId : "";
  const channelsHref = hotelId ? `/${hotelId}/channels` : "/channels";
  const usersHref = hotelId ? `/${hotelId}/settings/users` : "/settings/users";
  const [general, setGeneral] = useState({
    language: "vi",
    timezone: "Asia/Ho_Chi_Minh",
    currency: "VND",
    dateFormat: "dd/MM/yyyy",
  });
  const [savedMsg, setSavedMsg] = useState("");
  const [saveErr, setSaveErr] = useState("");
  const [loadErr, setLoadErr] = useState("");

  // Doc cai dat da luu (bang system_settings, file SQL 17); chua co dong nao thi giu mac dinh.
  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from("system_settings")
        .select("language, timezone, currency, date_format")
        .eq("account_id", ACCOUNT_ID)
        .maybeSingle();
      if (error) {
        setLoadErr("Chưa đọc được cài đặt đã lưu — kiểm tra xem đã chạy file SQL 17 (system_settings) trên Supabase chưa. Lỗi: " + error.message);
        return;
      }
      if (!data) return;
      setGeneral({
        language: data.language,
        timezone: data.timezone,
        currency: data.currency,
        dateFormat: data.date_format,
      });
    })();
  }, []);

  // Ghi THAT vao co so du lieu (upsert theo account_id).
  async function saveSettings(nextGeneral: typeof general) {
    setSavedMsg("");
    setSaveErr("");
    const { error } = await supabase.from("system_settings").upsert({
      account_id: ACCOUNT_ID,
      language: nextGeneral.language,
      timezone: nextGeneral.timezone,
      currency: nextGeneral.currency,
      date_format: nextGeneral.dateFormat,
    });
    if (error) {
      setSaveErr("Lưu không thành công: " + error.message);
      return false;
    }
    return true;
  }

  async function saveGeneral() {
    if (await saveSettings(general)) setSavedMsg("Đã lưu cài đặt.");
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-ink">Cài đặt</h1>
      <p className="mt-1 text-sm text-muted">
        Chỉ những tuỳ chọn áp dụng cho <b className="text-ink">toàn hệ thống</b>. Dữ liệu của từng khách sạn nằm ở mục{" "}
        <Link href="/hotels" className="text-primary hover:underline">Khách sạn</Link>, tài khoản Channex nằm ở mục{" "}
        <Link href={channelsHref} className="text-primary hover:underline">Kênh bán</Link>.
      </p>
      {loadErr && <p className="mt-3 rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning">{loadErr}</p>}

      {/* ===== general system options ===== */}
      <section className="cb-card mt-6 p-5">
        <h2 className="text-base font-bold text-ink">Tuỳ chọn chung</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="text-sm text-ink">
            Ngôn ngữ giao diện
            <select value={general.language} onChange={(e) => setGeneral({ ...general, language: e.target.value })} className={`${inputCls} mt-1 w-full`}>
              <option value="vi">Tiếng Việt</option>
              <option value="en" disabled>English (có ở vòng i18n)</option>
            </select>
          </label>
          <label className="text-sm text-ink">
            Múi giờ hệ thống
            <select value={general.timezone} onChange={(e) => setGeneral({ ...general, timezone: e.target.value })} className={`${inputCls} mt-1 w-full`}>
              <option value="Asia/Ho_Chi_Minh">Việt Nam (UTC+7)</option>
              <option value="Asia/Bangkok">Bangkok (UTC+7)</option>
              <option value="Asia/Singapore">Singapore (UTC+8)</option>
            </select>
          </label>
          <label className="text-sm text-ink">
            Tiền tệ mặc định
            <select value={general.currency} onChange={(e) => setGeneral({ ...general, currency: e.target.value })} className={`${inputCls} mt-1 w-full`}>
              <option value="VND">VND — Việt Nam đồng</option>
              <option value="USD">USD — Đô la Mỹ</option>
            </select>
          </label>
          <label className="text-sm text-ink">
            Định dạng ngày
            <select value={general.dateFormat} onChange={(e) => setGeneral({ ...general, dateFormat: e.target.value })} className={`${inputCls} mt-1 w-full`}>
              <option value="dd/MM/yyyy">Ngày/Tháng/Năm (21/10/2026)</option>
              <option value="MM/dd/yyyy">Tháng/Ngày/Năm (10/21/2026)</option>
            </select>
          </label>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <button
            onClick={saveGeneral}
            className="cb-btn-primary px-4 py-2 text-sm"
          >
            Lưu cài đặt
          </button>
          {savedMsg && <span className="text-sm text-success">{savedMsg}</span>}
          {saveErr && <span className="text-sm text-danger">{saveErr}</span>}
        </div>
      </section>

      {/* ===== nguoi dung & vai tro: quan ly o trang rieng ===== */}
      <section className="cb-card mt-6 flex flex-wrap items-center justify-between gap-3 p-5">
        <div>
          <h2 className="text-base font-bold text-ink">Người dùng & vai trò</h2>
          <p className="mt-0.5 text-sm text-muted">Tạo tài khoản, gán vai trò, khóa/mở khóa và đặt lại mật khẩu cho nhân viên.</p>
        </div>
        <Link href={usersHref} className="cb-btn-primary shrink-0 px-4 py-2 text-sm">
          Mở trang Người dùng →
        </Link>
      </section>
    </div>
  );
}
