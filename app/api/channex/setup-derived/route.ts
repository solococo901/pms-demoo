// ============================================================
// API ROUTE — app/api/channex/setup-derived/route.ts
// Creates DERIVED rate plans on Channex. Channex has native
// rate derivation: a derived plan names a parent plan plus
// rules such as "decrease_by_percent 10" — its price then
// follows the parent automatically, exactly like the PMS's
// own ke-thua model (PRICE_FORMULAS). The browser sends the
// rule per plan; this route adds the API key and calls
// Channex. Format verified against docs.channex.io
// (Create Rate Plan API — DerivedOption, 2026-10-22).
// ============================================================

import { NextResponse } from "next/server";

type DerivedBody = {
  propertyId: string;
  plans: {
    pmsId: string;
    title: string;
    mealType: string;
    occupancy: number;
    roomTypeChannexId: string;
    parentChannexId: string;
    rule: [string, string]; // [operation, value] e.g. ["decrease_by_percent", "10"]
  }[];
};

export async function POST(req: Request) {
  const key = process.env.CHANNEX_API_KEY;
  const env = process.env.CHANNEX_ENV ?? "staging";
  if (!key) {
    return NextResponse.json({ ok: false, error: "Chưa có CHANNEX_API_KEY trong .env.local." });
  }
  const base = env === "production" ? "https://app.channex.io" : "https://staging.channex.io";
  const input = (await req.json()) as DerivedBody;
  const ratePlanIds: Record<string, string> = {};
  const errors: string[] = [];

  for (const p of input.plans) {
    try {
      const res = await fetch(`${base}/api/v1/rate_plans`, {
        method: "POST",
        headers: { "user-api-key": key, "Content-Type": "application/json" },
        body: JSON.stringify({
          rate_plan: {
            title: p.title,
            property_id: input.propertyId,
            room_type_id: p.roomTypeChannexId,
            parent_rate_plan_id: p.parentChannexId,
            rate_mode: "derived",
            sell_mode: "per_room",
            meal_type: p.mealType,
            options: [
              {
                occupancy: p.occupancy,
                is_primary: true,
                derived_option: { rate: [[p.rule[0], p.rule[1]]] },
              },
            ],
          },
        }),
        cache: "no-store",
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        const detail = body?.errors?.details ?? body?.errors?.title ?? body?.errors ?? `HTTP ${res.status}`;
        errors.push(`Gói ${p.title}: ${typeof detail === "string" ? detail : JSON.stringify(detail)}`);
        continue;
      }
      const cid = body?.data?.id;
      if (cid) ratePlanIds[p.pmsId] = cid;
      else errors.push(`Gói ${p.title}: không nhận được id.`);
    } catch (e) {
      errors.push(`Gói ${p.title}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return NextResponse.json({ ok: true, env, ratePlanIds, errors });
}
