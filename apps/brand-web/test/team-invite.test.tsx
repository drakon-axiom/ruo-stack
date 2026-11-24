import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {Team} from '../src/screens/Team.js';
const f=vi.hoisted(()=>({api:vi.fn()}));
vi.mock('../src/lib/api.js',()=>({api:f.api,ApiError:class extends Error {}}));
const member={user_id:'member',full_name:'Pending Member',email:'member@example.test',role:'staff',status:'active',pending:true,invited_at:null,is_you:false};
beforeEach(()=>{vi.resetAllMocks();f.api.mockResolvedValueOnce({members:[member],your_role:'owner'});});
afterEach(cleanup);
it('requests an invite email and never shows a regenerated credential',async()=>{
 f.api.mockResolvedValueOnce({invite_sent:true,email:'member@example.test'});render(<Team/>);
 fireEvent.click(await screen.findByRole('button',{name:'Email invite'}));
 await screen.findByText('Invitation email requested for member@example.test.');
 expect(f.api).toHaveBeenLastCalledWith('/api/brand/members/member/invite-link',{method:'POST'});
 expect(screen.queryByRole('button',{name:/copy/i})).toBeNull();
});
it('reports delivery failure and allows retry without claiming success',async()=>{
 f.api.mockRejectedValueOnce(new Error('SMTP unavailable')).mockResolvedValueOnce({invite_sent:true,email:'member@example.test'});render(<Team/>);
 fireEvent.click(await screen.findByRole('button',{name:'Email invite'}));
 await screen.findByText('Could not send the invitation email.');
 expect(screen.queryByText(/Invitation email requested/)).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'Email invite'}));
 await screen.findByText('Invitation email requested for member@example.test.');
 await waitFor(()=>expect(f.api).toHaveBeenCalledTimes(3));
});
