import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS","Content-Type":"application/json","Cache-Control":"no-store"};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:cors});
const UUID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PERMISSION="integrations.digital_anit.order";
Deno.serve(async(req)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
 if(req.method!=="POST")return json({error:"METHOD_NOT_ALLOWED"},405);
 try{
  const token=(req.headers.get("Authorization")||"").replace(/^Bearer\s+/i,"");
  if(!token)return json({error:"AUTH_REQUIRED"},401);
  const admin=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:authData,error:authError}=await admin.auth.getUser(token);
  if(authError||!authData.user)return json({error:"AUTH_INVALID"},401);
  const {data:profile,error:profileError}=await admin.from("profiles").select("id,role_id,is_active,roles(name)").eq("id",authData.user.id).single();
  if(profileError||!profile?.is_active||!profile.role_id)return json({error:"FORBIDDEN"},403);
  const roleName=(profile.roles as {name?:string}|null)?.name||"";
  const {data:permissions,error:permissionError}=await admin.from("role_permissions").select("permission").eq("role_id",profile.role_id);
  if(permissionError)throw permissionError;
  if(roleName!=="super_admin"&&!((permissions||[]).some(p=>p.permission===PERMISSION||p.permission==="*")))return json({error:"FORBIDDEN"},403);
  const body=await req.json().catch(()=>null); const graveId=typeof body?.grave_id==="string"?body.grave_id.trim():"";
  if(!UUID_RE.test(graveId))return json({error:"INVALID_GRAVE_ID"},400);
  const {data,error}=await admin.rpc("check_memorial_order",{p_grave_id:graveId});
  if(error){console.error("[check-memorial-order]",error);return json({error:"ORDER_ELIGIBILITY_LOOKUP_FAILED"},500);}
  return json({ok:true,data});
 }catch(error){console.error("[check-memorial-order]",error);return json({error:"INTERNAL_ERROR"},500)}
});