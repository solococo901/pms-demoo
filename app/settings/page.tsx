"use client";
// ============================================================
// FILE 11 — app/settings/page.tsx (Cloudbeds style)
// SYSTEM-WIDE settings only (restructured 2026-10-22).
//
// The product manages many hotels, so hotel data does NOT
// live here anymore:
//   - Hotels list + add hotel      -> /hotels
//   - One hotel's profile, room
//     types, rooms, rate plans     -> /hotels/[id]
//   - Channex account + channels   -> /channels
// What stays here: options that apply to the WHOLE system —
// language, timezone, currency, date format — plus a preview
// of user roles (real login + permission enforcement is
// Round B work).
// Logic unchanged from the first version — colors only.
// ============================================================

import { useState } from "react";
import Link from "next/link";

const inputCls = "rounded-lg border border-[#dde3ea] px-3 py-2 text-sm text-[#17293e] outline-none focus:border-[#2563eb]";

const ROLES = [
  {
    name: "Quản trị viên (Admin)",
    desc: "Toàn quyền: mọi khách sạn, giá theo kênh, kênh bán, cài đặt hệ thống.",
  },
  {
    name: "Lễ tân (Staff)",
    desc: "Chỉ khách sạn được phân công: lịch phòng, đặt phòng, check-in/out. Không thấy giá kênh, không vào được Cài đặt.",
  },
  {
    name: "Buồng phòng (Housekeeping)",
    desc: "Chỉ xem trạng thái phòng và cập nhật dọn phòng của khách sạn được phân công.",
  },
];

export default function SettingsPage() {
  const [general, setGeneral] = useState({
    language: "vi",
    timezone: "Asia/Ho_Chi_Minh",
    currency: "VND",
    dateFormat: "dd/MM/yyyy",
  });
  const [nightlySync, setNightlySync] = useState(true);
  const [savedMsg, setSavedMsg] = useState("");

  return (
    <div>
      <h1 className="text-2xl font-bold text-[#17293e]">Cài đặt hệ thống</h1>
      <p className="mt-1 text-sm text-[#68707a]">
        Chỉ những tuỳ chọn áp dụng cho <b className="text-[#17293e]">toàn hệ thống</b>. Dữ liệu của từng khách sạn nằm ở mục{" "}
        <Link href="/hotels" className="text-[#2563eb] hover:underline">Khách sạn</Link>, tài khoản Channex nằm ở mục{" "}
        <Link href="/channels" className="text-[#2563eb] hover:underline">Kênh bán</Link>.
      </p>

      {/* ===== general system options ===== */}
      <section className="cb-card mt-6 p-5">
        <h2 className="text-base font-bold text-[#17293e]">Tuỳ chọn chung</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="text-sm text-[#17293e]">
            Ngôn ngữ giao diện
            <select value={general.language} onChange={(e) => setGeneral({ ...general, language: e.target.value })} className={`${inputCls} mt-1 w-full`}>
              <option value="vi">Tiếng Việt</option>
              <option value="en" disabled>English (có ở vòng i18n)</option>
            </select>
          </label>
          <label className="text-sm text-[#17293e]">
            Múi giờ hệ thống
            <select value={general.timezone} onChange={(e) => setGeneral({ ...general, timezone: e.target.value })} className={`${inputCls} mt-1 w-full`}>
              <option value="Asia/Ho_Chi_Minh">Việt Nam (UTC+7)</option>
              <option value="Asia/Bangkok">Bangkok (UTC+7)</option>
              <option value="Asia/Singapore">Singapore (UTC+8)</option>
            </select>
          </label>
          <label className="text-sm text-[#17293e]">
            Tiền tệ mặc định
            <select value={general.currency} onChange={(e) => setGeneral({ ...general, currency: e.target.value })} className={`${inputCls} mt-1 w-full`}>
              <option value="VND">VND — Việt Nam đồng</option>
              <option value="USD">USD — Đô la Mỹ</option>
            </select>
          </label>
          <label className="text-sm text-[#17293e]">
            Định dạng ngày
            <select value={general.dateFormat} onChange={(e) => setGeneral({ ...general, dateFormat: e.target.value })} className={`${inputCls} mt-1 w-full`}>
              <option value="dd/MM/yyyy">Ngày/Tháng/Năm (21/10/2026)</option>
              <option value="MM/dd/yyyy">Tháng/Ngày/Năm (10/21/2026)</option>
            </select>
          </label>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <button
            onClick={() => setSavedMsg("Đã lưu (mô phỏng — Vòng B mới ghi vào cơ sở dữ liệu).")}
            className="cb-btn-primary px-4 py-2 text-sm"
          >
            Lưu cài đặt
          </button>
          {savedMsg && <span className="text-sm text-[#0e7a56]">{savedMsg}</span>}
        </div>
      </section>

      {/* ===== sync behaviour ===== */}
      <section className="cb-card mt-6 p-5">
        <h2 className="text-base font-bold text-[#17293e]">Đồng bộ dữ liệu</h2>
        <div className="mt-3 flex items-center justify-between gap-4">
          <div className="text-sm text-[#17293e]">
            <b>Đồng bộ toàn bộ mỗi đêm với Channex</b>
            <p className="mt-0.5 text-[#68707a]">
              Mỗi đêm hệ thống đối chiếu lại toàn bộ giá và quỹ phòng của mọi khách sạn với Channex, để sửa mọi lệch lạc tích tụ trong ngày.
              Áp dụng cho tất cả khách sạn trong hệ thống.
            </p>
          </div>
          <button
            onClick={() => setNightlySync((v) => !v)}
            className={`h-6 w-11 shrink-0 rounded-full p-0.5 transition ${nightlySync ? "bg-[#1db584]" : "bg-[#ccd5df]"}`}
            title="Bật/tắt đồng bộ đêm"
          >
            <span className={`block h-5 w-5 rounded-full bg-white transition ${nightlySync ? "translate-x-5" : ""}`} />
          </button>
        </div>
      </section>

      {/* ===== roles preview ===== */}
      <section className="cb-card mt-6 p-5">
        <h2 className="text-base font-bold text-[#17293e]">Người dùng & vai trò</h2>
        <p className="mt-0.5 text-sm text-[#68707a]">
          Ai được xem gì trong hệ thống. Đăng nhập thật và chặn quyền theo vai trò làm ở Vòng B — ở vòng này đây là bản xem trước.
        </p>
        <div className="mt-4 space-y-3">
          {ROLES.map((r) => (
            <div key={r.name} className="rounded-lg border border-[#eef1f5] px-4 py-3">
              <div className="text-sm font-semibold text-[#17293e]">{r.name}</div>
              <div className="mt-0.5 text-sm text-[#68707a]">{r.desc}</div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
