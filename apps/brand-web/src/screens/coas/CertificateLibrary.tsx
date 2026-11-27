import { useEffect, useState } from 'react';
import { Button, Input } from '@ruostack/ui';
import { api } from '../../lib/api.js';
interface Certificate {id:string;product:string;lotCodes:string[];reportNumber:string;lab:string;testDate:string;status:string;url:string|null}
export function CertificateLinks({url}:{url:string|null}){const [copied,setCopied]=useState(false);return url?<span className="flex flex-wrap gap-3"><a className="underline" target="_blank" rel="noreferrer" href={url}>View report</a><a className="underline" target="_blank" rel="noreferrer" href={`${url}/download`}>Download PDF</a><Button size="sm" variant="ghost" onClick={()=>navigator.clipboard.writeText(url).then(()=>setCopied(true)).catch(()=>setCopied(false))}>{copied?'Copied':'Copy link'}</Button></span>:<span>Not publicly available</span>;}
export function CertificateLibrary(){
 const [search,setSearch]=useState('');const [from,setFrom]=useState('');const [to,setTo]=useState('');const [offset,setOffset]=useState(0);const [version,setVersion]=useState(0);const [data,setData]=useState<{total:number;certificates:Certificate[]}>();const [error,setError]=useState(false);
 useEffect(()=>{let active=true;setData(undefined);setError(false);const q=new URLSearchParams({search,offset:String(offset),limit:'25',...(from?{from}:{}),...(to?{to}:{})});api<{total:number;certificates:Certificate[]}>(`/api/brand/coas?${q}`).then(r=>{if(active)setData(r);}).catch(()=>{if(active)setError(true);});return ()=>{active=false;};},[search,from,to,offset,version]);
 return <section className="mb-8 space-y-3"><h2 className="text-lg font-semibold">Published product references</h2><p>These reports describe products and lots. See an order’s COAs for the quantities actually shipped.</p>
 <Input aria-label="Search certificates" placeholder="Product, lot, laboratory or report" value={search} onChange={e=>{setSearch(e.target.value);setOffset(0);}}/>
 <div className="flex gap-3"><label>Tested from<Input type="date" value={from} onChange={e=>{setFrom(e.target.value);setOffset(0);}}/></label><label>Tested through<Input type="date" value={to} onChange={e=>{setTo(e.target.value);setOffset(0);}}/></label></div>
 {error?<p role="alert">Could not load published certificates. <Button onClick={()=>setVersion(v=>v+1)}>Retry certificates</Button></p>:!data?<p>Loading published certificates…</p>:<>
 {!data.certificates?.length&&<p>No published documents match.</p>}
 {data.certificates?.map(c=><article key={c.id} className="rounded border p-4 space-y-2"><h3 className="font-semibold">{c.product} — {c.reportNumber}</h3><p>{c.lab} · {c.testDate} · {c.status}</p><p>{c.lotCodes.length?`Reference lots: ${c.lotCodes.join(', ')}`:'Product reference; no released lot listed'}</p><CertificateLinks url={c.url}/></article>)}
 <div className="flex gap-3"><Button disabled={offset===0} onClick={()=>setOffset(n=>Math.max(0,n-25))}>Previous</Button><span>{data.total} reports</span><Button disabled={offset+25>=data.total} onClick={()=>setOffset(n=>n+25)}>Next</Button></div>
 </>}
 </section>;
}
