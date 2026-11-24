import Fastify from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getPrisma, type PrismaClient } from '@ruostack/db';
import { adminAuthRoutes } from '../../src/routes/admin-auth.ts';
import { requireAdmin } from '../../src/middleware/guards.ts';
import { signAdminAccessToken } from '../../src/auth/admin-jwt.ts';
import { resetClientsForTest, setClientsForTest } from '../../src/clients.ts';
import { hashToken, randomToken } from '../../src/crypto.ts';
const db=getPrisma();
function gate(){let release!:()=>void;return {promise:new Promise<void>(r=>{release=r;}),release:()=>release()};}
describe.skipIf(process.env.RUN_DB_TESTS!=='1')('admin logout session families',()=>{
 let id:string,root:string,other:string;let app:ReturnType<typeof Fastify>;
 beforeEach(async()=>{
  id=(await db.adminUser.create({data:{email:`${randomToken(10)}@test.local`,fullName:'Families',role:'super_admin',passwordHash:'unused',mfaEnabled:true}})).id;
  root=randomToken(32);other=randomToken(32);
  for(const token of [root,other])await db.adminSession.create({data:{adminUserId:id,refreshTokenHash:hashToken(token),expiresAt:new Date(Date.now()+60000)}});
 });
 afterEach(async()=>{await app?.close();resetClientsForTest();await db.adminUser.delete({where:{id}});});
 afterAll(async()=>{await db.$disconnect();});
 async function build(client:PrismaClient=db){setClientsForTest({prisma:client});app=Fastify();await app.register(adminAuthRoutes);app.get('/protected',{preHandler:requireAdmin('admin_users')},async()=>({ok:true}));}
 const refresh=(token:string)=>app.inject({method:'POST',url:'/auth/admin/refresh',payload:{refresh_token:token}});
 const logout=(token:unknown)=>app.inject({method:'POST',url:'/auth/admin/logout',payload:{refresh_token:token}});
 it('revokes descendants using a consumed ancestor while preserving an independent login',async()=>{
  await build();const first=await refresh(root);expect(first.statusCode).toBe(200);
  const second=await refresh(first.json().refresh_token);expect(second.statusCode).toBe(200);
  expect((await logout(root)).statusCode).toBe(200);
  expect((await refresh(second.json().refresh_token)).statusCode).toBe(401);
  expect((await app.inject({url:'/protected',headers:{authorization:`Bearer ${second.json().access_token}`}})).statusCode).toBe(401);
  expect((await refresh(other)).statusCode).toBe(200);
  expect((await logout(root)).statusCode).toBe(200);
 });
 it('blocks refresh when logout finishes first',async()=>{
  await build();expect((await logout(root)).statusCode).toBe(200);expect((await refresh(root)).statusCode).toBe(401);
 });
 it('revokes the replacement when refresh holds the admin lock first',async()=>{
  const started=gate(),resume=gate();let creating=false;
  const client=db.$extends({query:{adminSession:{
   create:async({args,query})=>{creating=true;started.release();await resume.promise;return query(args);},
   findUnique:async({args,query})=>{const row=await query(args);if(creating)resume.release();return row;},
  }}}) as unknown as PrismaClient;
  await build(client);const rotating=Promise.resolve(refresh(root));await started.promise;
  try{expect((await logout(root)).statusCode).toBe(200);}finally{resume.release();}
  const replacement=await rotating;expect(replacement.statusCode).toBe(200);
  expect((await refresh(replacement.json().refresh_token)).statusCode).toBe(401);
 });
 it('blocks a concurrent refresh while logout holds the admin lock',async()=>{
  const started=gate(),resume=gate();let revoking=false;
  const client=db.$extends({query:{adminSession:{
   updateMany:async({args,query})=>{if(!revoking){revoking=true;started.release();await resume.promise;}return query(args);},
   findUnique:async({args,query})=>{const row=await query(args);if(revoking)resume.release();return row;},
  }}}) as unknown as PrismaClient;
  await build(client);const signingOut=Promise.resolve(logout(root));await started.promise;
  try{expect((await refresh(root)).statusCode).toBe(401);}finally{resume.release();}
  expect((await signingOut).statusCode).toBe(200);
 });
 it('rejects legacy sessions from a process running during migration',async()=>{
  const session=await db.adminSession.update({where:{refreshTokenHash:hashToken(root)},data:{familyId:null}});
  await build();expect((await refresh(root)).statusCode).toBe(401);
  const token=signAdminAccessToken({sub:id,role:'super_admin',sid:session.id});
  expect((await app.inject({url:'/protected',headers:{authorization:`Bearer ${token}`}})).statusCode).toBe(401);
 });
 it.each([undefined,'unknown-refresh-token'])('keeps logout idempotent for %s',async token=>{
  await build();const response=await logout(token);expect(response.statusCode).toBe(200);expect(response.json()).toEqual({ok:true});
  expect(await db.adminSession.count({where:{adminUserId:id,revokedAt:null}})).toBe(2);
 });
 it('rejects malformed logout credentials without a server error',async()=>{
  await build();expect((await logout(123)).statusCode).toBe(400);
 });
});
