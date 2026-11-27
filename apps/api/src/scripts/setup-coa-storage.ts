import { COA_MAX_BYTES } from '@ruostack/shared';
import { getClients } from '../clients.ts';
import { COA_BUCKET } from '../services/coa-storage.ts';
const {supabaseAdmin,prisma}=getClients();
const policies=await prisma.$queryRaw<{tablename:string;cmd:string;qual:string|null;with_check:string|null}[]>`SELECT tablename,cmd,qual,with_check FROM pg_policies WHERE schemaname='storage' AND permissive='PERMISSIVE' AND roles && ARRAY['anon','authenticated','public']::name[]`;
for(const p of policies){
 const clauses=[p.qual,p.with_check].filter((v):v is string=>!!v);
 if(p.tablename!=='objects'||!['INSERT','UPDATE'].includes(p.cmd)||!clauses.length||clauses.some(v=>!v.startsWith("((bucket_id = 'brand-logos'::text) AND ")))throw new Error('Unrecognized permissive Storage policy; review COA bucket access before provisioning');
}
await prisma.$disconnect();
const {data,error}=await supabaseAdmin.storage.getBucket(COA_BUCKET);
if(error && !['404','400'].includes(String(error.statusCode)))throw error;
if(!data){const result=await supabaseAdmin.storage.createBucket(COA_BUCKET,{public:false,fileSizeLimit:COA_MAX_BYTES,allowedMimeTypes:['application/pdf']});if(result.error)throw result.error;}
else if(data.public)throw new Error('COA bucket is public; stop rollout and revoke public access before continuing');
else {const result=await supabaseAdmin.storage.updateBucket(COA_BUCKET,{public:false,fileSizeLimit:COA_MAX_BYTES,allowedMimeTypes:['application/pdf']});if(result.error)throw result.error;}
console.log('COA private bucket configured. Verify anonymous and authenticated access denials before enabling uploads.');
