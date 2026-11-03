import { NextRequest, NextResponse } from "next/server";

// Tao 1 don ngay tren Channex bang Booking CRS API — dung de test vong
// nhan don (don tao xong se xuat hien trong Booking Revisions Feed).
// Property can cai app "Booking CRS" tren Channex thi API nay moi chay.
export async function POST(req: NextRequest) {
  const apiKey = process.env.CHANNEX_API_KEY;
  const env = process.env.CHANNEX_ENV === "production" ? "production" : "staging";
  if (!apiKey) {
    return NextResponse.json(
      { ok: false, error: "Chưa cấu hình CHANNEX_API_KEY trong .env.local" },
      { status: 500 }
    );
  }
  const body = (await req.json().catch(() => null)) as { booking?: unknown } | null;
  if (!body?.booking) {
    return NextResponse.json({ ok: false, error: "Thiếu dữ liệu đơn" }, { status: 400 });
  }
  const base =
    env === "production" ? "https://app.channex.io" : "https://staging.channex.io";
  try {
    const res = await fetch(`${base}/api/v1/bookings`, {
      method: "POST",
      headers: { "user-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      const detail =
        json?.errors?.title ??
        (typeof json?.errors === "object" ? JSON.stringify(json.errors) : null) ??
        `Channex trả lỗi HTTP ${res.status} khi tạo đơn test`;
      return NextResponse.json({ ok: false, error: detail }, { status: 502 });
    }
    return NextResponse.json({ ok: true, data: json?.data ?? null });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Không gọi được Channex" },
      { status: 502 }
    );
  }
}
