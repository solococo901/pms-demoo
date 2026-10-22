// ============================================================
// API ROUTE — app/api/channex/test/route.ts
// A server-side "back door" of the app: the BROWSER never
// sees the Channex API key. The browser asks THIS route,
// the route reads CHANNEX_API_KEY from .env.local (server
// only) and calls Channex with it, then reports back just
// the result: connected or not + how many properties the
// account has. Key rule: env vars WITHOUT the NEXT_PUBLIC_
// prefix exist only on the server — that is the point.
// ============================================================

import { NextResponse } from "next/server";

export async function GET() {
  const key = process.env.CHANNEX_API_KEY;
  const env = process.env.CHANNEX_ENV ?? "staging";
  if (!key) {
    return NextResponse.json({
      ok: false,
      env,
      error: "Chưa có CHANNEX_API_KEY trong file .env.local (nhớ khởi động lại npm run dev sau khi sửa .env.local).",
    });
  }
  const base =
    env === "production" ? "https://app.channex.io" : "https://staging.channex.io";
  try {
    const res = await fetch(`${base}/api/v1/properties`, {
      headers: { "user-api-key": key },
      cache: "no-store",
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      return NextResponse.json({
        ok: false,
        env,
        status: res.status,
        error:
          body?.errors?.title ??
          body?.errors?.detail ??
          `Channex trả lỗi HTTP ${res.status} (thường là API key sai hoặc hết hạn).`,
      });
    }
    const properties = (body?.data ?? []).map((d: { id: string; attributes?: { title?: string } }) => ({
      id: d.id,
      title: d.attributes?.title ?? "(không tên)",
    }));
    return NextResponse.json({ ok: true, env, count: properties.length, properties });
  } catch {
    return NextResponse.json({
      ok: false,
      env,
      error: "Không gọi được tới máy chủ Channex (kiểm tra mạng hoặc địa chỉ môi trường).",
    });
  }
}
