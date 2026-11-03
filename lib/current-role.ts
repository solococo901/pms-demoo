"use client";

// ============================================================
// lib/current-role.ts — vai tro cua nguoi dang dang nhap
// Doc user_profiles.role (admin | staff) mot lan roi nho lai
// (cache) cho ca phien lam viec. Giao dien (menu, chan trang)
// dua vao day de chia Staff / Admin.
// SEC1 (2026-11-03, fail-closed): Khong co ho so (profile) ->
// mac dinh staff (quyen thap nhat). Chi co role = 'admin' ghi
// ro trong ho so moi duoc quyen admin — tai khoan moi tao ma
// quen gan ho so se KHONG tu thanh admin nua (truoc day mac
// dinh admin, la lo hong bao mat).
// SEC2 (2026-11-03, doi tai khoan): Cache cu chi nho role ma
// khong nho la cua tai khoan nao, lai them khung app (Shell)
// khong tai lai khi chuyen trang — nen dang nhap admin roi
// dang xuat, vao lai bang staff van thay tab admin cho den
// khi an F5. Nay cache gan theo tung user_id, va hook tu
// kiem tra lai ngay khi co su kien dang nhap/dang xuat, nen
// doi tai khoan xong la tab doi theo ngay, khong can F5.
// ============================================================

import { useEffect, useState } from "react";
import { supabase } from "./supabase";

export type UserRole = "admin" | "staff";

let cached: UserRole | null = null;
let cachedFor: string | null = null;
let inflight: Promise<UserRole> | null = null;

export function fetchCurrentRole(): Promise<UserRole> {
  if (inflight) return inflight;
  inflight = (async () => {
    const { data } = await supabase.auth.getUser();
    if (!data.user) {
      // Chua dang nhap -> hep nhat, dong thoi xoa cache cu.
      cached = null;
      cachedFor = null;
      return "staff" as UserRole;
    }
    // Cache chi dung khi van la dung tai khoan do.
    if (cached && cachedFor === data.user.id) return cached;
    const { data: profile } = await supabase
      .from("user_profiles")
      .select("role")
      .eq("user_id", data.user.id)
      .single();
    const role: UserRole = profile?.role === "admin" ? "admin" : "staff";
    cached = role;
    cachedFor = data.user.id;
    return role;
  })();
  // Xong mot luot thi tha inflight de lan goi sau kiem tra lai
  // tai khoan (neu doi tai khoan thi tu lay lai, khong an cache cu).
  inflight.then(
    () => {
      inflight = null;
    },
    () => {
      inflight = null;
    }
  );
  return inflight;
}

/** Hook: tra ve null khi dang tai, sau do la "admin" | "staff". */
export function useCurrentRole(): UserRole | null {
  const [role, setRole] = useState<UserRole | null>(cached);
  useEffect(() => {
    let on = true;
    fetchCurrentRole().then((r) => {
      if (on) setRole(r);
    });
    // Khung app khong tai lai khi chuyen trang, nen phai nghe
    // truc tiep su kien dang nhap/dang xuat de doi vai tro ngay.
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" || event === "SIGNED_OUT") {
        cached = null;
        cachedFor = null;
        inflight = null;
        fetchCurrentRole().then((r) => {
          if (on) setRole(r);
        });
      }
    });
    return () => {
      on = false;
      subscription.unsubscribe();
    };
  }, []);
  return role;
}
