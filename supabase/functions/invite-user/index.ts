import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ message: "Method not allowed" }), { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const authHeader = request.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return json({ message: "Yetkilendirme gerekli." }, 401);

  const url = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const userClient = createClient(url, anonKey, { auth: { persistSession: false } });
  const { data: { user }, error: userError } = await userClient.auth.getUser(token);
  if (userError || !user) return json({ message: "Oturum geçersiz." }, 401);

  const adminClient = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: profile, error: profileError } = await adminClient
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError) return json({ message: profileError.message }, 500);
  if (profile?.role !== "admin") return json({ message: "Alt kullanıcı oluşturmak için yönetici yetkisi gerekir." }, 403);

  const body = await request.json().catch(() => ({}));
  const email = String(body.email || "").trim().toLowerCase();
  const name = String(body.name || "").trim();
  const role = body.role === "viewer" ? "viewer" : "sub_user";

  if (!email || !email.includes("@")) return json({ message: "Geçerli bir e-posta adresi girin." }, 400);

  const { data, error } = await adminClient.auth.admin.inviteUserByEmail(email, {
    data: { name, role },
    redirectTo: Deno.env.get("REGION_CONSOLE_SITE_URL") || undefined
  });

  if (error) return json({ message: error.message }, 400);

  if (data.user) {
    await adminClient.from("profiles").upsert({
      id: data.user.id,
      email,
      name,
      role,
      created_by: user.id
    }, { onConflict: "id" });
  }

  return json({ ok: true, user: data.user ? { id: data.user.id, email: data.user.email, role } : null });
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
}
