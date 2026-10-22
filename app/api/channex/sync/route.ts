// ============================================================
// API ROUTE — app/api/channex/sync/route.ts
// Pushes ARI to Channex: Availability (per room type) goes
// to POST /api/v1/availability, Rates & Restrictions (per
// rate plan) to POST /api/v1/restrictions — two SEPARATE
// calls, as Channex requires. The browser computes the
// values from Supabase; this route adds the API key and
// the property id, chunks the values, and returns the
// counts plus any Channex warnings (Channex answers 200
// with per-value warnings instead of failing the batch).
// Formats verified against docs.channex.io (ARI, 2026-10-22).
// Rates are decimal strings ("1000000.00"); dates in the
// past are rejected by Channex, so the client starts the
// window at the real today.
// ============================================================

import { NextResponse } from "next/server";

type SyncBody = {
  propertyId: string;
  availability: { room_type_id: string; date: string; availability: number }[];
  restrictions: {
    rate_plan_id: string;
    date: string;
    rate?: string;
    min_stay_arrival?: number;
    min_stay_through?: number;
    max_stay?: number;
    closed_to_arrival?: boolean;
    closed_to_departure?: boolean;
    stop_sell?: boolean;
  }[];
};

const CHUNK = 2000;

async function postValues(base: string, key: string, path: string, values: Record<string, unknown>[]) {
  const warnings: unknown[] = [];
  let sent = 0;
  for (let i = 0; i < values.length; i += CHUNK) {
    const slice = values.slice(i, i + CHUNK);
    const res = await fetch(`${base}${path}`, {
      method: "POST",
      headers: { "user-api-key": key, "Content-Type": "application/json" },
      body: JSON.stringify({ values: slice }),
      cache: "no-store",
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      const detail = body?.errors?.details ?? body?.errors?.title ?? `HTTP ${res.status}`;
      throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
    }
    sent += slice.length;
    for (const w of body?.meta?.warnings ?? []) warnings.push(w);
  }
  return { sent, warnings };
}

export async function POST(req: Request) {
  const key = process.env.CHANNEX_API_KEY;
  const env = process.env.CHANNEX_ENV ?? "staging";
  if (!key) {
    return NextResponse.json({ ok: false, error: "Chưa có CHANNEX_API_KEY trong .env.local." });
  }
  const base = env === "production" ? "https://app.channex.io" : "https://staging.channex.io";
  const input = (await req.json()) as SyncBody;
  try {
    const avValues = input.availability.map((v) => ({ property_id: input.propertyId, ...v }));
    const reValues = input.restrictions.map((v) => ({ property_id: input.propertyId, ...v }));
    const av = await postValues(base, key, "/api/v1/availability", avValues);
    const re = await postValues(base, key, "/api/v1/restrictions", reValues);
    return NextResponse.json({
      ok: true,
      env,
      availabilitySent: av.sent,
      restrictionsSent: re.sent,
      warnings: [...av.warnings, ...re.warnings].slice(0, 10),
      warningCount: av.warnings.length + re.warnings.length,
    });
  } catch (e) {
    return NextResponse.json({
      ok: false,
      error: `Đồng bộ thất bại: ${e instanceof Error ? e.message : String(e)}`,
    });
  }
}
