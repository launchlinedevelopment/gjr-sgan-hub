import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: cors() });
  }

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const adminClient = createClient(supabaseUrl, serviceKey);

    const { data: authData, error: authError } = await userClient.auth.getUser();
    if (authError || !authData.user) throw new Error("Not authenticated");

    const callerId = authData.user.id;
    const { data: caller, error: callerError } = await adminClient
      .from("profiles")
      .select("id,role,council_id")
      .eq("id", callerId)
      .single();
    if (callerError || !caller) throw new Error("Profile not found");

    const body = await req.json();
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    const displayName = String(body.display_name || "").trim();
    const role = String(body.role || "");
    const councilId = String(body.council_id || "");
    const linkedCounterpartId = body.linked_counterpart_id || null;

    if (!email || password.length < 6 || !displayName || !councilId) {
      throw new Error("Email, display name, council, and a 6+ character password are required");
    }
    if (!["council_sgan", "counterpart"].includes(role)) {
      throw new Error("Invalid account role");
    }

    if (caller.role === "council_sgan") {
      if (role !== "counterpart") throw new Error("Council S'ganim/S'ganiot can only create counterpart accounts");
      if (caller.council_id !== councilId) throw new Error("You can only create accounts in your council");
    } else if (caller.role !== "admin") {
      throw new Error("You do not have permission to create accounts");
    }

    const { data: created, error: createError } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { display_name: displayName },
    });
    if (createError || !created.user) throw createError || new Error("Could not create user");

    const userId = created.user.id;
    const { error: profileError } = await adminClient.from("profiles").insert({
      id: userId,
      display_name: displayName,
      role,
      council_id: councilId,
      created_by: callerId,
    });
    if (profileError) {
      await adminClient.auth.admin.deleteUser(userId);
      throw profileError;
    }

    if (role === "counterpart" && linkedCounterpartId) {
      const { error: linkError } = await adminClient
        .from("counterparts")
        .update({ linked_profile_id: userId })
        .eq("id", linkedCounterpartId)
        .eq("council_id", councilId);
      if (linkError) throw linkError;
    }

    return new Response(JSON.stringify({ ok: true, user_id: userId }), {
      headers: { ...cors(), "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    return new Response(JSON.stringify({ ok: false, error: String(error?.message || error) }), {
      headers: { ...cors(), "Content-Type": "application/json" },
      status: 400,
    });
  }
});

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };
}
