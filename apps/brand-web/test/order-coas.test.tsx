import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { OrderCertificates } from '../src/screens/coas/OrderCertificates.js';
const f=vi.hoisted(()=>({api:vi.fn()}));vi.mock('../src/lib/api.js',()=>({api:f.api}));afterEach(()=>{cleanup();vi.resetAllMocks();});
it('shows exact shipped lot quantities and withdrawn historical references',async()=>{
 f.api.mockResolvedValue({readiness:'ready',reason:null,allocations:[{id:'a',sku:'SKU',lotCode:'A',qty:3,reportNumber:'R1',status:'published',url:'https://backend.test/coa/a'},{id:'b',sku:'SKU',lotCode:'B',qty:9,reportNumber:'R2',status:'withdrawn',url:null}]});
 render(<OrderCertificates orderId="o" onClose={()=>{}}/>);expect(await screen.findByText('SKU · 3 units')).toBeTruthy();expect(screen.getByText('SKU · 9 units')).toBeTruthy();expect(screen.getByText(/report was withdrawn/)).toBeTruthy();expect(screen.getAllByRole('link',{name:'View report'})).toHaveLength(1);
});
