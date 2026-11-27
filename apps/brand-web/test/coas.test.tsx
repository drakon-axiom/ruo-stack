import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { Coas } from '../src/screens/Coas.js';
const f=vi.hoisted(()=>({api:vi.fn()}));
vi.mock('../src/lib/api.js',()=>({api:f.api}));
vi.mock('../src/screens/coas/CertificateLibrary.js',()=>({CertificateLibrary:()=>null}));
afterEach(()=>{cleanup();vi.resetAllMocks();});
it('shows opaque references without linking or claiming verification',async()=>{
 f.api.mockResolvedValue({products:[{id:'1',name:'Product',coaId:'COA-123'}]});
 render(<Coas/>); expect(await screen.findByText('COA-123')).toBeTruthy();
 expect(screen.queryByRole('link')).toBeNull(); expect(screen.queryByText(/third.party verified/i)).toBeNull();
});
it('retries a failed list and exposes only safe links',async()=>{
 f.api.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({products:[{id:'1',name:'Product',coaId:'https://example.com/report.pdf'}]});
 render(<Coas/>); fireEvent.click(await screen.findByRole('button',{name:'Retry'}));
 expect((await screen.findByRole('link',{name:'View'})).getAttribute('href')).toBe('https://example.com/report.pdf');
});
