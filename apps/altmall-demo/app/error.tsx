'use client';

import { Button } from '@araf/ui';

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="container-page max-w-xl py-24 text-center" role="alert">
      <p className="eyebrow text-danger">Something went wrong</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight text-fg">This page couldn’t load</h1>
      <p className="mt-3 text-muted">Please try again. If the problem continues, the store’s database or Pay with ARAF may be temporarily unavailable.</p>
      <Button size="lg" className="mt-8" onClick={reset}>
        Try again
      </Button>
    </div>
  );
}
