import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS","Content-Type":"application/json"};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: cors });
type Admin = ReturnType<typeof createClient>;
const normalizePermissions = (permissions: string[]) => [...new Set((permissions || []).map(String).map((permission) => permission.trim()).filter(Boolean))];

async function actorContext(admin: Admin, token: string) {
  const { data: authData, error: authError } = await admin.auth.getUser(token);
  if (authError || !authData.user) throw new Error("Oturum geçersiz.");
  const { data: actor, error } = await admin.from("profiles").select("id,full_name,role_id,is_active,roles(id,name,description)").eq("id", authData.user.id).single();
  if (error || !actor?.is_active) throw new Error("Yönetici profili aktif değil.");
  const roleName = actor.roles?.name;
  const { data: perms, error: permError } = await admin.from("role_permissions").select("permission").eq("role_id", actor.role_id);
  if (permError) throw permError;
  const canManageUsersAndRoles = roleName === "super_admin" || (perms || []).some((p) => ["*","users.manage","button.rbac.tab_users","button.rbac.tab_roles"].includes(p.permission));
  if (!canManageUsersAndRoles) throw new Error("Kullanıcı ve rol yönetimi yetkiniz yok.");
  return { actor, roleName };
}

async function ensureDistrictCatalog(admin: Admin) {
  const { data: existing, error: existingError } = await admin.from("regions").select("id,external_id").eq("type","district").eq("is_active",true);
  if (existingError) throw existingError;
  if ((existing || []).length >= 900) return;
  const response = await fetch("https://api.turkiyeapi.dev/v2/districts?limit=1000&fields=id,name,provinceId");
  if (!response.ok) throw new Error(`İlçe veri kaynağına erişilemedi (${response.status}).`);
  const payload = await response.json();
  const districts = Array.isArray(payload?.data) ? payload.data : [];
  if (!districts.length) throw new Error("İlçe veri kaynağından kayıt alınamadı.");
  const { data: provinces, error: provinceError } = await admin.from("regions").select("id,external_id,name,created_at").eq("type","province").eq("is_active",true).order("created_at", { ascending: false });
  if (provinceError) throw provinceError;
  const provinceByCode = new Map<string, string>();
  for (const province of provinces || []) {
    const match = String(province.external_id || "").match(/TR(\d{2})/i);
    if (match && !provinceByCode.has(match[1])) provinceByCode.set(match[1], province.id);
  }
  const existingIds = new Set((existing || []).map((row) => String(row.external_id || "")));
  const rows = districts.map((district: any) => {
    const provinceId = provinceByCode.get(String(district.provinceId).padStart(2,"0"));
    if (!provinceId) return null;
    const externalId = `turkiyeapi-district-${district.id}`;
    if (existingIds.has(externalId)) return null;
    return { parent_id: provinceId, type: "district", name: String(district.name || "").trim(), external_id: externalId, code: String(district.id), metadata: { source: "TurkiyeAPI", source_id: district.id, province_id: district.provinceId }, is_active: true };
  }).filter((row: any) => row && row.name);
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await admin.from("regions").insert(rows.slice(i, i + 500));
    if (error) throw error;
  }
}

async function listUsers(admin: Admin) {
  await ensureDistrictCatalog(admin);
  const [{ data: authUsers, error: authError }, { data: profiles, error: profileError }, { data: roles, error: roleError }, { data: permissions, error: permissionError }, { data: scopes, error: scopeError }, { data: regions, error: regionError }] = await Promise.all([
    admin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
    admin.from("profiles").select("id,full_name,role_id,is_active,created_at,updated_at,roles(id,name,description)").order("created_at", { ascending: true }),
    admin.from("roles").select("id,name,description,created_at").order("name"),
    admin.from("role_permissions").select("role_id,permission"),
    admin.from("role_scopes").select("id,role_id,country_id,province_id,district_id"),
    admin.from("regions").select("id,external_id,type,name,parent_id").eq("is_active", true).order("type").order("name")
  ]);
  if (authError) throw authError; if (profileError) throw profileError; if (roleError) throw roleError; if (permissionError) throw permissionError; if (scopeError) throw scopeError; if (regionError) throw regionError;
  const profileMap = new Map((profiles || []).map((p) => [p.id, p]));
  const permissionsByRole: Record<string,string[]> = {}; for (const item of permissions || []) (permissionsByRole[item.role_id] ??= []).push(item.permission);
  const regionMap = new Map((regions || []).map((r) => [r.id, r]));
  const scopesByRole: Record<string,unknown[]> = {};
  for (const item of scopes || []) { const country=regionMap.get(item.country_id), province=regionMap.get(item.province_id), district=regionMap.get(item.district_id); (scopesByRole[item.role_id] ??= []).push({id:item.id,country_id:country?.external_id||null,country_name:country?.name||null,province_id:province?.external_id||null,province_name:province?.name||null,district_id:district?.external_id||null,district_name:district?.name||null}); }
  const regionCatalog = (regions || []).map((region) => ({ id: region.external_id || region.id, type: region.type, name: region.name, parent_id: region.parent_id ? (regionMap.get(region.parent_id)?.external_id || region.parent_id) : null }));
  const users = (authUsers?.users || []).map((u) => { const p=profileMap.get(u.id); return {id:u.id,email:u.email||"",full_name:p?.full_name||u.user_metadata?.full_name||"",role_id:p?.role_id||null,role:p?.roles||null,is_active:p?.is_active!==false,created_at:p?.created_at||u.created_at,last_sign_in_at:u.last_sign_in_at||null}; });
  return { users, roles: roles || [], permissionsByRole, scopesByRole, regionCatalog };
}

async function saveRole(admin: Admin, actorId: string, payload: { roleId:string|null; name:string; description:string; permissions:string[]; scopes:unknown[] }) {
  const { data, error } = await admin.rpc("admin_save_role", { p_role_id:payload.roleId,p_name:payload.name,p_description:payload.description,p_permissions:normalizePermissions(payload.permissions),p_scopes:payload.scopes,p_actor_user_id:actorId });
  if (error) { const code=error.code==="23505"?409:error.code==="42501"?403:400; throw Object.assign(new Error(error.message),{status:code}); }
  return data;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", {headers:cors});
  if (req.method !== "POST") return json({error:"Method not allowed"},405);
  let action="unknown";
  try {
    const token=(req.headers.get("Authorization")||"").replace(/^Bearer\s+/i,""); if(!token) return json({error:"Oturum bulunamadı."},401);
    const admin=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,{auth:{persistSession:false}});
    const {actor,roleName}=await actorContext(admin,token); const body=await req.json().catch(()=>({})); action=String(body.action||"list");
    if(action==="list") return json({ok:true,...(await listUsers(admin))});
    if(action==="update-user"){const userId=String(body.user_id||""),roleId=String(body.role_id||"");if(!userId||!roleId)return json({error:"Kullanıcı ve rol zorunludur."},400);if(userId===actor.id)return json({error:"Kendi hesabınızın rolünü veya durumunu bu ekrandan değiştiremezsiniz."},403);const {data:role,error:roleError}=await admin.from("roles").select("id,name").eq("id",roleId).single();if(roleError||!role)return json({error:"Rol bulunamadı."},400);if(role.name==="super_admin"&&roleName!=="super_admin")return json({error:"Super Admin rolü yalnızca Super Admin tarafından atanabilir."},403);const {error}=await admin.from("profiles").update({role_id:roleId,is_active:Boolean(body.is_active),updated_at:new Date().toISOString()}).eq("id",userId);if(error)throw error;return json({ok:true});}
    if(action==="create-role"||action==="update-role"){const roleId=action==="update-role"?String(body.role_id||""):null;if(action==="update-role"&&!roleId)return json({error:"Rol zorunludur."},400);const role=await saveRole(admin,actor.id,{roleId,name:String(body.name||"").trim(),description:String(body.description||"").trim(),permissions:Array.isArray(body.permissions)?body.permissions.map(String):[],scopes:Array.isArray(body.scopes)?body.scopes:[]});return json({ok:true,role});}
    if(action==="set-role-scopes"){const roleId=String(body.role_id||"");if(!roleId)return json({error:"Rol zorunludur."},400);const {data:role,error:roleError}=await admin.from("roles").select("id,name,description").eq("id",roleId).single();if(roleError||!role)return json({error:"Rol bulunamadı."},404);if(role.name==="super_admin")return json({error:"Super Admin için scope gerekmez."},400);const {data:existingPermissions,error:permissionError}=await admin.from("role_permissions").select("permission").eq("role_id",roleId);if(permissionError)throw permissionError;await saveRole(admin,actor.id,{roleId,name:role.name,description:role.description||"",permissions:(existingPermissions||[]).map((p)=>p.permission),scopes:Array.isArray(body.scopes)?body.scopes:[]});return json({ok:true});}
    return json({error:"Bilinmeyen işlem."},400);
  } catch(error) { console.error(`[admin-rbac] action=${action}`,error); const status=Number((error as {status?:number})?.status||500); return json({error:error instanceof Error?error.message:"Beklenmeyen hata.",action},status); }
});