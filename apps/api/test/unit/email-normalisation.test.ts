import { describe, expect, it } from 'vitest';
import { AdminCreateSchema, AdminLoginSchema, BrandSignupSchema } from '@ruostack/shared';

/**
 * Email addresses are matched with `findUnique({ where: { email } })`, which is
 * byte-exact. Without normalisation, an admin who types `Scott.Hawks@axc.llc`
 * gets a 401 saying "Invalid credentials" while the credentials are correct --
 * and iOS and Android autocapitalise the first letter of a text field by
 * default, so this is the common case on mobile, not an edge case.
 *
 * Normalising in the schema puts it at the route boundary, so the API and both
 * SPAs inherit it rather than each having to remember.
 */
describe('email normalisation at the schema boundary', () => {
  const password = 'correct-horse-battery-staple';

  describe('AdminLoginSchema', () => {
    it('lowercases the email so a capitalised address still matches', () => {
      const parsed = AdminLoginSchema.parse({ email: 'Scott.Hawks@AXC.LLC', password });
      expect(parsed.email).toBe('scott.hawks@axc.llc');
    });

    it('trims surrounding whitespace, which pasting commonly introduces', () => {
      const parsed = AdminLoginSchema.parse({ email: '  scott.hawks@axc.llc  ', password });
      expect(parsed.email).toBe('scott.hawks@axc.llc');
    });

    it('still rejects a malformed address', () => {
      expect(() => AdminLoginSchema.parse({ email: 'not-an-email', password })).toThrow();
    });

    it('leaves the password untouched -- it is case- and whitespace-significant', () => {
      const parsed = AdminLoginSchema.parse({ email: 'a@b.co', password: '  MiXeD Case  ' });
      expect(parsed.password).toBe('  MiXeD Case  ');
    });
  });

  describe('AdminCreateSchema', () => {
    // Creation must normalise too. If it did not, an admin invited as
    // `Foo@x.com` would be stored mixed-case and could never log in, because
    // login lowercases before the lookup.
    it('lowercases and trims on create so the stored value matches at login', () => {
      const parsed = AdminCreateSchema.parse({
        email: '  New.Admin@Example.COM ',
        full_name: 'New Admin',
        role: 'operations',
      });
      expect(parsed.email).toBe('new.admin@example.com');
    });
  });

  describe('BrandSignupSchema', () => {
    it('lowercases and trims the brand-side signup email', () => {
      const parsed = BrandSignupSchema.parse({
        full_name: 'Brand Person',
        email: ' Brand.Person@Example.COM ',
        password: 'longenoughpassword',
        brand_name: 'Brand',
      });
      expect(parsed.email).toBe('brand.person@example.com');
    });
  });
});
