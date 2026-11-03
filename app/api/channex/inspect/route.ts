import { NextResponse } from "next/server";

// Route kiem tra (doc): liet ke cac goi gia Channex dang luu,
// kem rate_mode + options + derived_option cua tung goi.
// Mo bang trinh duyet: /api/channex/inspect
export async function GET() {
  const apiKey = process.env.CHANNEX_API_KEY;
  const env = process.env.CHANNEX_ENV === "production" ? "production" : "staging";
  if (!apiKey) {
    return NextResponse.json(
      { ok: false, error: "Chưa cấu hình CHANNEX_API_KEY trong .env.local" },
      { status: 500 }
    );
  }
  const base =
    env === "production" ? "https://app.channex.io" : "https://staging.channex.io";
  try {
    const res = await fetch(`${base}/api/v1/rate_plans?limit=100`, {
      headers: { "user-api-key": apiKey, "Content-Type": "application/json" },
      cache: "no-store",
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, error: json?.errors?.title ?? `HTTP ${res.status}` },
        { status: 502 }
      );
    }
    const plans = (json?.data ?? []).map((d: { id: string; attributes: Record<string, unknown> }) => ({
      id: d.id,
      title: d.attributes.title,
      rate_mode: d.attributes.rate_mode,
      sell_mode: d.attributes.sell_mode,
      options: d.attributes.options,
    }));
    return NextResponse.json({ ok: true, env, plans });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Không gọi được Channex" },
      { status: 502 }
    );
  }
}
