import { useEffect, useRef, useState } from 'react';
import { simClient } from '../store/simClient';
import { useSim } from '../store/store';
import type { QueryKind } from '../workers/protocol';

/**
 * Fetch a view from the worker and refresh it as the simulation advances,
 * at most once per `intervalMs` (so heavy views don't re-render every frame).
 */
export function useQuery<T>(kind: QueryKind, id?: number, intervalMs = 1500, enabled = true): { data: T | null; refresh: () => void } {
  const [data, setData] = useState<T | null>(null);
  const tick = useSim((s) => s.frame?.tick ?? -1);
  const frameNo = useSim((s) => s.frameNo);
  const last = useRef(0);
  const keyRef = useRef('');
  const inflight = useRef(false);
  const mounted = useRef(true);
  const [nonce, setNonce] = useState(0);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (!enabled) return;
    const key = `${kind}:${id}`;
    const now = performance.now();
    const changedKey = key !== keyRef.current;
    if (!changedKey && (inflight.current || now - last.current < intervalMs)) return;
    if (changedKey) setData(null);
    last.current = now;
    keyRef.current = key;
    inflight.current = true;
    simClient.query<T>(kind, id).then((d) => {
      inflight.current = false;
      if (mounted.current && keyRef.current === key) setData(d);
    });
  }, [kind, id, tick, frameNo, intervalMs, enabled, nonce]);
  return { data, refresh: () => { last.current = 0; setNonce((n) => n + 1); } };
}
