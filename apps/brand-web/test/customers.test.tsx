import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CustomerDrawer } from '../src/screens/customers/CustomerDrawer.js';
import { Customers } from '../src/screens/Customers.js';
const f=vi.hoisted(()=>({api:vi.fn()}));
vi.mock('../src/lib/api.js',()=>({api:f.api}));
const customer={key:'a@test',name:'Dana Reyes',email:'a@test',phone:null,city:'Austin',state:'TX',country:'US',orders:2,spend_cents:2500,first_order:'2026-01-01',last_order:'2026-08-01',last_status:'shipped',last_blocker:'none',last_exported_at:null,ship_to:null,order_list:[]};
const history={id:'o1',status:'shipped',blocker:'none',wallet_charge_cents:1250,tracking_number:'TRACK-123',exported_at:null,created_at:'2026-08-01'};
beforeEach(()=>{vi.resetAllMocks();});
afterEach(cleanup);
const show=()=>render(<MemoryRouter><Customers /></MemoryRouter>);
it('loads summaries first and fetches history only when a customer is opened',async()=>{
  f.api.mockResolvedValueOnce({customers:[customer],totals:{customers:1,orders:2,spend_cents:2500,truncated:true}})
    .mockResolvedValueOnce({customers:[{...customer,order_list:[history]}],totals:{truncated:true}});
  show(); fireEvent.click(await screen.findByText('Dana Reyes'));
  expect(await screen.findByText('TRACK-123')).toBeTruthy();
  expect(f.api.mock.calls.map(c=>c[0])).toEqual(['/api/brand/customers?view=summary','/api/brand/customers?view=history&customer_key=a%40test']);
  expect(screen.getAllByText(/most recent 5,000 orders/i).length).toBeGreaterThan(0);
});
it('shows a history error and lets the user retry',async()=>{
  f.api.mockResolvedValueOnce({customers:[customer],totals:{customers:1,orders:2,spend_cents:2500,truncated:false}})
    .mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({customers:[{...customer,order_list:[history]}],totals:{truncated:false}});
  show(); fireEvent.click(await screen.findByText('Dana Reyes'));
  expect(await screen.findByText('Could not load order history.')).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'Retry history'}));
  expect(await screen.findByText('TRACK-123')).toBeTruthy();
});
it('handles a failed customer list without leaving an endless loading state',async()=>{
  f.api.mockRejectedValueOnce(new Error('offline'));
  show(); await waitFor(()=>expect(screen.getByText('Could not load customers.')).toBeTruthy());
});

it('ignores a previous customer history response after switching customers',async()=>{
  let resolveOld!: (value: unknown)=>void;
  f.api.mockImplementationOnce(()=>new Promise(resolve=>{resolveOld=resolve;}))
    .mockResolvedValueOnce({customers:[{...customer,key:'b@test',order_list:[{...history,tracking_number:'NEW-TRACK'}]}],totals:{truncated:false}});
  const props={onClose:()=>{},onShipAgain:()=>{}};
  const view=render(<CustomerDrawer {...props} customer={customer} />);
  view.rerender(<CustomerDrawer {...props} customer={{...customer,key:'b@test',name:'Other'}} />);
  expect(await screen.findByText('NEW-TRACK')).toBeTruthy();
  await act(async()=>{resolveOld({customers:[{...customer,order_list:[history]}],totals:{truncated:false}});});
  expect(screen.queryByText('TRACK-123')).toBeNull();
  expect(screen.getByText('NEW-TRACK')).toBeTruthy();
});
