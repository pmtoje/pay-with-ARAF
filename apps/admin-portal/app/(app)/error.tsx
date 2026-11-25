'use client';

import { Button } from '@araf/ui';
import { ErrorAlert } from '@/components/common';

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto max-w-xl py-16">
      <ErrorAlert error={error} title="This page failed to render" />
      <Button className="mt-4" onClick={reset}>Try again</Button>
    </div>
  );
}
