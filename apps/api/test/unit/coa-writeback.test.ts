import { expect, it } from 'vitest';
import { wooCoaLines } from '../../src/services/coa-writeback.ts';
it('maps duplicate SKU order lines by explicit Woo line identity and combines split lots',()=>{
 const rows=[{wooLineId:'72',lotCode:'A',qty:3,url:'https://backend.test/coa/a'},{wooLineId:'71',lotCode:'B',qty:9,url:'https://backend.test/coa/b'},{wooLineId:'72',lotCode:'C',qty:1,url:'https://backend.test/coa/c'}];
 expect(wooCoaLines(rows)).toEqual([{id:72,meta_data:[{key:'_ruostack_coa_allocations',value:[{lot_code:'A',qty:3,certificate_url:rows[0]!.url},{lot_code:'C',qty:1,certificate_url:rows[2]!.url}]}]},{id:71,meta_data:[{key:'_ruostack_coa_allocations',value:[{lot_code:'B',qty:9,certificate_url:rows[1]!.url}]}]}]);
});
it('refuses to guess missing or invalid Woo line IDs',()=>{expect(()=>wooCoaLines([{wooLineId:null,lotCode:'A',qty:1,url:null}])).toThrow();expect(()=>wooCoaLines([{wooLineId:'1/../orders',lotCode:'A',qty:1,url:null}])).toThrow();});
