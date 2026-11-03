import { NextRequest, NextResponse } from "next/server";

// Keo danh sach "phien ban don" (booking revisions) chua duoc xac nhan tu
// Channex. PMS luu don xong moi goi ack rieng.
export async function POST(req: NextRequest) {
  const apiKey = process.env.CHANNEX_API_KEY;
  const env = process.env.CHANNEX_ENV === "production" ? "production" : "staging";
  if (!apiKey) {
    return NextResponse.json(
      { ok: false, error: "Chưa cấu hình CHANNEX_API_KEY trong .env.local" },
      { status: 500 }
    );
  }
  const { propertyId } = (await req.json().catch(() => ({}))) as {
    propertyId?: string;
  };
  if (!propertyId) {
    return NextResponse.json(
      { ok: false, error: "Thiếu propertyId (khách sạn chưa kết nối Channex)" },
      { status: 400 }
    );
  }
  const base =
    env === "production" ? "https://app.channex.io" : "https://staging.channex.io";
  const url =
    `${base}/api/v1/booking_revisions/feed` +
    `?filter%5Bproperty_id%5D=${encodeURIComponent(propertyId)}` +
    `&order%5Binserted_at%5D=asc&limit=50`;
  try {
    const res = await fetch(url, {
      headers: { "user-api-key": apiKey, "Content-Type": "application/json" },
      cache: "no-store",
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      return NextResponse.json(
        {
          ok: false,
          error:
            json?.errors?.title ?? `Channex trả lỗi HTTP ${res.status} khi kéo đơn`,
        },
        { status: 502 }
      );
    }
    return NextResponse.json({ ok: true, revisions: json?.data ?? [] });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Không gọi được Channex" },
      { status: 502 }
    );
  }
}
