import { useEffect, useState } from 'react';
import { Button, Drawer, Input } from '@ruostack/ui';
import { api } from '../../lib/api.js';
interface Details {readiness:string;status:string;reason:string|null;items:{id:string;productId:string;sku:string;qty:number}[];lots:{id:string;productId:string;lotCode:string;state:string;available:number;reportNumber:string;certificateStatus:string}[];allocations:{id:string;orderItemId:string;lotCode:string;qty:number;state:string}[]}
export function OrderLots({orderId,writable,onClose}:{orderId:string;writable:boolean;onClose:()=>void}){
 const [data,setData]=useState<Details>();const [error,setError]=useState('');const [busy,setBusy]=useState(false);const [version,setVersion]=useState(0);const [counts,setCounts]=useState<Record<string,string>>({});const [reason,setReason]=useState('');const [key,setKey]=useState(()=>crypto.randomUUID());
 useEffect(()=>{let active=true;setError('');api<Details>(`/api/admin/orders/${orderId}/lots`).then(d=>{if(active)setData(d);}).catch(()=>{if(active)setError('Could not load order lots');});return ()=>{active=false;};},[orderId,version]);
 async function run(action:string){setBusy(true);setError('');try{const allocations=(data?.items??[]).flatMap(i=>(data?.lots??[]).filter(l=>l.productId===i.productId).flatMap(l=>{const qty=Number(counts[`${i.id}:${l.id}`]??0);return qty?[{orderItemId:i.id,lotId:l.id,qty}]:[];}));await api(`/api/admin/orders/${orderId}/lots/${action}`,{method:'POST',body:{key,allocations,reason:reason||undefined}});setVersion(v=>v+1);setKey(crypto.randomUUID());setCounts({});}catch(e){setError(e instanceof Error?e.message:'Lot action failed');}finally{setBusy(false);}}
 const terminal=data&&['shipped','delivered'].includes(data.status);const resolve=terminal&&data?.readiness==='exception';
 return <Drawer open title="Warehouse lots and certificates" onOpenChange={o=>{if(!o)onClose();}}>
 {error&&<p role="alert">{error} <Button onClick={()=>setVersion(v=>v+1)}>Retry</Button></p>}
 {!data?<p>Loading…</p>:<div className="space-y-4"><p>Status: {data.readiness.replaceAll('_',' ')}</p>{data.reason&&<p>{data.reason}</p>}
 {data.allocations.map(a=><p key={a.id}>{a.lotCode} × {a.qty} · {a.state}</p>)}
 {data.readiness==='untracked'&&<p>No lot traceability is recorded for this order.</p>}
 {writable&&(!terminal||resolve)&&<>
 <p>Select the physical lots packed by the warehouse. Quantities must cover each tracked SKU in full.</p>
 {data.items.map(i=><fieldset key={i.id} className="border p-3"><legend>{i.sku} — {i.qty} units</legend>{data.lots.filter(l=>l.productId===i.productId).map(l=><label key={l.id} className="block my-2">{l.lotCode} · {l.available} available · {l.state} · {l.reportNumber} ({l.certificateStatus})<Input aria-label={`${i.sku} ${l.lotCode} units`} type="number" min="0" max={i.qty} value={counts[`${i.id}:${l.id}`]??''} onChange={e=>{setCounts(c=>({...c,[`${i.id}:${l.id}`]:e.target.value}));setKey(crypto.randomUUID());}}/></label>)}</fieldset>)}
 {resolve&&<Input aria-label="Warehouse evidence" placeholder="Warehouse evidence / correction reason" value={reason} onChange={e=>setReason(e.target.value)}/>}
 <Button disabled={busy||!data.items.length||(!!resolve&&!reason.trim())} onClick={()=>run(resolve?'resolve':'confirm')}>{resolve?'Record late warehouse evidence':'Confirm physical lots'}</Button>
 {!terminal&&data.allocations.length>0&&<Button variant="ghost" disabled={busy} onClick={()=>run('release')}>Release reservations</Button>}
 </>}
 </div>}
 </Drawer>;
}
