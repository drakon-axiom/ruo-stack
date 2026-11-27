import { describe, expect, it } from 'vitest';
import { classifyLegacyCoa, CoaReferenceSchema } from '@ruostack/shared';
describe('legacy COA references',()=>{
 it('keeps opaque identifiers as references',()=>{expect(classifyLegacyCoa('COA-123')).toEqual({kind:'reference',value:'COA-123'});});
 it('supports long HTTPS links',()=>{const value='https://lab.example/'+ 'a'.repeat(500);expect(CoaReferenceSchema.parse(value)).toBe(value);expect(classifyLegacyCoa(value).kind).toBe('url');});
 it.each(['javascript:alert(1)','data:application/pdf;base64,x','https://user:pass@lab.example/report','http://lab.example/report'])('does not make %s clickable',value=>{expect(classifyLegacyCoa(value).kind).toBe('reference');expect(CoaReferenceSchema.safeParse(value).success).toBe(false);});
 it('treats empty references as absent',()=>{expect(classifyLegacyCoa(' ')).toEqual({kind:'empty',value:null});});
});
