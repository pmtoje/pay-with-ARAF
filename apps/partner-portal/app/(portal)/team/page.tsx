'use client';

import { useState } from 'react';
import { Alert, Badge, Button, Card, CardHeader, CopyButton, DataTable, Dialog, EmptyState, Field, Input, LoadingBlock, PageHeader, StatusBadge, cn, formatDate, formatDateTime } from '@araf/ui';
import { api, useApi } from '@/lib/api';
import { ROLE_LABEL, useSession } from '@/lib/session';
import type { Team } from '@/lib/types';
import { ConfirmDialog, ErrorState, FormError, useToast } from '@/components/common';
import { RequirePermission } from '@/components/gate';

export default function TeamPage() {
  return (
    <RequirePermission perm="p.dashboard.read">
      <TeamInner />
    </RequirePermission>
  );
}

function TeamInner() {
  const { me, can } = useSession();
  const canManage = can('p.team.manage');
  const { data, error, reload } = useApi<Team>('/api/partner-portal/team');
  const [inviting, setInviting] = useState(false);
  const [target, setTarget] = useState<Team['users'][number] | null>(null);
  const { toast, toastNode } = useToast();
  const roleName = (code: string) => data?.available_roles.find((r) => r.code === code)?.name ?? ROLE_LABEL[code] ?? code;

  return (
    <>
      <PageHeader title="Team" description="People at your business who can use the Partner portal. Every user signs in with a password and an authenticator app." actions={canManage ? <Button onClick={() => setInviting(true)}>Invite team member</Button> : undefined} />
      {toastNode}
      {error ? (
        <Card>
          <ErrorState error={error} onRetry={reload} title="Team could not be loaded" />
        </Card>
      ) : !data ? (
        <Card>
          <LoadingBlock rows={5} label="Loading team" />
        </Card>
      ) : (
        <div className="space-y-4">
          <Card>
            <CardHeader title="Users" description={`${data.users.length} ${data.users.length === 1 ? 'user' : 'users'}`} />
            <DataTable
              caption="Team members"
              rows={data.users}
              rowKey={(u) => u.id}
              empty={<EmptyState title="No users" />}
              columns={[
                {
                  key: 'name',
                  header: 'Name',
                  cell: (u) => (
                    <div>
                      <p className="font-medium text-fg">
                        {u.full_name} {u.id === me.user.id && <Badge>You</Badge>}
                      </p>
                      <p className="text-xs text-muted">{u.email}</p>
                    </div>
                  ),
                  sortValue: (u) => u.full_name,
                },
                { key: 'roles', header: 'Role', cell: (u) => u.roles.map(roleName).join(', ') },
                { key: 'status', header: 'Status', cell: (u) => <StatusBadge status={u.status} /> },
                { key: 'login', header: 'Last sign-in', cell: (u) => <span className="whitespace-nowrap text-muted">{u.last_login_at ? formatDateTime(u.last_login_at) : 'Never'}</span> },
                {
                  key: 'act',
                  header: <span className="sr-only">Actions</span>,
                  align: 'right',
                  cell: (u) =>
                    canManage && u.id !== me.user.id && (u.status === 'ACTIVE' || u.status === 'SUSPENDED') ? (
                      <Button size="sm" variant={u.status === 'ACTIVE' ? 'ghost' : 'secondary'} className={cn(u.status === 'ACTIVE' && 'text-danger')} onClick={() => setTarget(u)}>
                        {u.status === 'ACTIVE' ? 'Suspend' : 'Reactivate'}
                      </Button>
                    ) : null,
                },
              ]}
            />
          </Card>
          <Card>
            <CardHeader title="Pending invitations" description="Invitations expire after 7 days." />
            <DataTable
              caption="Pending invitations"
              rows={data.pending_invitations}
              rowKey={(i) => i.id}
              empty={<EmptyState title="No pending invitations" />}
              columns={[
                { key: 'name', header: 'Name', cell: (i) => <div><p className="font-medium text-fg">{i.full_name}</p><p className="text-xs text-muted">{i.email}</p></div> },
                { key: 'roles', header: 'Role', cell: (i) => i.roles.map(roleName).join(', ') },
                { key: 'exp', header: 'Expires', cell: (i) => <span className="text-muted">{formatDate(i.expires_at)}</span> },
              ]}
            />
          </Card>
          <Card>
            <CardHeader title="Roles" description="What each role can do in the Partner portal" />
            <ul className="grid gap-px bg-border sm:grid-cols-2 lg:grid-cols-3">
              {data.available_roles.map((r) => (
                <li key={r.code} className="bg-surface px-5 py-4">
                  <p className="text-sm font-semibold text-fg">{r.name}</p>
                  <p className="mt-0.5 text-sm text-muted">{r.description}</p>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      )}
      {data && (
        <InviteDialog
          open={inviting}
          roles={data.available_roles}
          onClose={() => setInviting(false)}
          onInvited={() => {
            reload();
          }}
        />
      )}
      <ConfirmDialog
        open={!!target}
        onClose={() => setTarget(null)}
        title={target?.status === 'ACTIVE' ? `Suspend ${target?.full_name}?` : `Reactivate ${target?.full_name}?`}
        description={target?.status === 'ACTIVE' ? 'They are signed out of all sessions immediately and cannot sign in until reactivated.' : 'They will be able to sign in again with their existing password and authenticator.'}
        confirmLabel={target?.status === 'ACTIVE' ? 'Suspend user' : 'Reactivate user'}
        tone={target?.status === 'ACTIVE' ? 'danger' : 'primary'}
        onConfirm={async () => {
          await api.post(`/api/partner-portal/team/${target!.id}/status`, { status: target!.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE' });
          toast(target!.status === 'ACTIVE' ? 'User suspended.' : 'User reactivated.');
          setTarget(null);
          reload();
        }}
      />
    </>
  );
}

function InviteDialog({ open, roles, onClose, onInvited }: { open: boolean; roles: Team['available_roles']; onClose: () => void; onInvited: () => void }) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [result, setResult] = useState<{ invitation_link?: string } | null>(null);
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const close = () => {
    setEmail('');
    setName('');
    setRole('');
    setResult(null);
    setError(null);
    onClose();
  };
  return (
    <Dialog
      open={open}
      onClose={() => !busy && close()}
      title={result ? 'Invitation sent' : 'Invite a team member'}
      description={result ? undefined : 'They will receive a link to set a password and enrol an authenticator app.'}
      size="lg"
      footer={
        result ? (
          <Button onClick={close}>Done</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={close} disabled={busy}>
              Cancel
            </Button>
            <Button
              loading={busy}
              disabled={!emailOk || !name.trim() || !role}
              onClick={async () => {
                setBusy(true);
                setError(null);
                try {
                  setResult(await api.post<{ invitation_link?: string }>('/api/partner-portal/team/invitations', { email: email.trim(), full_name: name.trim(), role }));
                  onInvited();
                } catch (e) {
                  setError(e);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Send invitation
            </Button>
          </>
        )
      }
    >
      {result ? (
        <div className="space-y-4">
          <Alert tone="success">
            {name} ({email}) has been invited. The invitation is valid for 7 days.
          </Alert>
          {result.invitation_link && (
            <div className="space-y-2">
              <p className="text-sm text-fg">
                <Badge tone="warning">Sandbox</Badge> Email delivery is simulated, so share this one-time link with the invitee directly:
              </p>
              <div className="rounded-md border border-border bg-surface-2 p-3">
                <p className="break-all font-mono text-xs text-fg">{result.invitation_link}</p>
                <div className="mt-2">
                  <CopyButton value={result.invitation_link} label="Copy invitation link" />
                </div>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Full name" required>
              {({ id }) => <Input id={id} autoComplete="off" maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />}
            </Field>
            <Field label="Work email" required error={email && !emailOk ? 'Enter a valid email address' : null}>
              {({ id, describedBy, invalid }) => <Input id={id} type="email" autoComplete="off" aria-describedby={describedBy} aria-invalid={invalid} value={email} onChange={(e) => setEmail(e.target.value)} />}
            </Field>
          </div>
          <fieldset>
            <legend className="text-sm font-medium text-fg">
              Role <span className="text-danger" aria-hidden="true">*</span>
            </legend>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {roles.map((r) => (
                <label key={r.code} className={cn('flex cursor-pointer gap-3 rounded-md border px-3 py-3 transition-colors focus-within:ring-2 focus-within:ring-focus', role === r.code ? 'border-gold bg-gold-soft/40' : 'border-border hover:bg-surface-2')}>
                  <input type="radio" name="role" value={r.code} checked={role === r.code} onChange={() => setRole(r.code)} className="mt-0.5 h-4 w-4 accent-[rgb(var(--color-gold))]" />
                  <span>
                    <span className="block text-sm font-medium text-fg">{r.name}</span>
                    <span className="block text-xs text-muted">{r.description}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <FormError error={error} />
        </div>
      )}
    </Dialog>
  );
}
