import Fastify from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { authenticator } from 'otplib';
import { getPrisma, type PrismaClient } from '@ruostack/db';
import { adminAuthRoutes } from '../../src/routes/admin-auth.ts';
import { resetClientsForTest, setClientsForTest } from '../../src/clients.ts';
import { encryptSecret, hashPassword, randomToken } from '../../src/crypto.ts';
import { verifyAdminAccessToken } from '../../src/auth/admin-jwt.ts';
const db = getPrisma();
const password = 'Test-password-for-login-race-42!';

describe.skipIf(process.env.RUN_DB_TESTS !== '1')('admin login account races', () => {
  let adminId: string;
  let email: string;
  let secret: string;
  let passwordHash: string;
  let app: ReturnType<typeof Fastify>;
  beforeAll(async () => { passwordHash = await hashPassword(password); });
  beforeEach(async () => {
    secret = authenticator.generateSecret();
    email = `${randomToken(10)}@test.local`.toLowerCase();
    adminId = (await db.adminUser.create({data:{email,fullName:'Login race',role:'super_admin',passwordHash,mfaEnabled:true,mfaSecret:encryptSecret(secret,process.env.MFA_ENCRYPTION_KEY!)}})).id;
  });
  afterEach(async () => { await app?.close(); resetClientsForTest(); await db.adminUser.delete({where:{id:adminId}}); });
  afterAll(async () => { await db.$disconnect(); });
  async function build(client: PrismaClient = db) {
    setClientsForTest({prisma:client}); app=Fastify(); await app.register(adminAuthRoutes);
  }
  const login = () => app.inject({method:'POST',url:'/auth/admin/login',payload:{email,password,totp:authenticator.generate(secret)}});
  it.each(['suspension','password','mfa-secret','mfa-disabled'] as const)('rejects stale credentials after %s changes',async change=>{
    let changed=false;
    const client=db.$extends({query:{adminUser:{findUnique:async({args,query})=>{
      const snapshot=await query(args);
      if(!changed){changed=true;await db.adminUser.update({where:{id:adminId},data:
        change==='suspension'?{status:'suspended'}:change==='password'?{passwordHash:'replaced-password-hash'}:change==='mfa-secret'?{mfaSecret:encryptSecret(authenticator.generateSecret(),process.env.MFA_ENCRYPTION_KEY!)}:{mfaEnabled:false}
      });}
      return snapshot;
    }}}}) as unknown as PrismaClient;
    await build(client);
    expect((await login()).statusCode).toBe(401);
    expect(await db.adminSession.count({where:{adminUserId:adminId}})).toBe(0);
    expect((await db.adminUser.findUniqueOrThrow({where:{id:adminId}})).lastLoginAt).toBeNull();
  });
  it('uses the current role when issuing a session',async()=>{
    let changed=false;
    const client=db.$extends({query:{adminUser:{findUnique:async({args,query})=>{
      const snapshot=await query(args);
      if(!changed){changed=true;await db.adminUser.update({where:{id:adminId},data:{role:'support'}});}
      return snapshot;
    }}}}) as unknown as PrismaClient;
    await build(client);
    const response=await login();expect(response.statusCode).toBe(200);
    expect(verifyAdminAccessToken(response.json().access_token).role).toBe('support');
  });
  it('rolls back lastLoginAt if session insertion fails',async()=>{
    const client=db.$extends({query:{adminSession:{create:async()=>{throw Error('test session failure');}}}}) as unknown as PrismaClient;
    await build(client);expect((await login()).statusCode).toBe(500);
    expect((await db.adminUser.findUniqueOrThrow({where:{id:adminId}})).lastLoginAt).toBeNull();
  });
  it('holds the admin lock until session creation completes',async()=>{
    let reached!:()=>void;let release!:()=>void;
    const paused=new Promise<void>(resolve=>{reached=resolve;});
    const resume=new Promise<void>(resolve=>{release=resolve;});
    const client=db.$extends({query:{adminSession:{create:async({args,query})=>{
      reached();await resume;return query(args);
    }}}}) as unknown as PrismaClient;
    await build(client);const pending=Promise.resolve(login());
    try {
      await paused;
      // A competing account update needs this row lock. NOWAIT proves it
      // cannot pass the login's session-insertion boundary.
      await expect(db.$transaction(tx=>tx.$queryRaw`SELECT id FROM admin_user WHERE id = ${adminId}::uuid FOR UPDATE NOWAIT`))
        .rejects.toMatchObject({code:'P2010',meta:{code:'55P03'}});
    } finally {release();await pending;}
    expect((await pending).statusCode).toBe(200);
  });
  it('issues a usable session for unchanged credentials',async()=>{
    await build();const response=await login();expect(response.statusCode).toBe(200);
    const principal=verifyAdminAccessToken(response.json().access_token);
    expect(principal.adminUserId).toBe(adminId);
    expect((await db.adminSession.findUniqueOrThrow({where:{id:principal.sessionId}})).revokedAt).toBeNull();
    expect((await db.adminUser.findUniqueOrThrow({where:{id:adminId}})).lastLoginAt).not.toBeNull();
  });
});
