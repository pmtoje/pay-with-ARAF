'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';

export interface ApiState<T> {
  data: T | undefined;
  error: unknown;
  loading: boolean;
  reload: () => void;
}

/** GET a resource. Keeps the previous data while reloading so refreshes do not flash. */
export function useApi<T>(path: string | null, opts: { pollMs?: number } = {}): ApiState<T> {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<unknown>(undefined);
  const [loading, setLoading] = useState<boolean>(!!path);
  const [tick, setTick] = useState(0);
  const lastPath = useRef<string | null>(null);

  useEffect(() => {
    if (!path) {
      setLoading(false);
      return;
    }
    let alive = true;
    if (lastPath.current !== path) setData(undefined);
    lastPath.current = path;
    setLoading(true);
    setError(undefined);
    api
      .get<T>(path)
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(e))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [path, tick]);

  useEffect(() => {
    if (!opts.pollMs || !path) return;
    const t = setInterval(() => setTick((x) => x + 1), opts.pollMs);
    return () => clearInterval(t);
  }, [opts.pollMs, path]);

  const reload = useCallback(() => setTick((x) => x + 1), []);
  return { data, error, loading, reload };
}

/** Read a query-string value on the client (avoids a Suspense boundary for useSearchParams). */
export function useQueryParam(name: string): string | null {
  const [v, setV] = useState<string | null>(null);
  useEffect(() => {
    setV(new URLSearchParams(window.location.search).get(name));
  }, [name]);
  return v;
}
