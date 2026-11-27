import { COA_MAX_BYTES } from '@ruostack/shared';
import { getClients } from '../clients.ts';
import { COA_BUCKET } from '../services/coa-storage.ts';
const {supabaseAdmin}=getClients();
const {data,error}=await supabaseAdmin.storage.getBucket(COA_BUCKET);
if(error && !['404','400'].includes(String(error.statusCode)))throw error;
if(!data){const result=await supabaseAdmin.storage.createBucket(COA_BUCKET,{public:false,fileSizeLimit:COA_MAX_BYTES,allowedMimeTypes:['application/pdf']});if(result.error)throw result.error;}
else if(data.public)throw new Error('COA bucket is public; stop rollout and revoke public access before continuing');
else {const result=await supabaseAdmin.storage.updateBucket(COA_BUCKET,{public:false,fileSizeLimit:COA_MAX_BYTES,allowedMimeTypes:['application/pdf']});if(result.error)throw result.error;}
console.log('COA private bucket configured. Verify anonymous and authenticated access denials before enabling uploads.');
