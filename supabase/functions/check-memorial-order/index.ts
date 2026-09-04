import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json"
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: cors });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const authorization = req.headers.get("Authorization");
    if (!authorization) return json({ error: "Authorization required" }, 401);

    const body = await req.json().catch(() => ({}));
    const graveId = String(body.grave_id || body.graveId || "").trim();
    if (!graveId) return json({ error: "grave_id is required" }, 400);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false, autoRefreshToken: false } }
    );

    const { data, error } = await admin.rpc("check_memorial_order", {
      p_grave_id: graveId
    });
    if (error) {
      console.error("[check-memorial-order] rpc", error);
      return json({ error: "Order eligibility could not be resolved." }, 500);
    }

    return json({ ok: true, ...data });
  } catch (error) {
    console.error("[check-memorial-order]", error);
    return json({ error: "Unexpected server error." }, 500);
  }
});
