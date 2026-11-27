interface Policy {tablename:string;policyname:string;cmd:string;qual:string|null;with_check:string|null}
const logoExpression="((bucket_id = 'brand-logos'::text) AND ((storage.foldername(name))[1] IN ( SELECT (current_user_brand_ids())::text AS current_user_brand_ids)))";
const normalize=(s:string|null)=>s?.replace(/\s+/g,' ').trim()??null;
/** Fail closed; this deployment recognizes only the complete existing logo
 * policies, not a syntactic prefix that could be followed by a permissive OR. */
export function validateCoaStorageBoundary(state:{objectsRls:boolean;bucketsRls:boolean;bypass:boolean;policies:Policy[]}){
 if(!state.objectsRls||!state.bucketsRls||state.bypass)throw new Error('Storage RLS or ordinary role boundary is unsafe');
 for(const p of state.policies){const insert=p.policyname==='brand_logo_write_own_prefix'&&p.cmd==='INSERT'&&p.qual===null&&normalize(p.with_check)===logoExpression;const update=p.policyname==='brand_logo_update_own_prefix'&&p.cmd==='UPDATE'&&normalize(p.qual)===logoExpression&&p.with_check===null;if(p.tablename!=='objects'||(!insert&&!update))throw new Error('Unrecognized effective Storage policy; review the full access rule');}
}
