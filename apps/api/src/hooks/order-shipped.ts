import type { Order } from '@ruostack/db';
import {getClients} from '../clients.ts';
import {enqueueCoaWriteback} from '../services/coa-outbox.ts';
/** Durable fallback for callers; normal ship paths enqueue in their commit. */
export async function onOrderShipped(order:Order):Promise<void>{if(order.source==='woocommerce')await enqueueCoaWriteback(getClients().prisma,'shipment',order.id,`shipment:${order.id}`);}
