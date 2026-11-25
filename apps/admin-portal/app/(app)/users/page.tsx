'use client';

import { useEffect, useState } from 'react';
import { Alert, Badge, Button, Card, DataTable, EmptyState, Field, Input, PageHeader, StatusBadge, Tabs, cn, formatDate, formatDateTime } from '@araf/ui';
import { api } from '@/lib/api';
import { toInt } from '@/lib/forms';
import { useApi } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { ActionDialog, Async, Guard, Mono, Toolbar, FilterField, filterControl } from '@/components/common';
import { Icon } from '@/components/icons';

interface Staff { id: string; email: string; full_name: string; status: string; last_login_at: string | null; roles: Array<{ code: string; name: string; expires_at: string | null }> }
interface Role { code: string; name: string; description: string; permissions: string[] }
interface UsersRes { users: Staff[]; roles: Role[] }

export default function UsersPage() {
  return <Guard perm="user.manage"><Users /></Guard>;
}

function Users() {
  const { me } = useSession();
  const state = useApi<UsersRes>('/api/admin/users');
  const [tab, setTab] = useState('staff');
  const [q, setQ] = useState('');
  const [roleFor, setRoleFor] = useState<Staff | 'new' | null>(null);
  const [statusFor, setStatusFor] = useState<Staff | null>(null);
  const [revokeFor, setRevokeFor] = useState<Staff | null>(null);
  useEffect(() => { document.title = 'Users & roles · Pay with ARAF admin'; }, []);
  const users = state.data?.users.filter((u) => !q || `${u.full_name} ${u.email} ${u.roles.map((r) => r.name).join(' ')}`.toLowerCase().includes(q.toLowerCase()));

  return (
    <>
      <PageHeader
        eyebrow="Platform"
        title="Users & roles"
        description="Role changes and new staff invitations are proposed here and take effect only after an Information Security Officer (user.approve) approves them. You cannot change your own roles."
        actions={<Button onClick={() => setRoleFor('new')}>{Icon.plus()} Invite staff</Button>}
      />
      <Tabs label="Users and roles" value={tab} onChange={setTab} tabs={[{ id: 'staff', label: 'Staff', count: state.data?.users.length }, { id: 'roles', label: 'Roles catalogue', count: state.data?.roles.length }]} />
      <div className="mt-6">
        {tab === 'staff' && (
          <Card>
            <Toolbar>
              <FilterField label="Search" className="min-w-[16rem]">{(id) => <input id={id} type="search" className={filterControl} placeholder="Name, email or role" value={q} onChange={(e) => setQ(e.target.value)} />}</FilterField>
            </Toolbar>
            <Async state={{ ...state, data: users }} rows={8} empty={<EmptyState title="No staff match" />}>
              {(rows) => (
                <DataTable
                  caption="Staff users"
                  rows={rows}
                  rowKey={(u) => u.id}
                  columns={[
                    { key: 'n', header: 'User', sortValue: (u) => u.full_name, cell: (u) => <div><p className="font-medium">{u.full_name}{u.id === me.user.id && <span className="ml-2 text-2xs font-normal text-subtle">(you)</span>}</p><p className="text-xs text-muted">{u.email}</p></div> },
                    { key: 'r', header: 'Roles', cell: (u) => <span className="flex max-w-md flex-wrap gap-1">{u.roles.length ? u.roles.map((r) => <Badge key={r.code} tone="gold">{r.name}{r.expires_at ? ` · until ${formatDate(r.expires_at)}` : ''}</Badge>) : <span className="text-subtle">No roles</span>}</span> },
                    { key: 'l', header: 'Last sign-in', sortValue: (u) => u.last_login_at ?? '', cell: (u) => <span className="whitespace-nowrap text-muted">{formatDateTime(u.last_login_at)}</span> },
                    { key: 's', header: 'Status', sortValue: (u) => u.status, cell: (u) => <StatusBadge status={u.status} /> },
                    {
                      key: 'x', header: <span className="sr-only">Actions</span>, cell: (u) => u.id === me.user.id ? <span className="text-xs text-subtle">Managed by another officer</span> : (
                        <div className="flex flex-nowrap justify-end gap-1 whitespace-nowrap">
                          <Button size="sm" variant="secondary" onClick={() => setRoleFor(u)}>Change roles</Button>
                          <Button size="sm" variant="ghost" onClick={() => setStatusFor(u)}>{u.status === 'SUSPENDED' ? 'Reactivate' : 'Suspend'}</Button>
                          <Button size="sm" variant="ghost" onClick={() => setRevokeFor(u)}>Revoke sessions</Button>
                        </div>
                      ),
                    },
                  ]}
                />
              )}
            </Async>
          </Card>
        )}
        {tab === 'roles' && (
          <Async state={state} rows={8}>
            {(d) => (
              <div className="grid gap-4 lg:grid-cols-2">
                {d.roles.map((r) => (
                  <Card key={r.code} className="p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div><h2 className="text-sm font-semibold">{r.name}</h2><Mono className="text-subtle">{r.code}</Mono></div>
                      <Badge>{d.users.filter((u) => u.roles.some((x) => x.code === r.code)).length} users</Badge>
                    </div>
                    <p className="mt-2 text-sm text-muted">{r.description}</p>
                    <ul className="mt-3 flex flex-wrap gap-1">{r.permissions.map((p) => <li key={p}><code className={cn('rounded-sm border px-1.5 py-0.5 font-mono text-2xs', /approve/.test(p) ? 'border-gold/40 bg-gold-soft text-gold-strong' : 'border-border bg-surface-2 text-muted')}>{p}</code></li>)}</ul>
                  </Card>
                ))}
              </div>
            )}
          </Async>
        )}
      </div>
      {state.data && <RoleDialog target={roleFor} roles={state.data.roles} onClose={() => setRoleFor(null)} onDone={state.reload} />}
      <ActionDialog
        open={!!statusFor}
        onClose={() => setStatusFor(null)}
        title={statusFor?.status === 'SUSPENDED' ? `Reactivate ${statusFor?.full_name}` : `Suspend ${statusFor?.full_name}`}
        description={statusFor?.status === 'SUSPENDED' ? 'The user can sign in again with their existing roles.' : 'The user is signed out of every session and cannot sign in until reactivated.'}
        confirmLabel={statusFor?.status === 'SUSPENDED' ? 'Reactivate' : 'Suspend user'}
        tone={statusFor?.status === 'SUSPENDED' ? 'primary' : 'danger'}
        reason={{ label: 'Reason', minLength: 3 }}
        onConfirm={(reason) => api.post(`/api/admin/users/${statusFor!.id}/status`, { status: statusFor!.status === 'SUSPENDED' ? 'ACTIVE' : 'SUSPENDED', reason })}
        successMessage={statusFor?.status === 'SUSPENDED' ? 'User reactivated' : 'User suspended'}
        onDone={state.reload}
      />
      <ActionDialog
        open={!!revokeFor}
        onClose={() => setRevokeFor(null)}
        title={`Revoke all sessions for ${revokeFor?.full_name}`}
        description="Signs the user out everywhere immediately. They can sign in again with password and MFA."
        confirmLabel="Revoke sessions"
        tone="danger"
        onConfirm={() => api.post<{ revoked: number }>(`/api/admin/users/${revokeFor!.id}/revoke-sessions`)}
        successMessage={(r) => `${r.revoked} session${r.revoked === 1 ? '' : 's'} revoked`}
      />
    </>
  );
}

function RoleDialog({ target, roles, onClose, onDone }: { target: Staff | 'new' | null; roles: Role[]; onClose: () => void; onDone: () => void }) {
  const isNew = target === 'new';
  const [selected, setSelected] = useState<string[]>([]);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [temp, setTemp] = useState('');
  useEffect(() => {
    setSelected(target && target !== 'new' ? target.roles.map((r) => r.code) : []);
    setEmail(''); setName(''); setTemp('');
  }, [target]);
  const sod = selected.includes('CREDIT_ANALYST') && selected.includes('CREDIT_RISK_REVIEWER');
  return (
    <ActionDialog
      open={!!target}
      onClose={onClose}
      size="lg"
      title={isNew ? 'Invite a staff member' : `Change roles — ${target ? target.full_name : ''}`}
      description={isNew ? 'Creates a role-assignment request. When approved, an invitation link is sent to the email address.' : 'Replaces the user’s roles once approved. The user’s sessions are revoked when the change takes effect.'}
      confirmLabel="Submit for approval"
      reason={{ label: 'Reason / business justification', minLength: 5 }}
      validate={() => {
        if (!selected.length) return 'Select at least one role.';
        if (isNew && !/^\S+@\S+\.\S+$/.test(email)) return 'Enter a valid email address.';
        if (isNew && name.trim().length < 2) return 'Enter the person’s full name.';
        const t = toInt(temp);
        if (temp && (!t || t < 1 || t > 30)) return 'Temporary access must be 1–30 days.';
        return null;
      }}
      onConfirm={(reason) => api.post<{ reference: string }>('/api/admin/users/role-requests', {
        ...(isNew ? { email: email.trim(), full_name: name.trim() } : { user_id: (target as Staff).id }),
        roles: selected,
        ...(temp ? { temporary_days: toInt(temp) } : {}),
        reason,
      })}
      successMessage={(r) => `Request ${r.reference} sent for approval`}
      onDone={onDone}
    >
      <div className="space-y-4">
        {isNew && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Work email" required>{(ids) => <Input id={ids.id} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />}</Field>
            <Field label="Full name" required>{(ids) => <Input id={ids.id} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
          </div>
        )}
        <fieldset>
          <legend className="mb-2 text-sm font-medium">Roles <span className="text-danger" aria-hidden="true">*</span></legend>
          <div className="grid max-h-72 gap-1.5 overflow-y-auto rounded-md border border-border p-2 sm:grid-cols-2">
            {roles.map((r) => (
              <label key={r.code} className={cn('flex cursor-pointer items-start gap-2 rounded px-2 py-1.5 hover:bg-surface-2', selected.includes(r.code) && 'bg-gold-soft/50')}>
                <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[rgb(var(--color-gold))]" checked={selected.includes(r.code)} onChange={(e) => setSelected(e.target.checked ? [...selected, r.code] : selected.filter((x) => x !== r.code))} />
                <span><span className="block text-sm font-medium">{r.name}</span><span className="block text-2xs text-muted">{r.permissions.length} permissions</span></span>
              </label>
            ))}
          </div>
        </fieldset>
        {sod && <Alert tone="warning" title="Segregation of duties">Credit Analyst (maker) and Credit Risk Reviewer (checker) on one person weakens maker–checker. Runtime checks still prevent self-approval.</Alert>}
        <Field label="Temporary access (days)" hint="Optional, 1–30. Roles expire automatically.">{(ids) => <Input id={ids.id} inputMode="numeric" aria-describedby={ids.describedBy} value={temp} onChange={(e) => setTemp(e.target.value.replace(/\D/g, ''))} className="max-w-[10rem]" />}</Field>
      </div>
    </ActionDialog>
  );
}
