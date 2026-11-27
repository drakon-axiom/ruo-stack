import {expect,it} from 'vitest';
import {validateCoaStorageBoundary} from '../../src/services/coa-storage-policy.ts';
it('rejects disabled RLS and policies whose allowed prefix hides a wider OR',()=>{
 expect(()=>validateCoaStorageBoundary({objectsRls:false,bucketsRls:true,bypass:false,policies:[]})).toThrow();
 expect(()=>validateCoaStorageBoundary({objectsRls:true,bucketsRls:true,bypass:false,policies:[{tablename:'objects',policyname:'brand_logo_write_own_prefix',cmd:'INSERT',qual:null,with_check:"((bucket_id = 'brand-logos'::text) AND true) OR true"}]})).toThrow();
 expect(()=>validateCoaStorageBoundary({objectsRls:true,bucketsRls:true,bypass:true,policies:[]})).toThrow();
 expect(()=>validateCoaStorageBoundary({objectsRls:true,bucketsRls:true,bypass:false,policies:[]})).not.toThrow();
});
