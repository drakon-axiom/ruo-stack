import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getClients } from '../clients.ts';
import { requireAdmin } from '../middleware/guards.ts';
import { writeAudit } from '../audit.ts';
export async function adminCoaJobRoutes(app:FastifyInstance){const {prisma}=getClients();
 app.get('/api/admin/coa-jobs',{preHandler:requireAdmin('catalog','view')},async()=>({jobs:await prisma.coaWritebackJob.findMany({where:{status:{not:'complete'}},orderBy:{createdAt:'asc'},take:100})}));
 app.post('/api/admin/coa-jobs/retry',{preHandler:requireAdmin('catalog','write')},async req=>{const {key}=z.object({key:z.string().min(1).max(200)}).parse(req.body);await prisma.$transaction(async tx=>{await tx.coaWritebackJob.update({where:{key},data:{status:'pending',attempts:0,nextAttemptAt:new Date(),lastError:null}});await writeAudit(tx,{actorType:'admin',actorId:req.admin!.adminUserId,action:'coa.writeback_retried',targetType:'coa_writeback_job',targetId:key});});return {ok:true};});
}
