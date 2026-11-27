import { useEffect, useState } from 'react';
import { Button, Input } from '@ruostack/ui';
import type { CoaRevisionDto } from '@ruostack/shared';
import { api } from '../../lib/api.js';
interface Lot {id:string;lotCode:string;state:string;onHand:number;reserved:number;available:number;received:number;shipped:number}
export function ProductLots({productId,writable}:{productId:string;writable:boolean}){
 const [data,setData]=useState<{lotTracking:boolean;lots:Lot[]}>();const [coas,setCoas]=useState<CoaRevisionDto[]>([]);const [code,setCode]=useState('');const [qty,setQty]=useState('');const [coa,setCoa]=useState('');const [error,setError]=useState('');const [busy,setBusy]=useState(false);const [version,setVersion]=useState(0);const [key,setKey]=useState(()=>crypto.randomUUID());
 useEffect(()=>{let active=true;setError('');Promise.all([api<{lotTracking:boolean;lots:Lot[]}>(`/api/admin/catalog/${productId}/lots`),api<{revisions:CoaRevisionDto[]}>(`/api/admin/catalog/${productId}/coas`)]).then(([d,c])=>{if(active){setData(d);setCoas(c.revisions.filter(r=>['reviewed','published'].includes(r.status)));}}).catch(()=>{if(active)setError('Could not load lot inventory');});return ()=>{active=false;};},[productId,version]);
 async function run(path:string,body:unknown){setBusy(true);setError('');try{await api(path,{method:'POST',body});setVersion(v=>v+1);setKey(crypto.randomUUID());}catch(e){setError(e instanceof Error?e.message:'Inventory action failed');}finally{setBusy(false);}}
 return <section className="space-y-3 border-t pt-4"><h2 className="text-lg font-semibold">Lot inventory</h2><p>Quantities are sellable SKU units. Tracking: {data?.lotTracking?'enabled':'not enabled'}.</p>
 {error&&<p role="alert">{error} <Button onClick={()=>setVersion(v=>v+1)}>Retry lots</Button></p>}
 {data?.lots.map(l=><article key={l.id} className="border rounded p-3"><strong>{l.lotCode}</strong> · {l.state}<p>Received {l.received} · On hand {l.onHand} · Reserved {l.reserved} · Available {l.available} · Shipped {l.shipped}</p>
 {writable&&<div className="flex flex-wrap gap-2">{(['released','quarantined','recalled'] as const).filter(s=>s!==l.state).map(s=><Button key={s} disabled={busy} onClick={()=>{const reason=prompt(`Reason for ${s}`);if(reason)void run(`/api/admin/lots/${l.id}/state`,{state:s,reason});}}>{s}</Button>)}<Button disabled={busy} onClick={()=>{const delta=prompt('Signed quantity adjustment (returns must be received in a new quarantined lot)');if(!delta)return;const reason=prompt('Reason for adjustment');if(reason)void run(`/api/admin/lots/${l.id}/adjust`,{delta:Number(delta),reason,key});}}>Adjust count</Button></div>}
 </article>)}
 {writable&&<><h3 className="font-semibold">Receive a lot</h3><Input aria-label="Lot code" placeholder="Physical lot code" value={code} onChange={e=>{setCode(e.target.value);setKey(crypto.randomUUID());}}/><Input aria-label="Received units" type="number" min="1" placeholder="Received units" value={qty} onChange={e=>{setQty(e.target.value);setKey(crypto.randomUUID());}}/>
 <select aria-label="Lot certificate" className="w-full rounded border p-2 bg-surface" value={coa} onChange={e=>{setCoa(e.target.value);setKey(crypto.randomUUID());}}><option value="">Choose reviewed certificate</option>{coas.map(c=><option key={c.id} value={c.id}>{c.reportNumber} · {c.testDate}</option>)}</select>
 <Button disabled={busy||!code||!qty||!coa} onClick={()=>run('/api/admin/lots/receive',{productId,lotCode:code,qty:Number(qty),coaRevisionId:coa,key})}>Receive into quarantine</Button>
 {!data?.lotTracking&&<Button disabled={busy||!data?.lots.length} onClick={()=>{const reason=prompt('Confirm physical opening quantities and lot/PDF mappings are reconciled. Record reconciliation reference:');if(reason)void run(`/api/admin/catalog/${productId}/enable-lot-tracking`,{reconciled:true,reason});}}>Enable reconciled SKU tracking</Button>}
 </>}
 </section>;
}
