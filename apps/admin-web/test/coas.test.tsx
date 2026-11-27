import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ProductCoas } from '../src/screens/catalog/ProductCoas.js';
const f=vi.hoisted(()=>({api:vi.fn()}));vi.mock('../src/lib/api.js',()=>({api:f.api}));
afterEach(()=>{cleanup();vi.resetAllMocks();});
const row={id:'r1',documentId:'d1',filename:'test.pdf',lab:'Lab',reportNumber:'Report1',testDate:'2026-11-01',status:'awaiting_review'};
it('requires review before publishing and hides changes from read-only roles',async()=>{
 f.api.mockResolvedValue({revisions:[row]});const v=render(<ProductCoas productId="p1" writable/>);
 expect(await screen.findByText('Report1')).toBeTruthy();expect(screen.queryByRole('button',{name:'Publish'})).toBeNull();
 expect(screen.getByRole('button',{name:'Approve review'})).toBeTruthy();
 v.rerender(<ProductCoas productId="p1" writable={false}/>);expect(screen.queryByRole('button',{name:'Approve review'})).toBeNull();expect(screen.queryByText('Upload PDF')).toBeNull();
});
it('shows failed finalization and retries without creating another revision',async()=>{
 f.api.mockResolvedValueOnce({revisions:[{...row,status:'draft'}]}).mockRejectedValueOnce(new Error('Not uploaded')).mockResolvedValueOnce({}).mockResolvedValueOnce({revisions:[row]});
 render(<ProductCoas productId="p1" writable/>);fireEvent.click(await screen.findByRole('button',{name:'Finalize upload'}));
 expect(await screen.findByRole('alert')).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:'Finalize upload'}));expect(await screen.findByRole('button',{name:'Approve review'})).toBeTruthy();
});
it('suppresses stale product responses',async()=>{
 let done!:(v:unknown)=>void;f.api.mockImplementationOnce(()=>new Promise(r=>done=r)).mockResolvedValueOnce({revisions:[{...row,reportNumber:'New report'}]});
 const v=render(<ProductCoas productId="p1" writable/>);v.rerender(<ProductCoas productId="p2" writable/>);
 expect(await screen.findByText('New report')).toBeTruthy();await act(async()=>done({revisions:[row]}));expect(screen.queryByText('Report1')).toBeNull();
});
it('creates a replacement under the same document and retries finalization after upload',async()=>{
 f.api.mockResolvedValueOnce({revisions:[{...row,status:'published'}]}).mockResolvedValueOnce({revisionId:'r2',uploadUrl:'https://storage.test/upload'}).mockRejectedValueOnce(new Error('Finalize unavailable')).mockResolvedValueOnce({}).mockResolvedValueOnce({revisions:[{...row,id:'r2',status:'awaiting_review'}]});
 const fetchMock=vi.fn().mockResolvedValue({ok:true});vi.stubGlobal('fetch',fetchMock);
 render(<ProductCoas productId="p1" writable/>);fireEvent.click(await screen.findByRole('button',{name:'Add revision'}));
 fireEvent.change(screen.getByLabelText('Laboratory'),{target:{value:'Lab'}});fireEvent.change(screen.getByLabelText('Report number'),{target:{value:'R2'}});fireEvent.change(screen.getByLabelText('Test date'),{target:{value:'2026-11-01'}});
 fireEvent.change(screen.getByLabelText('Certificate PDF'),{target:{files:[new File(['%PDF-1.7\n%%EOF'],'report.pdf',{type:'application/pdf'})]}});
 fireEvent.click(screen.getByRole('button',{name:'Upload PDF'}));expect(await screen.findByText('Finalize unavailable')).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:'Retry upload'}));
 expect(await screen.findByRole('button',{name:'Approve review'})).toBeTruthy();expect(fetchMock).toHaveBeenCalledTimes(1);
 expect(f.api.mock.calls.find(c=>c[0]==='/api/admin/coas/upload')?.[1].body.documentId).toBe('d1');vi.unstubAllGlobals();
});
