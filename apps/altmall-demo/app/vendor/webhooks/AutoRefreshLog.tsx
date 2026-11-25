'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { Button, Checkbox } from '@araf/ui';

export function AutoRefreshLog() {
  const router = useRouter();
  const [auto, setAuto] = useState(true);
  const [pending, start] = useTransition();
  useEffect(() => {
    if (!auto) return;
    const id = window.setInterval(() => document.visibilityState === 'visible' && router.refresh(), 5000);
    return () => window.clearInterval(id);
  }, [auto, router]);
  return (
    <div className="flex items-center gap-4">
      <Checkbox label="Auto-refresh every 5 s" checked={auto} onChange={(e) => setAuto(e.currentTarget.checked)} />
      <Button size="sm" variant="secondary" loading={pending} onClick={() => start(() => router.refresh())}>
        Refresh
      </Button>
    </div>
  );
}
