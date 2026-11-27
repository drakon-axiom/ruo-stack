import { useState } from 'react';
import { COA_MAX_BYTES } from '@ruostack/shared';
import { Button, Field, Input } from '@ruostack/ui';
import { api } from '../../lib/api.js';
export function CoaUpload({productId,documentId,onSaved}:{productId:string;documentId?:string;onSaved:()=>void}){
 const [file,setFile]=useState<File|null>(null);const [lab,setLab]=useState('');const [report,setReport]=useState('');const [date,setDate]=useState('');const [busy,setBusy]=useState(false);const [error,setError]=useState('');
 const [pending,setPending]=useState<{revisionId:string;uploadUrl:string;uploaded:boolean}|null>(null);
 async function upload(){setError('');setBusy(true);try{
  if(!file || file.size>COA_MAX_BYTES || !file.name.toLowerCase().endsWith('.pdf'))throw new Error('Choose a PDF up to 10 MiB.');
  let target=pending;
  if(!target){const created=await api<{revisionId:string;uploadUrl:string}>('/api/admin/coas/upload',{method:'POST',body:{productId,documentId,filename:file.name,sizeBytes:file.size,lab,reportNumber:report,testDate:date}});target={...created,uploaded:false};setPending(target);}
  if(!target.uploaded){const result=await fetch(target.uploadUrl,{method:'PUT',headers:{'Content-Type':'application/pdf'},body:file});if(!result.ok)throw new Error('PDF upload failed. Retry or start a new revision if the upload link expired.');target={...target,uploaded:true};setPending(target);}
  await api(`/api/admin/coas/${target.revisionId}/finalize`,{method:'POST'});setPending(null);setFile(null);onSaved();
 }catch(e){setError(e instanceof Error?e.message:'Upload failed');}finally{setBusy(false);}}
 return <section className="space-y-3 border-t pt-4"><h3 className="font-semibold">{documentId?'New revision':'Upload certificate'}</h3>
 <Field label="Laboratory"><Input aria-label="Laboratory" value={lab} disabled={!!pending||busy} onChange={e=>setLab(e.target.value)}/></Field>
 <Field label="Report number"><Input aria-label="Report number" value={report} disabled={!!pending||busy} onChange={e=>setReport(e.target.value)}/></Field>
 <Field label="Test date"><Input aria-label="Test date" type="date" value={date} disabled={!!pending||busy} onChange={e=>setDate(e.target.value)}/></Field>
 <label className="block text-sm">PDF (up to 10 MiB)<input aria-label="Certificate PDF" className="block" type="file" accept="application/pdf,.pdf" disabled={!!pending||busy} onChange={e=>setFile(e.target.files?.[0]??null)}/></label>
 {error&&<p role="alert">{error}</p>}
 <Button onClick={upload} disabled={!file||!lab||!report||!date||busy}>{pending?'Retry upload':'Upload PDF'}</Button>
 {pending&&<Button variant="ghost" disabled={busy} onClick={()=>{setPending(null);setError('');}}>Start new revision</Button>}
 </section>;
}
