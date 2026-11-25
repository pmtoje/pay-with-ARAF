'use client';

import type { ReactNode } from 'react';
import { Card, EmptyState } from '@araf/ui';
import { useSession } from '@/lib/session';
import type { Permission } from '@/lib/types';

/** Renders children only when the user holds `perm` (the API enforces it regardless). */
export function RequirePermission({ perm, children }: { perm: Permission; children: ReactNode }) {
  const { can } = useSession();
  if (can(perm)) return <>{children}</>;
  return (
    <Card>
      <EmptyState title="You do not have access to this page" description="Ask your partner administrator to assign a role that includes this permission." />
    </Card>
  );
}
