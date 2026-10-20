import { createClient } from "@supabase/supabase-js";

// Publishable key only (see .env.production). Access is controlled by RLS in schema.sql.
export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
  { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } },
);
