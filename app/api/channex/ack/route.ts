import { NextRequest, NextResponse } from "next/server";

// Bao cho Channex biet PMS da nhan + luu xong tung revision (ack).
// Chi ack SAU KHI don da ghi thanh cong vao Supabase.
export async function POST(req: NextRequest) {
  const apiKey = process.env.CHANNEX_API_KEY;
  const env = process.env.CHANNEX_ENV === "production" ? "production" : "staging";
  if (!apiKey) {
    return NextResponse.json(
      { ok: false, error: "Chưa cấu hình CHANNEX_API_KEY trong .env.local" },
      { status: 500 }
    );
  }
  const { revisionIds } = (await req.json().catch(() => ({}))) as {
    revisionIds?: string[];
  };
  if (!revisionIds || revisionIds.length === 0) {
    return NextResponse.json({ ok: true, acked: 0, failed: [] });
  }
  const base =
    env === "production" ? "https://app.channex.io" : "https://staging.channex.io";
  const failed: { id: string; error: string }[] = [];
  let acked = 0;
  for (const id of revisionIds) {
    try {
      const res = await fetch(`${base}/api/v1/booking_revisions/${id}/ack`, {
        method: "POST",
        headers: { "user-api-key": apiKey, "Content-Type": "application/json" },
        cache: "no-store",
      });
      if (res.ok) acked += 1;
      else failed.push({ id, error: `HTTP ${res.status}` });
    } catch (e) {
      failed.push({ id, error: e instanceof Error ? e.message : "network error" });
    }
  }
  return NextResponse.json({ ok: failed.length === 0, acked, failed });
}
