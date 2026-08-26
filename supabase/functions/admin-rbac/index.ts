import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json"
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: cors });
const normalizePermissions = (permissions: string[]) => {
  const set = new Set(permissions.filter(Boolean));
  if (set.has("regions.manage")) set.add("regions.view");
  if (set.has("service_areas.manage")) set.add("service_areas.view");
  if (set.has("campaigns.manage")) set.add("campaigns.view");
  if (set.has("files.manage")) set.add("files.view");
  return [...set];
};

async function actorContext(admin: ReturnType<typeof createClient>, token: string) {
  const { data: authData, error: authError } = await admin.auth.getUser(token);
  if (authError || !authData.user) throw new Error("Oturum geçersiz.");
  const { data: actor, error } = await admin.from("profiles").select("id,full_name,role_id,is_active,roles(id,name,description)").eq("id", authData.user.id).single();
  if (error || !actor?.is_active) throw new Error("Yönetici profili aktif değil.");
  const roleName = actor.roles?.name;
  const { data: perms } = await admin.from("role_permissions").select("permission").eq("role_id", actor.role_id);
  const allowed = roleName === "super_admin" || (perms || []).some((p) => p.permission === "*" || p.permission === "users.manage");
  if (!allowed) throw new Error("Kullanıcı ve rol yönetimi yetkiniz yok.");
  return { actor, roleName };
}

async function listUsers(admin: ReturnType<typeof createClient>) {
  const [{ data: authUsers, error: authError }, { data: profiles, error: profileError }, { data: roles, error: roleError }, { data: permissions, error: permissionError }] = await Promise.all([
    admin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
    admin.from("profiles").select("id,full_name,role_id,is_active,created_at,updated_at,roles(id,name,description)").order("created_at", { ascending: true }),
    admin.from("roles").select("id,name,description,created_at").order("name"),
    admin.from("role_permissions").select("role_id,permission")
  ]);
  if (authError) throw authError;
  if (profileError) throw profileError;
  if (roleError) throw roleError;
  if (permissionError) throw permissionError;
  const profileMap = new Map((profiles || []).map((p) => [p.id, p]));
  const permissionsByRole: Record<string, string[]> = {};
  for (const item of permissions || []) {
    if (!permissionsByRole[item.role_id]) permissionsByRole[item.role_id] = [];
    permissionsByRole[item.role_id].push(item.permission);
  }
  const users = (authUsers?.users || []).map((u) => {
    const p = profileMap.get(u.id);
    return {
      id: u.id,
      email: u.email || "",
      full_name: p?.full_name || u.user_metadata?.full_name || "",
      role_id: p?.role_id || null,
      role: p?.roles || null,
      is_active: p?.is_active !== false,
      created_at: p?.created_at || u.created_at,
      last_sign_in_at: u.last_sign_in_at || null
    };
  });
  return { users, roles: roles || [], permissionsByRole };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "Oturum bulunamadı." }, 401);
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    const { actor, roleName } = await actorContext(admin, token);
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "list");

    if (action === "list") return json({ ok: true, ...(await listUsers(admin)) });

    if (action === "update-user") {
      const userId = String(body.user_id || "");
      const roleId = String(body.role_id || "");
      const isActive = Boolean(body.is_active);
      if (!userId || !roleId) return json({ error: "Kullanıcı ve rol zorunludur." }, 400);
      if (userId === actor.id) return json({ error: "Kendi Super Admin hesabınızın rolünü veya durumunu bu ekrandan değiştiremezsiniz." }, 403);
      const { data: role, error: roleError } = await admin.from("roles").select("id,name").eq("id", roleId).single();
      if (roleError || !role) return json({ error: "Rol bulunamadı." }, 400);
      if (role.name === "super_admin" && roleName !== "super_admin") return json({ error: "Super Admin rolü yalnızca Super Admin tarafından atanabilir." }, 403);
      const { error } = await admin.from("profiles").update({ role_id: roleId, is_active: isActive, updated_at: new Date().toISOString() }).eq("id", userId);
      if (error) throw error;
      return json({ ok: true });
    }

    if (action === "create-role") {
      const name = String(body.name || "").trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_");
      const description = String(body.description || "").trim();
      const permissions = normalizePermissions(Array.isArray(body.permissions) ? body.permissions.map(String) : []);
      if (!name || !description) return json({ error: "Rol adı ve açıklaması zorunludur." }, 400);
      if (name === "super_admin") return json({ error: "Super Admin sistem rolüdür ve kopyalanamaz." }, 400);
      const { data: role, error: roleError } = await admin.from("roles").insert({ name, description }).select("id,name,description,created_at").single();
      if (roleError) return json({ error: roleError.message }, 400);
      if (permissions.length) {
        const { error } = await admin.from("role_permissions").insert(permissions.map((permission) => ({ role_id: role.id, permission })));
        if (error) {
          await admin.from("roles").delete().eq("id", role.id);
          throw error;
        }
      }
      return json({ ok: true, role });
    }

    if (action === "update-role") {
      const roleId = String(body.role_id || "");
      const name = String(body.name || "").trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_");
      const description = String(body.description || "").trim();
      const permissions = normalizePermissions(Array.isArray(body.permissions) ? body.permissions.map(String) : []);
      if (!roleId || !name || !description) return json({ error: "Rol, ad ve açıklama zorunludur." }, 400);
      const { data: existing, error: existingError } = await admin.from("roles").select("id,name").eq("id", roleId).single();
      if (existingError || !existing) return json({ error: "Rol bulunamadı." }, 404);
      if (existing.name === "super_admin" || name === "super_admin") return json({ error: "Super Admin sistem rolü değiştirilemez." }, 403);
      const { error: roleError } = await admin.from("roles").update({ name, description }).eq("id", roleId);
      if (roleError) return json({ error: roleError.message }, 400);
      const { error: deleteError } = await admin.from("role_permissions").delete().eq("role_id", roleId);
      if (deleteError) throw deleteError;
      if (permissions.length) {
        const { error } = await admin.from("role_permissions").insert(permissions.map((permission) => ({ role_id: roleId, permission })));
        if (error) throw error;
      }
      return json({ ok: true });
    }

    return json({ error: "Bilinmeyen işlem." }, 400);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Beklenmeyen hata." }, 500);
  }
});
