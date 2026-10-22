"use client";

// ============================================================
// AUTH GATE — components/AuthGate.tsx
// The bouncer of the app shell. It always renders the app
// underneath (Next.js 16's instant-navigation validation
// drops segments that are not rendered), but covers the
// screen with a solid layer until a Supabase Auth session
// is confirmed. Without a session it redirects to /login.
// NOTE: this is the UI-level lock. The REAL lock is the
// database's Row Level Security (Step 5.3) — data queries
// carry the signed-in user's token automatically.
// ============================================================

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function AuthGate({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [state, setState] = useState<"checking" | "in" | "out">("checking");

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      if (data.session) setState("in");
      else {
        setState("out");
        router.replace("/login");
      }
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) setState("in");
      else {
        setState("out");
        router.replace("/login");
      }
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, [router]);

  return (
    <>
      {children}
      {state !== "in" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#eef1f5] text-sm text-[#68707a]">
          {state === "checking"
            ? "Đang kiểm tra đăng nhập..."
            : "Đang chuyển tới trang đăng nhập..."}
        </div>
      )}
    </>
  );
}
