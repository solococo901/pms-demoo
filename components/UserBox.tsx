"use client";

// ============================================================
// USER BOX — components/UserBox.tsx
// The bottom block of the left menu: who is signed in
// (name + role from user_profiles, email from Auth) and the
// Sign out button.
// ============================================================

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function UserBox() {
  const router = useRouter();
  const [name, setName] = useState("...");
  const [sub, setSub] = useState("");

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      if (!data.user) return;
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
    <div className="flex items-center gap-3 border-t border-[#eef1f5] px-5 py-4">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#17293e] text-sm font-semibold text-white">
        {(name || "?").charAt(0).toUpperCase()}
      </div>
      <div className="min-w-0 flex-1 text-sm">
        <div className="truncate font-medium leading-tight">{name}</div>
        <div className="text-xs leading-tight text-[#68707a]">{sub}</div>
      </div>
      <button
        onClick={signOut}
        title="Đăng xuất"
        className="shrink-0 rounded-lg px-2 py-1 text-xs font-medium text-[#68707a] hover:bg-[#f4f7fb] hover:text-[#e5484d]"
      >
        Thoát
      </button>
    </div>
  );
}
