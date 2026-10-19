import { useEffect, useState } from 'react';
import type { McVersionEntry } from '../shared/types';
import { call, errMsg } from './api';

let cache: McVersionEntry[] | null = null;

/** Minecraft version list (from the main-process cache; refreshes from Mojang when stale). */
export function useMcVersions(): { versions: McVersionEntry[]; loading: boolean; error: string | null; reload: () => void } {
  const [versions, setVersions] = useState<McVersionEntry[]>(cache ?? []);
  const [loading, setLoading] = useState(cache === null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    call('versions:minecraft', { refresh: tick > 0 })
      .then((v) => { cache = v; if (alive) setVersions(v); })
      .catch((e) => { if (alive) setError(errMsg(e)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [tick]);
  return { versions, loading, error, reload: () => setTick((t) => t + 1) };
}
