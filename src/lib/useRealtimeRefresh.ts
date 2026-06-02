'use client';

import { useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

/**
 * Subscribe to Postgres changes on a table and run `onChange` (debounced) when
 * anything the current user can see changes. Returns whether the channel is
 * live, for a status indicator.
 *
 * RLS still applies — an admin gets every row's changes, a seller only their
 * own. Pair with router.refresh() to re-run a server component's joined query
 * instead of patching client state by hand.
 */
export function useRealtimeRefresh(opts: {
  table: string;
  onChange: () => void;
  filter?: string;
  debounceMs?: number;
}): boolean {
  const { table, onChange, filter, debounceMs = 300 } = opts;
  const cbRef = useRef(onChange);
  cbRef.current = onChange;
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const fire = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => cbRef.current(), debounceMs);
    };

    const channel = supabase
      .channel(`realtime:${table}:${filter ?? 'all'}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table, ...(filter ? { filter } : {}) },
        fire
      )
      .subscribe((status) => setConnected(status === 'SUBSCRIBED'));

    return () => {
      if (timer) clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [table, filter, debounceMs]);

  return connected;
}
