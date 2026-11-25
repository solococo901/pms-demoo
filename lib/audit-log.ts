// AUDIT8 — lib/audit-log.ts (nhat ky kiem tra, SQL 24)
// Them action "booking_pulled" (keo don tu Channex ve) de ghi log moi lan keo don.
// Viet 1 dong log vao bang audit_logs. Ham nay KHONG BAO GIO nem loi:
// ghi log that bai chi tra ve { ok: false } — thao tac chinh van xong.
import { supabase } from "@/lib/supabase";

export type AuditAction =
  | "booking_created"
  | "booking_cancelled"
  | "booking_checked_in"
  | "booking_checked_out"
  | "booking_updated"
  | "booking_pulled"
  | "price_updated"
  | "room_blocked"
  | "room_unblocked"
  | "stop_sell_set"
  | "stop_sell_removed"
  | "payment_added";

export type AuditEntityType = "reservation" | "rate_price" | "room_block" | "room" | "inventory_block";

export interface AuditEntry {
  hotelId: string;
  accountId: string;
  action: AuditAction;
  entityType: AuditEntityType;
  entityId: string;
  summary: string;
  details?: Record<string, unknown>;
}

// Ten nguoi lam: doc user_profiles.display_name 1 lan roi nho theo user_id
// (giong cache o current-role.ts) de moi lan ghi log khong phai doc lai.
let cachedActor: { userId: string; name: string } | null = null;

async function currentActor(): Promise<{ userId: string | null; name: string | null }> {
  const { data } = await supabase.auth.getUser();
  const user = data.user;
  if (!user) return { userId: null, name: null };
  if (cachedActor && cachedActor.userId === user.id) {
    return { userId: cachedActor.userId, name: cachedActor.name };
  }
  const { data: profile } = await supabase
    .from("user_profiles")
    .select("display_name")
    .eq("user_id", user.id)
    .single();
  const name = profile?.display_name ?? user.email ?? null;
  cachedActor = { userId: user.id, name: name ?? "" };
  return { userId: user.id, name };
}

export async function writeAuditLog(entry: AuditEntry): Promise<{ ok: boolean; error?: string }> {
  try {
    const actor = await currentActor();
    const { error } = await supabase.from("audit_logs").insert({
      hotel_id: entry.hotelId,
      account_id: entry.accountId,
      user_id: actor.userId,
      actor_name: actor.name,
      action: entry.action,
      entity_type: entry.entityType,
      entity_id: entry.entityId,
      summary: entry.summary,
      details: entry.details ?? {},
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    // Ghi log khong duoc phep lam hong thao tac chinh.
    return { ok: false, error: e instanceof Error ? e.message : "unknown error" };
  }
}
