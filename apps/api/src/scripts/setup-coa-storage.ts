import {validateCoaStorageBoundary} from '../services/coa-storage-policy.ts';
import { COA_MAX_BYTES } from '@ruostack/shared';
import { getClients } from '../clients.ts';
import { COA_BUCKET } from '../services/coa-storage.ts';
const {supabaseAdmin,prisma}=getClients();
const policies=await prisma.$queryRaw<{tablename:string;policyname:string;cmd:string;qual:string|null;with_check:string|null}[]>`SELECT tablename,policyname,cmd,qual,with_check FROM pg_policies p WHERE schemaname='storage' AND permissive='PERMISSIVE' AND EXISTS (SELECT 1 FROM unnest(p.roles) r WHERE CASE WHEN r='public' THEN true ELSE pg_has_role('anon',r,'MEMBER') OR pg_has_role('authenticated',r,'MEMBER') END)`;
const tables=await prisma.$queryRaw<{relname:string;relrowsecurity:boolean}[]>`SELECT c.relname,c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='storage' AND c.relname IN ('objects','buckets')`;
const roles=await prisma.$queryRaw<{unsafe:boolean}[]>`SELECT EXISTS(SELECT 1 FROM pg_roles WHERE (rolbypassrls OR rolsuper) AND (pg_has_role('anon',rolname,'MEMBER') OR pg_has_role('authenticated',rolname,'MEMBER'))) AS unsafe`;
validateCoaStorageBoundary({objectsRls:tables.some(t=>t.relname==='objects'&&t.relrowsecurity),bucketsRls:tables.some(t=>t.relname==='buckets'&&t.relrowsecurity),bypass:roles[0]?.unsafe??true,policies});
await prisma.$disconnect();
const {data,error}=await supabaseAdmin.storage.getBucket(COA_BUCKET);
if(error && !['404','400'].includes(String(error.statusCode)))throw error;
if(!data){const result=await supabaseAdmin.storage.createBucket(COA_BUCKET,{public:false,fileSizeLimit:COA_MAX_BYTES,allowedMimeTypes:['application/pdf']});if(result.error)throw result.error;}
else if(data.public)throw new Error('COA bucket is public; stop rollout and revoke public access before continuing');
else {const result=await supabaseAdmin.storage.updateBucket(COA_BUCKET,{public:false,fileSizeLimit:COA_MAX_BYTES,allowedMimeTypes:['application/pdf']});if(result.error)throw result.error;}
console.log('COA private bucket configured. Verify anonymous and authenticated access denials before enabling uploads.');
