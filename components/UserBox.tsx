"use client";

// ============================================================
// USER BOX — components/UserBox.tsx
// Top-bar user menu (Cloudbeds shell, CBLAYOUT1 2026-11-17):
// avatar + name on the white top bar; click opens a small
// dropdown (name, email, role, Sign out). Before this it was
// the bottom block of the navy sidebar (THEME1d: white text
// on navy) — that sidebar is gone, so this is restyled for
// the white top bar.
// Data: name + role from user_profiles, email from Auth.
// ============================================================

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function UserBox() {
  const router = useRouter();
  const [name, setName] = useState("...");
  const [sub, setSub] = useState("");
  const [email, setEmail] = useState("");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      if (!data.user) return;
      setEmail(data.user.email ?? "");
      const { data: profile } = await supabase
        .from("user_profiles")
        .select("display_name, role")
        .eq("user_id", data.user.id)
        .single();
      if (profile) {
        setName(profile.display_name ?? data.user.email ?? "Người dùng");
        setSub(profile.role === "admin" ? "Quản trị viên" : "Nhân viên");
      } else {
        setName(data.user.email ?? "Người dùng");
        setSub("Chưa gắn hồ sơ");
      }
    })();
  }, []);

  async function signOut() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  return (
    <div className="relative shrink-0">
      <button
        onClick={() => setOpen((v) => !v)}
        title={name}
        aria-label="Tài khoản"
        aria-expanded={open}
        className="flex items-center gap-2 rounded-lg px-1 py-1 hover:bg-[#f5f7fb]"
      >
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--cb-blue)] text-sm font-semibold text-white">
          {(name || "?").charAt(0).toUpperCase()}
        </div>
        <div className="hidden min-w-0 text-left text-sm lg:block">
          <div className="max-w-[8rem] truncate font-medium leading-tight text-[var(--cb-text)]">{name}</div>
          <div className="text-xs leading-tight text-[var(--cb-muted)]">{sub}</div>
        </div>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-50 mt-2 w-60 rounded-xl border border-[var(--cb-border)] bg-white p-4 shadow-lg">
            <div className="truncate text-sm font-semibold text-[var(--cb-text)]">{name}</div>
            <div className="truncate text-xs text-[var(--cb-muted)]">{email}</div>
            <div className="mt-1 text-xs text-[var(--cb-muted)]">{sub}</div>
            <button onClick={signOut} className="cb-btn-ghost mt-3 w-full px-3 py-2 text-sm">
              Đăng xuất
            </button>
          </div>
        </>
      )}
    </div>
  );
}
