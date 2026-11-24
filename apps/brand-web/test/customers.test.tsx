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
  f.api.mockResolvedValueOnce({customers:[customer],totals:{customers:1,orders:2,spend_cents:2500,truncated:false}})
    .mockResolvedValueOnce({customers:[{...customer,order_list:[history]}],totals:{truncated:false}});
  show(); fireEvent.click(await screen.findByText('Dana Reyes'));
  expect(await screen.findByText('TRACK-123')).toBeTruthy();
  expect(f.api.mock.calls).toEqual([['/api/brand/customers/search',{method:'POST',body:{search:'',sort:'recent',offset:0,limit:50}}],['/api/brand/customers/history/page',{method:'POST',body:{customer_key:'a@test',limit:50}}]]);
  expect(screen.queryByText(/most recent 5,000 orders/i)).toBeNull();
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

it('uses refreshed details and address for Ship again after history loads',async()=>{
  let complete!: (value: unknown)=>void;
  f.api.mockImplementationOnce(()=>new Promise(resolve=>{complete=resolve;}));
  const address={recipient_name:'Dana Reyes',recipient_email:'a@test',address1:'Old address',address2:null,city:'Austin',state:'TX',zip:'78701',country:'US'};
  const initial={...customer,ship_to:address};
  const latest={...initial,orders:3,ship_to:{...address,address1:'New address'},order_list:[history]};
  const ship=vi.fn();
  render(<CustomerDrawer customer={initial} onClose={()=>{}} onShipAgain={ship} />);
  expect(screen.queryByRole('button',{name:'Ship again'})).toBeNull();
  await act(async()=>{complete({customers:[latest],totals:{truncated:false}});});
  expect(screen.getByText('3')).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'Ship again'}));
  expect(ship).toHaveBeenCalledWith(latest);
});

it('pages the customer list on the server and searches outside the current page',async()=>{
  f.api.mockResolvedValueOnce({customers:[customer],totals:{customers:51,orders:100,spend_cents:10000,truncated:false},page:{offset:0,limit:50,total:51,has_more:true}})
    .mockResolvedValueOnce({customers:[{...customer,key:'last',name:'Last customer'}],totals:{customers:51,orders:100,spend_cents:10000,truncated:false},page:{offset:50,limit:50,total:51,has_more:false}})
    .mockResolvedValueOnce({customers:[],totals:{customers:51,orders:100,spend_cents:10000,truncated:false},page:{offset:0,limit:50,total:0,has_more:false}});
  show(); await screen.findByText('Dana Reyes');
  fireEvent.click(screen.getByRole('button',{name:'Next page'}));
  await screen.findByText('Last customer');
  expect(f.api.mock.calls[1]![1].body.offset).toBe(50);
  fireEvent.change(screen.getByLabelText('Search customers'),{target:{value:'no match'}});
  await screen.findByText('No customers match “no match”');
  expect(f.api.mock.calls[2]![1].body).toMatchObject({search:'no match',offset:0});
  expect(screen.getByLabelText('Search customers')).toBeTruthy();
});
it('loads older history with a cursor and retains earlier rows when retrying',async()=>{
  const cursor={id:'00000000-0000-4000-8000-000000000001',created_at:'2026-08-01T00:00:00.000Z'};
  f.api.mockResolvedValueOnce({customers:[{...customer,order_list:[history]}],totals:{truncated:false},page:{has_more:true,next_cursor:cursor}})
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce({customers:[{...customer,order_list:[{...history,id:'old',tracking_number:'OLDER-TRACK'}]}],totals:{truncated:false},page:{has_more:false,next_cursor:null}});
  render(<CustomerDrawer customer={customer} onClose={()=>{}} onShipAgain={()=>{}} />);
  await screen.findByText('TRACK-123');
  fireEvent.click(screen.getByRole('button',{name:'Load older orders'}));
  await screen.findByText('Could not load older orders.');
  expect(screen.getByText('TRACK-123')).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'Load older orders'}));
  await screen.findByText('OLDER-TRACK');
  expect(screen.getByText('TRACK-123')).toBeTruthy();
  expect(f.api.mock.calls[2]![1].body.cursor).toEqual(cursor);
});

it('ignores an older search response when a newer query has completed',async()=>{
  let oldResolve!: (value: unknown)=>void;
  const totals={customers:2,orders:2,spend_cents:2500,truncated:false};
  f.api.mockResolvedValueOnce({customers:[customer],totals,page:{total:2,has_more:false}})
    .mockImplementationOnce(()=>new Promise(resolve=>{oldResolve=resolve;}))
    .mockResolvedValueOnce({customers:[{...customer,name:'Current result'}],totals,page:{total:1,has_more:false}});
  show(); await screen.findByText('Dana Reyes');
  fireEvent.change(screen.getByLabelText('Search customers'),{target:{value:'old'}});
  await waitFor(()=>expect(f.api).toHaveBeenCalledTimes(2));
  fireEvent.change(screen.getByLabelText('Search customers'),{target:{value:'current'}});
  await screen.findByText('Current result');
  await act(async()=>{oldResolve({customers:[{...customer,name:'Stale result'}],totals,page:{total:1,has_more:false}});});
  expect(screen.queryByText('Stale result')).toBeNull();
  expect(screen.getByText('Current result')).toBeTruthy();
});

it.each(['initial','older'] as const)('clears stale customer data when the %s response says the customer is gone',async kind=>{
  const existing={...customer,name:'Gone customer',ship_to:{recipient_name:'Gone',recipient_email:null,address1:'Stale address',address2:null,city:'Austin',state:'TX',zip:'78701',country:'US'},order_list:[history]};
  const missing={customers:[],totals:{customers:0,orders:0,spend_cents:0,truncated:false},page:{has_more:false,next_cursor:null}};
  if(kind==='older')f.api.mockResolvedValueOnce({customers:[existing],totals:{truncated:false},page:{has_more:true,next_cursor:{id:'o1',created_at:'2026-01-01T00:00:00.000Z'}}});
  f.api.mockResolvedValueOnce(missing);
  render(<CustomerDrawer customer={existing} onClose={()=>{}} onShipAgain={()=>{}} />);
  if(kind==='older'){await screen.findByText('TRACK-123');fireEvent.click(screen.getByRole('button',{name:'Load older orders'}));}
  await screen.findByText('This customer no longer has any qualifying orders.');
  expect(screen.queryByText(/Stale address/)).toBeNull();expect(screen.queryByText('TRACK-123')).toBeNull();
  expect(screen.queryByRole('button',{name:'Ship again'})).toBeNull();
});

it.each([49,0])('recovers an empty last page when the matched count shrinks to %s',async remaining=>{
  const totals={customers:51,orders:100,spend_cents:10000,truncated:false};
  f.api.mockResolvedValueOnce({customers:[customer],totals,page:{total:51,has_more:true}})
    .mockResolvedValueOnce({customers:[],totals,page:{total:remaining,has_more:false}})
    .mockResolvedValueOnce({customers:remaining?[{...customer,name:'Recovered customer'}]:[],totals,page:{total:remaining,has_more:false}});
  show();await screen.findByText('Dana Reyes');
  fireEvent.click(screen.getByRole('button',{name:'Next page'}));
  await waitFor(()=>expect(f.api).toHaveBeenCalledTimes(3));
  expect(f.api.mock.calls[2]![1].body.offset).toBe(0);
  if(remaining)await screen.findByText('Recovered customer');
  else await screen.findByText('0 customers');
  expect((screen.getByRole('button',{name:'Previous page'}) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.queryByText(/51–50/)).toBeNull();
});

it('recovers to a nonzero last page when several pages disappear',async()=>{
  const totals={customers:151,orders:151,spend_cents:10000,truncated:false};
  const page=(total:number,has_more:boolean)=>({customers:[customer],totals,page:{total,has_more}});
  f.api.mockResolvedValueOnce(page(151,true))
    .mockResolvedValueOnce(page(151,true))
    .mockResolvedValueOnce(page(151,true))
    .mockResolvedValueOnce({customers:[],totals,page:{total:100,has_more:false}})
    .mockResolvedValueOnce(page(100,false));
  show();await screen.findByText('Dana Reyes');
  for(const expectedStart of [51,101]){
    fireEvent.click(screen.getByRole('button',{name:'Next page'}));
    await screen.findByText(`${expectedStart}–${expectedStart} of 151 customers`);
  }
  fireEvent.click(screen.getByRole('button',{name:'Next page'}));
  await screen.findByText('51–51 of 100 customers');
  expect(f.api.mock.calls.map(call=>call[1].body.offset)).toEqual([0,50,100,150,50]);
});
