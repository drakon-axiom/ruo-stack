import { useEffect, useRef, useState } from 'react';
import type { CoaRevisionDto } from '@ruostack/shared';
import { Button } from '@ruostack/ui';
import { api } from '../../lib/api.js';
import { CoaUpload } from './CoaUpload.js';
export function ProductCoas({productId,writable}:{productId:string;writable:boolean}){
 const [rows,setRows]=useState<CoaRevisionDto[]>([]);const [error,setError]=useState('');const [busy,setBusy]=useState(false);const [loading,setLoading]=useState(true);const [version,setVersion]=useState(0);const [documentId,setDocumentId]=useState<string>();const generation=useRef(0);
 useEffect(()=>{const g=++generation.current;setRows([]);setError('');setDocumentId(undefined);setLoading(true);setBusy(false);
 api<{revisions:CoaRevisionDto[]}>(`/api/admin/catalog/${productId}/coas`).then(r=>{if(g===generation.current)setRows(r.revisions);}).catch(()=>{if(g===generation.current)setError('Could not load certificates.');}).finally(()=>{if(g===generation.current)setLoading(false);});
 return ()=>{generation.current++;};},[productId,version]);
 async function action(id:string,name:string,body?:unknown){const g=generation.current;setBusy(true);setError('');try{
 const result=await api<{url?:string}>(`/api/admin/coas/${id}/${name}`,{method:'POST',body});if(g!==generation.current)return;
 if(result.url)window.open(result.url,'_blank','noopener,noreferrer');else setVersion(v=>v+1);
 }catch(e){if(g===generation.current)setError(e instanceof Error?e.message:'Action failed');}finally{if(g===generation.current)setBusy(false);}}
 return <section className="space-y-3 border-t pt-4"><h2 className="text-lg font-semibold">Certificates of Analysis</h2>
 <p className="text-sm text-muted">Operator review and publication are separate steps. New revisions preserve earlier reports.</p>
 {loading&&<p>Loading certificates…</p>}{error&&<p role="alert">{error} <Button onClick={()=>setVersion(v=>v+1)}>Reload certificates</Button></p>}
 {!loading&&!error&&!rows.length&&<p>No certificate documents yet.</p>}
 {rows.map(r=><article key={r.id} className="space-y-2 rounded border p-3"><h3 className="font-medium">{r.reportNumber}</h3><p>{r.lab} · {r.testDate} · {r.status.replaceAll('_',' ')}</p><p className="text-sm">{r.filename}</p>{r.withdrawalReason&&<p>{r.withdrawalReason}</p>}
 <div className="flex flex-wrap gap-2">
 {!['draft','abandoned'].includes(r.status)&&<Button variant="ghost" disabled={busy} onClick={()=>action(r.id,'download')}>Download PDF</Button>}
 {writable&&<>
 {r.status==='draft'&&<Button disabled={busy} onClick={()=>action(r.id,'finalize')}>Finalize upload</Button>}
 {r.status==='awaiting_review'&&<><Button disabled={busy} onClick={()=>action(r.id,'review',{decision:'approved'})}>Approve review</Button><Button disabled={busy} onClick={()=>action(r.id,'review',{decision:'rejected'})}>Reject</Button></>}
 {r.status==='reviewed'&&<Button disabled={busy} onClick={()=>action(r.id,'publish')}>Publish</Button>}
 {['published','reviewed'].includes(r.status)&&<Button disabled={busy} onClick={()=>{const reason=window.prompt('Reason for withdrawing this certificate');if(reason?.trim())void action(r.id,'withdraw',{reason});}}>Withdraw</Button>}
 <Button variant="ghost" disabled={busy} onClick={()=>setDocumentId(r.documentId)}>Add revision</Button>
 </>}
 </div></article>)}
 {writable&&<CoaUpload key={`${productId}:${documentId??'new'}`} productId={productId} documentId={documentId} onSaved={()=>setVersion(v=>v+1)}/>}
 </section>;
}
