import { useEffect, useState } from 'react';
import { Button, Drawer } from '@ruostack/ui';
import { api } from '../../lib/api.js';
import { CertificateLinks } from './CertificateLibrary.js';
interface Data {readiness:string;reason:string|null;allocations:{id:string;sku:string;qty:number;lotCode:string;reportNumber:string;status:string;url:string|null;originalLotCode?:string|null;correctionReason?:string|null}[]}
export function OrderCertificates({orderId,onClose}:{orderId:string;onClose:()=>void}){
 const [data,setData]=useState<Data>();const [error,setError]=useState(false);const [version,setVersion]=useState(0);
 useEffect(()=>{let active=true;setData(undefined);setError(false);api<Data>(`/api/brand/orders/${orderId}/coas`).then(r=>{if(active)setData(r);}).catch(()=>{if(active)setError(true);});return ()=>{active=false;};},[orderId,version]);
 return <Drawer open title="Certificates shipped with this order" onOpenChange={o=>{if(!o)onClose();}}>
 {error?<p role="alert">Could not load order certificates. <Button onClick={()=>setVersion(v=>v+1)}>Retry</Button></p>:!data?<p>Loading…</p>:<div className="space-y-4">
 {data.reason&&<p>{data.reason}</p>}{!data.allocations.length&&<p>{data.readiness==='exception'?'Lot traceability is unresolved for this shipment.':data.readiness==='untracked'?'No historical lot assignments are recorded for this order.':'Certificates will appear after warehouse confirmation and shipment.'}</p>}
 {data.allocations.map(a=><article key={a.id} className="border rounded p-3"><h3>{a.sku} · {a.qty} units</h3><p>Lot {a.lotCode} · Report {a.reportNumber} · {a.status}</p>{a.originalLotCode&&<p>Corrected from recorded lot {a.originalLotCode}: {a.correctionReason}</p>}{a.status==='withdrawn'?<p>This report was withdrawn. The original shipment reference is retained.</p>:<CertificateLinks url={a.url}/>}</article>)}
 </div>}
 </Drawer>;
}
