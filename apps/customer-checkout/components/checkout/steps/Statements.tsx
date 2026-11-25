'use client';

import { useRef, useState, type DragEvent } from 'react';
import { ApiError, Alert, Button, cn } from '@araf/ui';
import { errorCode, safeHref, uploadWithProgress } from '@/lib/api';
import { isView, type View } from '@/lib/types';
import { useAction, useCheckout } from '../context';
import { ChoiceCard, ErrorNotice, LockIcon, StepCard, Why } from '../ui';
import { IncomeProfileStep } from './Income';

const MAX_BYTES = 5 * 1024 * 1024;
type Channel = 'ALTBANK' | 'MONO' | 'PDF_UPLOAD';

const FAILURE_TEXT: Record<string, string> = {
  STATEMENT_COVERAGE_INSUFFICIENT: 'did not cover the full period we need',
  STATEMENT_OWNERSHIP_MISMATCH: 'did not appear to be in your name',
};

export function StatementsStep() {
  const { api, base, view, csrf, applyView } = useCheckout();
  const { busy, error, setError, run } = useAction();
  const [channel, setChannel] = useState<Channel | ''>('');
  const [changingProfile, setChangingProfile] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  if (changingProfile) return <IncomeProfileStep onDone={() => setChangingProfile(false)} />;

  const months = view.statement?.required_months ?? (view.income_profile === 'BUSINESS_OWNER' ? 12 : 6);
  const last = view.statement?.connections?.[0];
  const lastFailed = last && ['REJECTED', 'INSUFFICIENT', 'FAILED'].includes(last.status) ? last : null;
  const newAccount = view.account?.source === 'NEWLY_OPENED';
  const alternatives = error instanceof ApiError && Array.isArray(error.details?.alternatives) ? (error.details!.alternatives as Channel[]) : [];

  const pick = (c: Channel) => {
    setChannel(c);
    setError(null);
  };

  const choose = async (f: File | undefined | null) => {
    setFileError(null);
    setError(null);
    if (!f) return;
    const isPdf = f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
    if (!isPdf) return setFileError('Please choose a PDF file downloaded from your bank.');
    if (f.size > MAX_BYTES) return setFileError(`This file is ${(f.size / 1024 / 1024).toFixed(1)} MB. The maximum size is 5 MB.`);
    if (f.size < 64) return setFileError('This file looks empty. Please download the statement again.');
    const head = new TextDecoder('latin1').decode(await f.slice(0, 5).arrayBuffer());
    if (head !== '%PDF-') return setFileError('This file is not a valid PDF. Please download the statement directly from your bank.');
    setFile(f);
  };

  const upload = () =>
    run('pdf', async () => {
      if (!file) return;
      const form = new FormData();
      form.append('file', file, file.name);
      setProgress(0);
      try {
        const v = await uploadWithProgress<View>(`${base}/statements/pdf`, form, csrf(), setProgress);
        if (isView(v)) applyView(v);
      } finally {
        setProgress(null);
      }
    }, { onError: (e) => { if (['PDF_INVALID', 'PDF_ENCRYPTED', 'PDF_TOO_LARGE', 'MALWARE_DETECTED', 'DUPLICATE_DOCUMENT'].includes(errorCode(e) ?? '')) setFile(null); return false; } });

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    void choose(e.dataTransfer.files?.[0]);
  };

  return (
    <StepCard
      eyebrow="Step 3 · Connect finances"
      title="Share your bank statement"
      description={
        <>
          We need your last <span className="font-medium text-fg">{months} complete months</span> of statements to confirm your income and existing commitments.{' '}
          <button type="button" className="font-medium text-gold-strong underline underline-offset-2" onClick={() => setChangingProfile(true)}>
            {view.income_profile === 'BUSINESS_OWNER' ? 'I earn a salary instead' : 'I’m a business owner instead'}
          </button>
        </>
      }
    >
      {lastFailed && !error && (
        <Alert tone="warning" title="Your last statement couldn’t be used">
          The statement {FAILURE_TEXT[lastFailed.failure ?? ''] ?? 'could not be analysed'}. Please try another option below.
        </Alert>
      )}
      {view.exception?.message && !error && <Alert tone="warning">{view.exception.message}</Alert>}

      <fieldset className="space-y-3">
        <legend className="mb-2 text-sm font-semibold text-fg">Choose how to share it</legend>
        <ChoiceCard
          name="channel"
          value="ALTBANK"
          checked={channel === 'ALTBANK'}
          onChange={() => pick('ALTBANK')}
          title="Use my Alternative Bank account"
          badge={!newAccount ? <span className="rounded-sm bg-gold-soft px-1.5 py-0.5 text-2xs font-semibold text-gold-strong">Fastest</span> : undefined}
          description={
            view.account ? (
              <>
                Instant — we read {months} months of history from <span className="font-mono">{view.account.account_number}</span>.
                {newAccount && ' New accounts usually don’t have enough history yet.'}
              </>
            ) : (
              'Instant — we read your history directly.'
            )
          }
        />
        <ChoiceCard name="channel" value="MONO" checked={channel === 'MONO'} onChange={() => pick('MONO')} title="Connect another bank" description="Securely share read-only access via Mono. You approve it in your bank’s own flow." />
        <ChoiceCard name="channel" value="PDF_UPLOAD" checked={channel === 'PDF_UPLOAD'} onChange={() => pick('PDF_UPLOAD')} title="Upload a PDF statement" description="A statement downloaded from your bank’s app or website (not a scan or photo), up to 5 MB." />
      </fieldset>

      {channel === 'ALTBANK' && (
        <div className="space-y-3">
          <ErrorNotice error={error} />
          <Button size="lg" block loading={busy === 'altbank'} onClick={() => void run('altbank', () => api.post(`${base}/statements/altbank`))}>
            Share my Alternative Bank statement
          </Button>
        </div>
      )}

      {channel === 'MONO' && (
        <div className="space-y-3">
          <div className="flex gap-3 rounded-md bg-surface-2 px-4 py-3 text-sm text-muted">
            <LockIcon className="mt-0.5 h-4 w-4 shrink-0 text-gold-strong" />
            <span>You’ll leave this page briefly to connect through Mono. Access is read-only and used only for this application. Mono never shares your bank login with us, and we will never ask for your internet-banking password.</span>
          </div>
          <ErrorNotice error={error} />
          <Button
            size="lg"
            block
            loading={busy === 'mono'}
            onClick={() =>
              void run('mono', async () => {
                const r = await api.post<{ connect_url: string }>(`${base}/statements/mono/session`);
                const url = safeHref(r.connect_url);
                if (!url) throw new Error('The bank connection link is not valid. Please try again.');
                window.location.assign(url);
                await new Promise((resolve) => setTimeout(resolve, 10_000));
              })
            }
          >
            Continue to connect my bank
          </Button>
        </div>
      )}

      {channel === 'PDF_UPLOAD' && (
        <div className="space-y-3">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            className={cn('rounded-md border-2 border-dashed px-4 py-6 text-center transition-colors', dragging ? 'border-gold bg-gold-soft/40' : 'border-border-strong')}
          >
            <input ref={inputRef} id="statement-file" type="file" accept="application/pdf,.pdf" className="sr-only" onChange={(e) => { void choose(e.target.files?.[0]); e.target.value = ''; }} />
            {file ? (
              <div className="space-y-1">
                <p className="break-all text-sm font-medium text-fg">{file.name}</p>
                <p className="text-xs text-muted">{(file.size / 1024).toFixed(0)} KB · PDF</p>
                <button type="button" disabled={!!busy} className="inline-flex min-h-[44px] items-center text-sm font-medium text-gold-strong underline underline-offset-2" onClick={() => inputRef.current?.click()}>
                  Choose a different file
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="hidden text-sm text-muted sm:block">Drag and drop your PDF statement here, or</p>
                <Button variant="secondary" onClick={() => inputRef.current?.click()}>
                  Choose PDF file
                </Button>
                <p className="text-xs text-subtle">PDF only · max 5 MB · must not be password protected</p>
              </div>
            )}
          </div>
          {fileError && (
            <p className="text-sm font-medium text-danger" role="alert">
              {fileError}
            </p>
          )}
          {progress !== null && (
            <div className="space-y-1" aria-live="polite">
              <div className="flex justify-between text-xs text-muted">
                <span>{progress < 1 ? 'Uploading securely…' : 'Checking your statement…'}</span>
                <span className="tabular-nums">{Math.round(progress * 100)}%</span>
              </div>
              <div className="h-2 rounded-full bg-surface-2" role="progressbar" aria-label="Upload progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
                <div className="h-2 rounded-full bg-gold transition-[width]" style={{ width: `${progress * 100}%` }} />
              </div>
            </div>
          )}
          <ErrorNotice error={error} />
          <Button size="lg" block disabled={!file} loading={busy === 'pdf'} onClick={() => void upload()}>
            Upload statement
          </Button>
        </div>
      )}

      {!channel && <ErrorNotice error={error} />}

      {alternatives.length > 0 && (
        <div className="flex flex-col gap-2 sm:flex-row">
          {alternatives.includes('MONO') && channel !== 'MONO' && (
            <Button variant="secondary" onClick={() => pick('MONO')}>
              Connect another bank instead
            </Button>
          )}
          {alternatives.includes('PDF_UPLOAD') && channel !== 'PDF_UPLOAD' && (
            <Button variant="secondary" onClick={() => pick('PDF_UPLOAD')}>
              Upload a PDF instead
            </Button>
          )}
        </div>
      )}

      <Why>We use statements only to assess affordability for this application. Analysis is performed for The Alternative Bank by Periculum, under your consent. We will never ask for your internet-banking password or PIN.</Why>
    </StepCard>
  );
}
