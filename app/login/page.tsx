"use client";

// ============================================================
// FILE LOGIN4b — app/login/page.tsx (CityHouse brand style)
// Trang dang nhap theo dung mau Vos gui 2026-11-04: nen be,
// the trang bo goc lon, logo CityHouse tren cung, nut navy
// dam. LOGIN4b (2026-11-05): bo o "Ghi nho dang nhap" va
// link "Quen mat khau?" theo yeu cau cua Vos — form chi
// con 2 o nhap + nut Dang nhap.
// Màu lay mau truc tiep tu anh mau: nen #f7f3ed, nut
// #1b2a4a, nau dat #b67a63, logo nen trang.
// Chuc nang GIU NGUYEN nhu LOGIN3: email + mat khau qua
// Supabase Auth, loi bao chung chung, xong ve "/".
// Luu y:
//  - Nhan o dau ghi "Email hoac ten dang nhap" theo mau,
//    nhung dang nhap van chi bang email (ban cu khong co
//    ten dang nhap rieng; muon them thi can cot ten dang
//    nhap trong ho so, de sau).
//  - Ban LOGIN4b da bo o tich "Ghi nho dang nhap" va link
//    "Quen mat khau?" — form chi con 2 o nhap + nut Dang
//    nhap (Supabase van nho phien sau F5 nhu truoc).
// ============================================================

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (error) {
      setError("Đăng nhập không thành công — kiểm tra lại email và mật khẩu.");
      setBusy(false);
      return;
    }
    router.replace("/");
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f7f3ed] p-4">
      <div className="w-full max-w-md rounded-[24px] bg-white p-8 shadow-[0_20px_50px_rgba(27,42,74,0.12)] sm:p-10">
        <img
          src="/cityhouse-logo.png"
          alt="CityHouse — PMS · Property Management System"
          className="mx-auto w-full max-w-[320px]"
        />

        <form onSubmit={submit} className="mt-8">
          <label className="block text-sm font-medium text-[#334155]">
            Email hoặc tên đăng nhập
          </label>
          <input
            type="text"
            inputMode="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="vd: letan@cityhouse.vn"
            className="mt-2 w-full rounded-xl border border-[#e5ddd3] px-4 py-3 text-[15px] text-[#1f2937] outline-none placeholder:text-[#9aa7b4] focus:border-[#1b2a4a]"
          />

          <label className="mt-5 block text-sm font-medium text-[#334155]">
            Mật khẩu
          </label>
          <div className="relative mt-2">
            <input
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Nhập mật khẩu"
              className="w-full rounded-xl border border-[#e5ddd3] px-4 py-3 pr-12 text-[15px] text-[#1f2937] outline-none placeholder:text-[#9aa7b4] focus:border-[#1b2a4a]"
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              title={showPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[#9aa7b4] hover:text-[#334155]"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                {showPassword ? (
                  <>
                    <path d="M2 2l20 20" />
                    <path d="M10.6 5.2A10.5 10.5 0 0 1 12 5c7 0 10 7 10 7a13.6 13.6 0 0 1-1.9 2.8" />
                    <path d="M6.6 6.6A13.9 13.9 0 0 0 2 12s3 7 10 7a9.7 9.7 0 0 0 5.4-1.6" />
                    <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
                  </>
                ) : (
                  <>
                    <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z" />
                    <circle cx="12" cy="12" r="3" />
                  </>
                )}
              </svg>
            </button>
          </div>

          {error && (
            <p className="mt-3 rounded-xl bg-[#fdecec] px-3 py-2 text-sm text-[#e5484d]">{error}</p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="mt-5 w-full rounded-xl bg-[#1b2a4a] px-4 py-3.5 text-[15px] font-bold text-white hover:bg-[#16233d] disabled:opacity-60"
          >
            {busy ? "Đang đăng nhập..." : "Đăng nhập"}
          </button>
        </form>

        <p className="mt-6 text-center text-xs text-[#9aa7b4]">© 2026 CityHouse</p>
      </div>
    </div>
  );
}
