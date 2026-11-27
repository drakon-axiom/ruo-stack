import { randomUUID } from 'node:crypto';
import type { Prisma } from '@ruostack/db';
export async function enqueueCoaWriteback(tx:Pick<Prisma.TransactionClient,'coaWritebackJob'>,kind:'shipment'|'product',targetId:string,key=`${kind}:${targetId}:${randomUUID()}`){await tx.coaWritebackJob.upsert({where:{key},create:{key,kind,targetId},update:{}});}
