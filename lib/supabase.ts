// ============================================================
// lib/supabase.ts — the ONE connection to our database.
// Every page imports { supabase } from here instead of creating
// its own connection, so the address + key live in one place.
// The URL and the anon key come from .env.local (never typed
// into code): NEXT_PUBLIC_ means Next.js may show them to the
// browser — the anon key is designed for that; real protection
// comes from Row Level Security, switched on in the Auth step.
// ============================================================

import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error("Thiếu NEXT_PUBLIC_SUPABASE_URL hoặc NEXT_PUBLIC_SUPABASE_ANON_KEY trong .env.local");
}

export const supabase = createClient(url, anonKey);
