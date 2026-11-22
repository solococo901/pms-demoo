"use client";

// NATEUI27 — app/login/page.tsx (trang dang nhap, theo mau CityHouse cua Vos)
// Mau thuong hieu GIU NGUYEN (nen be #f7f3ed, nut navy #1b2a4a, vien am #e5ddd3) — chi mau chu ve token (nhin y het).
// Nhan o dau ghi "Email hoac ten dang nhap" nhung dang nhap van chi bang email.
// Doi sang token toi gian 2026-11-21.

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
      <div className="w-full max-w-md rounded-[24px] bg-surface p-8 shadow-[0_20px_50px_rgba(27,42,74,0.12)] sm:p-10">
        <img
          src="/cityhouse-logo.png"
          alt="CityHouse — PMS · Property Management System"
          className="mx-auto w-full max-w-[320px]"
        />

        <form onSubmit={submit} className="mt-8">
          <label className="block text-sm font-medium text-ink">
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
            className="mt-2 w-full rounded-xl border border-[#e5ddd3] px-4 py-3 text-[15px] text-ink outline-none placeholder:text-subtle focus:border-[#1b2a4a]"
          />

          <label className="mt-5 block text-sm font-medium text-ink">
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
              className="w-full rounded-xl border border-[#e5ddd3] px-4 py-3 pr-12 text-[15px] text-ink outline-none placeholder:text-subtle focus:border-[#1b2a4a]"
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              title={showPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-subtle hover:text-ink"
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
            <p className="mt-3 rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="mt-5 w-full rounded-xl bg-[#1b2a4a] px-4 py-3.5 text-[15px] font-bold text-white hover:bg-[#16233d] disabled:opacity-60"
          >
            {busy ? "Đang đăng nhập..." : "Đăng nhập"}
          </button>
        </form>

        <p className="mt-6 text-center text-xs text-subtle">© 2026 CityHouse</p>
      </div>
    </div>
  );
}
