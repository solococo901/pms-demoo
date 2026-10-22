// ============================================================
// API ROUTE — app/api/channex/setup/route.ts
// Creates the STRUCTURE on Channex: Property -> Room Types ->
// (base) Rate Plans. The browser assembles the payload from
// Supabase (it owns the data + the user session) and posts it
// here; this route adds the secret API key and talks to
// Channex, then returns the created Channex ids so the
// browser can save the mapping back into Supabase.
// Payload formats verified against docs.channex.io
// (Create Property / Room Type / Rate Plan API, 2026-10-22).
// Derived rate plans are created in the NEXT step (C3b) —
// Channex supports rate derivation natively.
// ============================================================

import { NextResponse } from "next/server";

type SetupBody = {
  propertyId?: string | null;
  property: {
    title: string;
    currency: string;
    email?: string;
    phone?: string;
    country?: string;
    city?: string;
    address?: string;
    timezone?: string;
    propertyType?: string;
    latitude?: string;
    longitude?: string;
  };
  roomTypes: {
    pmsId: string;
    title: string;
    countOfRooms: number;
    occAdults: number;
    occChildren: number;
    occInfants: number;
  }[];
  ratePlans: {
    pmsId: string;
    pmsRoomTypeId: string;
    title: string;
    mealType: string;
    occupancy: number;
    rate: string;
  }[];
};

function channexBase(env: string) {
  return env === "production" ? "https://app.channex.io" : "https://staging.channex.io";
}

async function channexPost(base: string, key: string, path: string, payload: unknown) {
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "user-api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    cache: "no-store",
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const detail =
      body?.errors?.details ??
      body?.errors?.title ??
      body?.errors ??
      `HTTP ${res.status}`;
    throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
  }
  return body;
}

export async function POST(req: Request) {
  const key = process.env.CHANNEX_API_KEY;
  const env = process.env.CHANNEX_ENV ?? "staging";
  if (!key) {
    return NextResponse.json({ ok: false, error: "Chưa có CHANNEX_API_KEY trong .env.local." });
  }
  const base = channexBase(env);
  const input = (await req.json()) as SetupBody;
  const errors: string[] = [];

  // ----- 1) Property (create only when not mapped yet) -----
  let propertyId = input.propertyId ?? null;
  if (!propertyId) {
    try {
      const created = await channexPost(base, key, "/api/v1/properties", {
        property: {
          title: input.property.title,
          currency: input.property.currency,
          email: input.property.email || undefined,
          phone: input.property.phone || undefined,
          country: input.property.country || undefined,
          city: input.property.city || undefined,
          address: input.property.address || undefined,
          timezone: input.property.timezone || undefined,
          property_type: input.property.propertyType || undefined,
          latitude: input.property.latitude || undefined,
          longitude: input.property.longitude || undefined,
        },
      });
      propertyId = created?.data?.id ?? null;
      if (!propertyId) errors.push("Property: Channex không trả về id.");
    } catch (e) {
      return NextResponse.json({
        ok: false,
        error: `Tạo Property thất bại: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  }

  // ----- 2) Room types -----
  const roomTypeIds: Record<string, string> = {};
  for (const rt of input.roomTypes) {
    try {
      const created = await channexPost(base, key, "/api/v1/room_types", {
        room_type: {
          title: rt.title,
          count_of_rooms: rt.countOfRooms,
          occ_adults: rt.occAdults,
          occ_children: rt.occChildren,
          occ_infants: rt.occInfants,
          property_id: propertyId,
        },
      });
      const cid = created?.data?.id;
      if (cid) roomTypeIds[rt.pmsId] = cid;
      else errors.push(`Loại phòng ${rt.title}: không nhận được id.`);
    } catch (e) {
      errors.push(`Loại phòng ${rt.title}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // ----- 3) Base rate plans (OTA channels only) -----
  const ratePlanIds: Record<string, string> = {};
  for (const rp of input.ratePlans) {
    const roomTypeId = roomTypeIds[rp.pmsRoomTypeId];
    if (!roomTypeId) {
      errors.push(`Gói giá ${rp.title}: loại phòng của nó chưa có mã Channex.`);
      continue;
    }
    try {
      const created = await channexPost(base, key, "/api/v1/rate_plans", {
        rate_plan: {
          title: rp.title,
          property_id: propertyId,
          room_type_id: roomTypeId,
          sell_mode: "per_room",
          meal_type: rp.mealType,
          options: [{ occupancy: rp.occupancy, is_primary: true, rate: rp.rate }],
        },
      });
      const cid = created?.data?.id;
      if (cid) ratePlanIds[rp.pmsId] = cid;
      else errors.push(`Gói giá ${rp.title}: không nhận được id.`);
    } catch (e) {
      errors.push(`Gói giá ${rp.title}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return NextResponse.json({ ok: true, env, propertyId, roomTypeIds, ratePlanIds, errors });
}
