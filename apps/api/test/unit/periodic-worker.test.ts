import { afterEach, describe, expect, it, vi } from 'vitest';
import { startSubscriptionLapseWorker } from '../../src/services/subscription.ts';
import type { PrismaClient } from '@ruostack/db';
afterEach(()=>vi.useRealTimers());
describe('periodic worker scheduling',()=>{
  it('does not start another sweep while one is pending and resumes after completion',async()=>{
    vi.useFakeTimers();
    let release!: (rows: [])=>void;
    const scan=vi.fn().mockImplementationOnce(()=>new Promise(r=>{release=r;})).mockResolvedValue([]);
    const stop=startSubscriptionLapseWorker({subscriptionState:{findMany:scan}} as unknown as PrismaClient,100);
    expect(scan).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(500);
    expect(scan).toHaveBeenCalledTimes(1);
    release([]); await vi.advanceTimersByTimeAsync(100);
    expect(scan).toHaveBeenCalledTimes(2);
    stop(); await vi.advanceTimersByTimeAsync(500); expect(scan).toHaveBeenCalledTimes(2);
  });
  it('recovers after rejection and stops future runs',async()=>{
    vi.useFakeTimers();
    const scan=vi.fn().mockRejectedValueOnce(new Error('unavailable')).mockResolvedValue([]);
    const log=vi.fn();
    const stop=startSubscriptionLapseWorker({subscriptionState:{findMany:scan}} as unknown as PrismaClient,100,log);
    await vi.advanceTimersByTimeAsync(100);
    expect(scan).toHaveBeenCalledTimes(2); expect(log).toHaveBeenCalledWith(expect.stringContaining('unavailable'));
    stop(); await vi.advanceTimersByTimeAsync(500); expect(scan).toHaveBeenCalledTimes(2);
  });
  it('does not reschedule when stopped during an outstanding sweep',async()=>{
    vi.useFakeTimers();
    let release!: (rows: [])=>void;
    const scan=vi.fn().mockImplementation(()=>new Promise(r=>{release=r;}));
    const stop=startSubscriptionLapseWorker({subscriptionState:{findMany:scan}} as unknown as PrismaClient,100);
    stop(); release([]); await vi.advanceTimersByTimeAsync(500);
    expect(scan).toHaveBeenCalledTimes(1);
  });

});
