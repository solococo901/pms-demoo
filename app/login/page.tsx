"use client";

// ============================================================
// TRANG DANG NHAP — app/login/page.tsx
// Staff sign in with email + password (Supabase Auth).
// On success the session is kept by supabase-js (survives F5)
// and the app shell lets the user through (see AuthGate).
// ============================================================

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
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
    <div className="flex min-h-screen items-center justify-center bg-[#eef1f5] p-4">
      <form onSubmit={submit} className="cb-card w-full max-w-sm p-6">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#2563eb] text-base font-bold text-white">
            P
          </div>
          <div>
            <div className="text-[15px] font-bold leading-tight text-[#17293e]">PMS Hotel</div>
            <div className="text-[11px] leading-tight text-[#68707a]">Quản lí khách sạn</div>
          </div>
        </div>

        <h1 className="mt-5 text-lg font-bold text-[#17293e]">Đăng nhập</h1>
        <p className="mt-1 text-sm text-[#68707a]">
          Dùng email và mật khẩu nhân viên của bạn.
        </p>

        <label className="mt-4 block text-xs font-medium text-[#68707a]">Email</label>
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="vos@cityhouse.example"
          className="mt-1 w-full rounded-lg border border-[#dde3ea] px-3 py-2 text-sm outline-none focus:border-[#2563eb]"
        />

        <label className="mt-3 block text-xs font-medium text-[#68707a]">Mật khẩu</label>
        <input
          type="password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••"
          className="mt-1 w-full rounded-lg border border-[#dde3ea] px-3 py-2 text-sm outline-none focus:border-[#2563eb]"
        />

        {error && (
          <p className="mt-3 rounded-lg bg-[#fdecec] px-3 py-2 text-sm text-[#e5484d]">{error}</p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="cb-btn-primary mt-5 w-full px-4 py-2.5 text-sm disabled:opacity-60"
        >
          {busy ? "Đang đăng nhập..." : "Đăng nhập"}
        </button>
      </form>
    </div>
  );
}
