'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from './api';
import type { Me, Permission } from './types';

interface SessionValue {
  me: Me;
  can: (p: Permission) => boolean;
  refresh: () => Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

/** Loads `/api/auth/partner/me`. 401s redirect to /login via the API client. */
export function SessionProvider({ children, fallback }: { children: ReactNode; fallback: (state: { error: unknown; retry: () => void }) => ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<unknown>(null);
  const load = useCallback(async () => {
    setError(null);
    try {
      setMe(await api.get<Me>('/api/auth/partner/me'));
    } catch (e) {
      setError(e);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  if (!me) return <>{fallback({ error, retry: () => void load() })}</>;
  const can = (p: Permission) => me.user.permissions.includes(p);
  return <SessionContext.Provider value={{ me, can, refresh: load }}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const v = useContext(SessionContext);
  if (!v) throw new Error('useSession outside SessionProvider');
  return v;
}

export const ROLE_LABEL: Record<string, string> = {
  PARTNER_ADMIN: 'Partner Administrator',
  PARTNER_FINANCE: 'Finance Officer',
  PARTNER_FULFILMENT: 'Fulfilment Officer',
  PARTNER_SUPPORT: 'Customer Support',
  PARTNER_DEVELOPER: 'Developer',
  PARTNER_VIEWER: 'Read-only Viewer',
};
