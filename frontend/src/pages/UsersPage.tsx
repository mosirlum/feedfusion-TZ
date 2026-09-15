import { FormEvent, useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import { Plus, Search, Users as UsersIcon, UserCheck, UserX, ShieldCheck, UserCog, ShoppingCart, Mail, Phone, Trash2, TriangleAlert, KeyRound } from 'lucide-react';
import { usersApi, apiErrorMessage } from '../lib/api';
import { PublicUser, UserRole } from '../types';
import { formatDate } from '../lib/format';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  FormField,
  FullPageSpinner,
  Input,
  Modal,
  PageHeader,
  Select,
  StatCard,
  Table,
  Td,
  Th,
  THead,
  Tr,
  UserAvatar,
} from '../components/ui';
import { useToast } from '../components/ui/Toast';
import { useAuth } from '../context/AuthContext';
import { isValidTzPhone, sanitizePhoneInput, TZ_PHONE_PLACEHOLDER, TZ_PHONE_HINT, TZ_PHONE_ERROR } from '../lib/phone';

/**
 * Users page redesign (2026-09-12, CLAUDE.md #44) — the owner asked for
 * "better UI" with no reference mockup this time, so this follows the same
 * visual language as every other redesigned page this session (stat cards,
 * colored-initials avatars, search + filter pills) rather than inventing a
 * new one. Everything shown is real: the 4 stat cards are plain counts over
 * the already-loaded user list (no fabricated "vs last month" trend, since
 * there's no historical snapshot of user counts to compare against — unlike
 * Reports/Audit Log, which have a real date-filtered query to diff against
 * a previous period).
 *
 * Delete (2026-09-12, CLAUDE.md #45) — added after the owner pushed back on
 * Deactivate-only. Every other table's foreign key into `users` has no
 * cascade rule, so this can only ever succeed for an account with zero
 * recorded activity; the backend lets Postgres's own constraint do that
 * check (see usersRepo.deleteUser) rather than duplicating the list of
 * referencing tables here, and surfaces a clear "has recorded activity,
 * deactivate instead" message when it's blocked.
 */

const ROLE_TABS = ['All', 'owner', 'manager', 'sales'] as const;
type RoleTab = (typeof ROLE_TABS)[number];

const ROLE_LABEL: Record<UserRole, string> = { owner: 'Owner', manager: 'Manager', sales: 'Sales' };
const ROLE_ICON: Record<UserRole, typeof ShieldCheck> = { owner: ShieldCheck, manager: UserCog, sales: ShoppingCart };
const ROLE_BADGE_TONE: Record<UserRole, 'green' | 'blue' | 'amber'> = { owner: 'amber', manager: 'blue', sales: 'green' };

export default function UsersPage() {
  const { user: me } = useAuth();
  const toast = useToast();
  const [users, setUsers] = useState<PublicUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [updatingId, setUpdatingId] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [roleTab, setRoleTab] = useState<RoleTab>('All');
  const [deleteTarget, setDeleteTarget] = useState<PublicUser | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [resetTarget, setResetTarget] = useState<PublicUser | null>(null);

  function load() {
    setLoading(true);
    usersApi
      .list()
      .then((res) => setUsers(res.data))
      .catch((err) => toast.error(apiErrorMessage(err, 'Could not load users.')))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function toggleStatus(u: PublicUser) {
    setUpdatingId(u.id);
    try {
      await usersApi.update(u.id, { status: u.status === 'active' ? 'inactive' : 'active' });
      toast.success(`${u.name} is now ${u.status === 'active' ? 'inactive' : 'active'}.`);
      load();
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Could not update this user.'));
    } finally {
      setUpdatingId(null);
    }
  }

  async function changeRole(u: PublicUser, role: UserRole) {
    setUpdatingId(u.id);
    try {
      await usersApi.update(u.id, { role });
      toast.success(`${u.name}'s role updated to ${role}.`);
      load();
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Could not update this user.'));
    } finally {
      setUpdatingId(null);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeletingId(deleteTarget.id);
    try {
      await usersApi.remove(deleteTarget.id);
      toast.success(`${deleteTarget.name} was deleted.`);
      setDeleteTarget(null);
      load();
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Could not delete this user.'));
    } finally {
      setDeletingId(null);
    }
  }

  const stats = useMemo(
    () => ({
      total: users.length,
      active: users.filter((u) => u.status === 'active').length,
      inactive: users.filter((u) => u.status === 'inactive').length,
      owners: users.filter((u) => u.role === 'owner').length,
    }),
    [users]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return users.filter((u) => {
      if (roleTab !== 'All' && u.role !== roleTab) return false;
      if (!q) return true;
      return u.name.toLowerCase().includes(q) || (u.email ?? '').toLowerCase().includes(q) || (u.phone ?? '').includes(q);
    });
  }, [users, search, roleTab]);

  return (
    <div>
      <PageHeader
        title="Users"
        subtitle="Every account is separate — no shared logins (BR-02)."
        icon={<UsersIcon size={20} />}
        action={<Button icon={<Plus size={16} />} onClick={() => setCreateOpen(true)}>New User</Button>}
      />

      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Total Users" value={stats.total} icon={<UsersIcon size={18} />} tone="blue" />
        <StatCard label="Active" value={stats.active} icon={<UserCheck size={18} />} tone="green" />
        <StatCard label="Inactive" value={stats.inactive} icon={<UserX size={18} />} tone="red" />
        <StatCard label="Owners" value={stats.owners} icon={<ShieldCheck size={18} />} tone="amber" />
      </div>

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-xs">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-[#77857c]" />
          <Input placeholder="Search by name, email or phone…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <div className="flex flex-wrap gap-2">
          {ROLE_TABS.map((r) => {
            const Icon = r === 'All' ? UsersIcon : ROLE_ICON[r];
            const label = r === 'All' ? 'All' : ROLE_LABEL[r];
            return (
              <button
                key={r}
                onClick={() => setRoleTab(r)}
                className={clsx(
                  'flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors',
                  roleTab === r ? 'bg-green-600 text-white shadow-card' : 'bg-white dark:bg-[#121a16] text-slate-600 dark:text-[#b6c2ba] border border-slate-200 dark:border-[rgba(255,255,255,0.14)] hover:bg-slate-50'
                )}
              >
                <Icon size={14} />
                {label}
              </button>
            );
          })}
        </div>
      </div>

      <Card>
        {loading ? (
          <FullPageSpinner />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<UsersIcon size={32} />}
            title="No users match this search."
            description={search || roleTab !== 'All' ? 'Try a different name, email, phone or role filter.' : 'Add your first team member to get started.'}
          />
        ) : (
          <Table>
            <THead>
              <tr>
                <Th>Name</Th>
                <Th>Contact</Th>
                <Th>Role</Th>
                <Th>Status</Th>
                <Th>Joined</Th>
                <Th></Th>
              </tr>
            </THead>
            <tbody>
              {filtered.map((u) => (
                <Tr key={u.id}>
                  <Td>
                    <div className="flex items-center gap-2.5">
                      <UserAvatar name={u.name} size={32} />
                      <div>
                        <p className="font-medium text-slate-800 dark:text-[#eef3ef]">
                          {u.name}
                          {u.id === me?.id && (
                            <span className="ml-1.5 rounded-full bg-slate-100 dark:bg-[#0e1512] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-[#97a49b]">
                              You
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-slate-400 dark:text-[#77857c]">USER-{String(u.id).padStart(3, '0')}</p>
                      </div>
                    </div>
                  </Td>
                  <Td className="text-slate-500 dark:text-[#97a49b]">
                    <div className="flex flex-col gap-0.5">
                      <span className="flex items-center gap-1.5">
                        <Mail size={12} className="text-slate-400 dark:text-[#77857c]" />
                        {u.email ?? '—'}
                      </span>
                      {u.phone && (
                        <span className="flex items-center gap-1.5 text-xs text-slate-400 dark:text-[#77857c]">
                          <Phone size={11} />
                          {u.phone}
                        </span>
                      )}
                    </div>
                  </Td>
                  <Td>
                    <div className="flex items-center gap-2">
                      <Badge tone={ROLE_BADGE_TONE[u.role]}>{ROLE_LABEL[u.role]}</Badge>
                      <Select
                        value={u.role}
                        disabled={updatingId === u.id || u.id === me?.id}
                        onChange={(e) => changeRole(u, e.target.value as UserRole)}
                        className="w-auto py-1 text-xs"
                        aria-label={`Change role for ${u.name}`}
                      >
                        <option value="owner">Owner</option>
                        <option value="sales">Sales</option>
                        <option value="manager">Manager</option>
                      </Select>
                    </div>
                  </Td>
                  <Td>
                    <span className="inline-flex items-center gap-1.5">
                      <span className={clsx('h-1.5 w-1.5 rounded-full', u.status === 'active' ? 'bg-green-500' : 'bg-slate-300')} />
                      <Badge tone={u.status === 'active' ? 'green' : 'slate'}>{u.status}</Badge>
                    </span>
                  </Td>
                  <Td className="text-slate-400 dark:text-[#77857c] text-xs">{formatDate(u.created_at)}</Td>
                  <Td>
                    <div className="flex items-center justify-end gap-2">
                      <Button
                        size="sm"
                        variant={u.status === 'active' ? 'outline' : 'primary'}
                        loading={updatingId === u.id}
                        disabled={u.id === me?.id}
                        onClick={() => toggleStatus(u)}
                      >
                        {u.status === 'active' ? 'Deactivate' : 'Activate'}
                      </Button>
                      <button
                        title={u.id === me?.id ? 'Change your own password from My Profile' : `Reset ${u.name}'s password`}
                        disabled={u.id === me?.id}
                        onClick={() => setResetTarget(u)}
                        className="rounded-lg p-2 text-slate-400 dark:text-[#77857c] transition-colors hover:bg-blue-50 hover:text-blue-600 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-slate-400"
                      >
                        <KeyRound size={15} />
                      </button>
                      <button
                        title={u.id === me?.id ? "You can't delete your own account" : `Delete ${u.name}`}
                        disabled={u.id === me?.id}
                        onClick={() => setDeleteTarget(u)}
                        className="rounded-lg p-2 text-slate-400 dark:text-[#77857c] transition-colors hover:bg-danger-50 hover:text-danger-600 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-slate-400"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <CreateUserModal open={createOpen} onClose={() => setCreateOpen(false)} onCreated={() => { setCreateOpen(false); load(); }} />

      <ResetPasswordModal target={resetTarget} onClose={() => setResetTarget(null)} />

      <Modal
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title="Delete user"
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button variant="danger" loading={deletingId === deleteTarget?.id} onClick={confirmDelete}>
              Delete User
            </Button>
          </>
        }
      >
        {deleteTarget && (
          <div className="flex gap-3">
            <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-danger-50 text-danger-600">
              <TriangleAlert size={18} />
            </div>
            <div className="text-sm text-slate-600 dark:text-[#b6c2ba]">
              <p>
                Delete <span className="font-semibold text-slate-800 dark:text-[#eef3ef]">{deleteTarget.name}</span> ({deleteTarget.email})? This permanently
                removes the account and cannot be undone.
              </p>
              <p className="mt-2 text-xs text-slate-400 dark:text-[#77857c]">
                This only works if the account has no recorded activity yet (no sales, purchases, stock records, etc.). If it does, delete
                will be blocked — deactivate the account instead.
              </p>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

// Owner resets a forgotten password (2026-09-12, CLAUDE.md #47) — same UX as
// creating an account: the owner types a new temporary password, which
// forces a real change (ForceChangePasswordPage) the next time that person
// logs in.
function ResetPasswordModal({ target, onClose }: { target: PublicUser | null; onClose: () => void }) {
  const toast = useToast();
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (target) setPassword('');
  }, [target]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!target) return;
    setSubmitting(true);
    try {
      await usersApi.resetPassword(target.id, password);
      toast.success(`${target.name}'s password was reset. Share the new temporary password with them directly.`);
      onClose();
    } catch (err) {
      toast.error(apiErrorMessage(err, "Could not reset this user's password."));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open={target !== null} onClose={onClose} title="Reset password" size="sm">
      {target && (
        <form onSubmit={handleSubmit} className="space-y-3">
          <p className="text-sm text-slate-500 dark:text-[#97a49b]">
            Type a new temporary password for <span className="font-semibold text-slate-800 dark:text-[#eef3ef]">{target.name}</span>.
            They'll be asked to set their own password the next time they log in.
          </p>
          <FormField label="New temporary password">
            <Input type="text" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} autoFocus />
          </FormField>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={submitting}>
              Reset Password
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

function CreateUserModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<UserRole>('sales');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setName('');
      setEmail('');
      setPhone('');
      setPassword('');
      setRole('sales');
    }
  }, [open]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (phone.trim() && !isValidTzPhone(phone)) {
      toast.error(TZ_PHONE_ERROR);
      return;
    }
    setSubmitting(true);
    try {
      await usersApi.create({ name: name.trim(), email: email.trim(), phone: phone.trim() || undefined, password, role });
      toast.success('User created.');
      onCreated();
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Could not create this user.'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="New User" size="sm">
      <form onSubmit={handleSubmit} className="space-y-3">
        <FormField label="Full name">
          <Input value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
        </FormField>
        <FormField label="Email">
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </FormField>
        <FormField label="Phone" hint={TZ_PHONE_HINT}>
          <Input
            placeholder={TZ_PHONE_PLACEHOLDER}
            inputMode="numeric"
            value={phone}
            onChange={(e) => setPhone(sanitizePhoneInput(e.target.value))}
          />
        </FormField>
        <FormField label="Temporary password">
          <Input type="text" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} />
        </FormField>
        <FormField label="Role">
          <Select value={role} onChange={(e) => setRole(e.target.value as UserRole)}>
            <option value="sales">Sales</option>
            <option value="owner">Owner</option>
            <option value="manager">Manager</option>
          </Select>
        </FormField>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={submitting}>
            Create User
          </Button>
        </div>
      </form>
    </Modal>
  );
}
