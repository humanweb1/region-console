import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS","Content-Type":"application/json"};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: cors });
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  let createdUserId: string | null = null;
  try {
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "Oturum bulunamadı." }, 401);
    const url = Deno.env.get("SUPABASE_URL"), serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !serviceKey) return json({ error: "Sunucu yapılandırması eksik." }, 500);
    const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
    const { data: authData, error: authError } = await admin.auth.getUser(token);
    if (authError || !authData.user) return json({ error: "Oturum geçersiz." }, 401);
    const { data: actor, error: actorError } = await admin.from("profiles").select("id,role_id,is_active,roles(name)").eq("id", authData.user.id).single();
    if (actorError || !actor?.is_active) return json({ error: "Yönetici profili aktif değil." }, 403);
    const roleName = actor.roles?.name;
    const { data: perms } = await admin.from("role_permissions").select("permission").eq("role_id", actor.role_id);
    if (!(roleName === "super_admin" || (perms || []).some((p) => p.permission === "*" || p.permission === "users.manage"))) return json({ error: "Kullanıcı oluşturma yetkiniz yok." }, 403);
    const body = await req.json();
    const fullName = String(body.full_name || "").trim().replace(/\s+/g, " ");
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    const roleId = String(body.role_id || "").trim();
    if (!fullName || fullName.length < 2) return json({ error: "Ad soyad zorunludur." }, 400);
    if (fullName.length > 120) return json({ error: "Ad soyad 120 karakterden uzun olamaz." }, 400);
    if (!email || !emailPattern.test(email) || email.length > 254) return json({ error: "Geçerli bir e-posta adresi girin." }, 400);
    if (password.length < 8) return json({ error: "Şifre en az 8 karakter olmalıdır." }, 400);
    if (password.length > 128) return json({ error: "Şifre 128 karakterden uzun olamaz." }, 400);
    if (!roleId) return json({ error: "Rol seçimi zorunludur." }, 400);
    const { data: role, error: roleError } = await admin.from("roles").select("id,name").eq("id", roleId).single();
    if (roleError || !role) return json({ error: "Seçilen rol bulunamadı." }, 400);
    if (role.name === "super_admin" && roleName !== "super_admin") return json({ error: "Super Admin rolü yalnızca Super Admin tarafından atanabilir." }, 403);
    const { data: created, error: createError } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: fullName } });
    if (createError || !created.user) {
      const message = createError?.message || "Auth kullanıcısı oluşturulamadı.", normalized = message.toLowerCase();
      return json({ error: normalized.includes("already") || normalized.includes("exists") || normalized.includes("duplicate") ? "Bu e-posta adresi zaten kayıtlı." : message }, normalized.includes("already") || normalized.includes("exists") || normalized.includes("duplicate") ? 409 : 400);
    }
    createdUserId = created.user.id;
    const { error: profileError } = await admin.from("profiles").insert({ id: createdUserId, full_name: fullName, role_id: roleId, is_active: true, updated_at: new Date().toISOString() });
    if (profileError) { await admin.auth.admin.deleteUser(createdUserId); createdUserId = null; return json({ error: `Kullanıcı profili oluşturulamadı: ${profileError.message}` }, 500); }
    return json({ ok: true, user: { id: createdUserId, email, full_name: fullName, role_id: roleId, role: role.name } });
  } catch (error) {
    if (createdUserId) { try { const url = Deno.env.get("SUPABASE_URL"), key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"); if (url && key) await createClient(url, key, { auth: { persistSession: false } }).auth.admin.deleteUser(createdUserId); } catch (_) {} }
    return json({ error: error instanceof Error ? error.message : "Beklenmeyen hata." }, 500);
  }
});
