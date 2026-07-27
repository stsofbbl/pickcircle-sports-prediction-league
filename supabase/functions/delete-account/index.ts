import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.95.0";

// This function must be deployed with verify_jwt=true.
const CORS_HEADERS = Object.freeze({
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json; charset=utf-8" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405);

  const authorization = req.headers.get("Authorization") || "";
  if (!authorization.toLowerCase().startsWith("bearer ")) {
    return jsonResponse({ error: "authentication_required" }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return jsonResponse({ error: "function_configuration_error" }, 500);
  }

  let password = "";
  try {
    const body = await req.json() as Record<string, unknown>;
    password = String(body.password || "");
  } catch {
    return jsonResponse({ error: "invalid_request" }, 400);
  }
  if (password.length < 6 || password.length > 256) {
    return jsonResponse({ error: "password_confirmation_required" }, 400);
  }

  const token = authorization.replace(/^Bearer\s+/i, "");
  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: caller, error: callerError } = await callerClient.auth.getUser(token);
  const user = caller.user;
  if (callerError || !user?.id || !user.email) {
    return jsonResponse({ error: "authentication_required" }, 401);
  }

  const passwordClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: confirmation, error: confirmationError } = await passwordClient.auth.signInWithPassword({
    email: user.email,
    password,
  });
  const confirmedUser = confirmation.user;
  if (confirmationError || !confirmedUser || confirmedUser.id !== user.id) {
    return jsonResponse({ error: "password_confirmation_failed" }, 403);
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: ownedClubs, error: ownedClubError } = await adminClient
    .from("league_members")
    .select("league_id")
    .eq("user_id", user.id)
    .eq("role", "owner")
    .eq("membership_status", "active")
    .limit(1);
  if (ownedClubError) return jsonResponse({ error: "account_deletion_check_failed" }, 500);
  if (ownedClubs?.length) {
    return jsonResponse({
      error: "owned_club_exists",
      message: "Ownerのクラブを先に削除してください。",
    }, 409);
  }

  const { error: deleteError } = await adminClient.auth.admin.deleteUser(user.id, false);
  if (deleteError) {
    return jsonResponse({ error: "account_deletion_failed" }, 500);
  }

  return jsonResponse({ deleted: true });
});
