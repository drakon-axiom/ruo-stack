import { getClients } from '../clients.ts';
import type { CoaStorage } from './coa-documents.ts';
export const COA_BUCKET='coa-private';
export function coaStorage():CoaStorage {
 const bucket=getClients().supabaseAdmin.storage.from(COA_BUCKET);
 return {
  async signUpload(key){const {data,error}=await bucket.createSignedUploadUrl(key,{upsert:false});if(error)throw error;return data.signedUrl;},
  async read(key){const {data,error}=await bucket.download(key);if(error)throw error;return {bytes:Buffer.from(await data.arrayBuffer()),type:data.type};},
  async write(key,bytes){const {error}=await bucket.upload(key,bytes,{contentType:'application/pdf',upsert:false});if(error)throw error;},
  async remove(key){const {error}=await bucket.remove([key]);if(error)throw error;},
  async signDownload(key,seconds){const {data,error}=await bucket.createSignedUrl(key,seconds,{download:true});if(error)throw error;return data.signedUrl;},
 };
}
