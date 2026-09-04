import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS","Content-Type":"application/json","Cache-Control":"no-store"};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:cors});
const UUID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
Deno.serve(async(req:Request)=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
 if(req.method!=='POST')return json({error:'METHOD_NOT_ALLOWED'},405);
 try{
  const token=(req.headers.get('Authorization')||'').replace(/^Bearer\s+/i,'');
  if(!token)return json({error:'AUTH_REQUIRED'},401);
  const admin=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:u,error:ue}=await admin.auth.getUser(token); if(ue||!u.user)return json({error:'AUTH_INVALID'},401);
  const {data:profile,error:pe}=await admin.from('profiles').select('id,role_id,is_active,roles(name)').eq('id',u.user.id).single();
  if(pe||!profile?.is_active)return json({error:'FORBIDDEN'},403);
  const roleName=(profile.roles as {name?:string}|null)?.name||'';
  const {data:perms,error:permError}=await admin.from('role_permissions').select('permission').eq('role_id',profile.role_id);
  if(permError)throw permError;
  if(roleName!=='super_admin'&&!(perms||[]).some(p=>p.permission==='integrations.digital_anit.map'||p.permission==='*'))return json({error:'FORBIDDEN'},403);
  const body=await req.json().catch(()=>null); const cemeteryId=typeof body?.cemetery_id==='string'?body.cemetery_id.trim():'';
  if(!UUID_RE.test(cemeteryId))return json({error:'INVALID_CEMETERY_ID'},400);
  const {data,error}=await admin.rpc('get_cemetery_map_public',{p_cemetery_id:cemeteryId});
  if(error)throw error; if(!data)return json({error:'CEMETERY_NOT_FOUND'},404);
  return json({ok:true,data});
 }catch(error){console.error('[cemetery-map-read]',error);return json({error:'INTERNAL_ERROR'},500)}
});
