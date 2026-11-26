'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { ApiError } from '@araf/ui';
import { api } from './api';

export interface Me {
  user: { id: string; email: string; full_name: string; roles: string[]; permissions: string[] };
  partner: null;
  mfa_verified: boolean;
  environment: 'SANDBOX' | 'PRODUCTION';
  sandbox: boolean;
  /** Connected to the real ARAF (no built-in simulator). */
  araf_connected?: boolean;
}

interface SessionValue {
  me: Me;
  can: (perm: string) => boolean;
  canAny: (...perms: string[]) => boolean;
  reload: () => void;
}

const Ctx = createContext<SessionValue | null>(null);

export function SessionProvider({ children, fallback, onError }: { children: ReactNode; fallback: ReactNode; onError: (e: unknown) => ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<unknown>(null);
  const load = useCallback(() => {
    api
      .get<Me>('/api/auth/admin/me')
      .then((m) => {
        setMe(m);
        setError(null);
      })
      .catch((e) => {
        // 401s redirect to sign-in from the API client; keep the skeleton up meanwhile.
        if (!(e instanceof ApiError && e.status === 401)) setError(e);
      });
  }, []);
  useEffect(load, [load]);
  if (error) return <>{onError(error)}</>;
  if (!me) return <>{fallback}</>;
  const perms = new Set(me.user.permissions);
  const value: SessionValue = { me, can: (p) => perms.has(p), canAny: (...ps) => ps.some((p) => perms.has(p)), reload: load };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): SessionValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSession outside SessionProvider');
  return v;
}
