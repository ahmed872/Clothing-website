'use client';

import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import { Ban, ShieldCheck, UserCheck } from 'lucide-react';

import { DataTable, type DataTableColumn } from '@/components/admin/data-table';
import { StatusBadge } from '@/components/admin/status-badge';
import { ConfirmationDialog } from '@/components/admin/confirmation-dialog';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from '@/components/ui/toast';
import { setStaffActiveAction, setStaffRoleAction } from '@/lib/admin/user-actions';
import type { Locale } from '@/lib/i18n/locales';

export type StaffRoleValue = 'OWNER' | 'MANAGER' | 'STAFF';

export interface UserRow {
  id: string;
  email: string;
  name: string | null;
  role: StaffRoleValue;
  active: boolean;
  /** Pre-formatted on the server — admin dates are formatted with the
   * store's own calendar rules (`format-admin-date.ts`), which is a server
   * concern, not something to re-derive per client locale here. */
  lastLoginLabel: string | null;
  createdLabel: string;
  /** Whether this row is the signed-in admin's own account. Marks the row
   * and hides its actions — the *server* refuses a self-change either way
   * (`user.service.ts`'s `loadStaffTarget`); this only keeps the UI honest
   * about what it will let you try. */
  isSelf: boolean;
}

export interface UsersTableLabels {
  colUser: string;
  colRole: string;
  colStatus: string;
  colLastLogin: string;
  colCreated: string;
  actions: string;
  emptyTitle: string;
  emptyDescription: string;
  neverSignedIn: string;
  statusActive: string;
  statusDisabled: string;
  you: string;
  roleLabel: string;
  roles: Record<StaffRoleValue, string>;
  roleHelp: Record<StaffRoleValue, string>;
  changeRole: string;
  changeRoleTitle: string;
  changeRoleDescription: string;
  disable: string;
  enable: string;
  confirmDisableTitle: string;
  confirmDisableDescription: string;
  confirmEnableTitle: string;
  confirmEnableDescription: string;
  roleChanged: string;
  disabledToast: string;
  enabledToast: string;
  selfNotice: string;
  save: string;
  saving: string;
  cancel: string;
  confirm: string;
}

const ROLE_ORDER: StaffRoleValue[] = ['OWNER', 'MANAGER', 'STAFF'];

function displayName(row: UserRow): string {
  return row.name?.trim() || row.email;
}

/**
 * The staff list, its role editor and its enable/disable switch (P14 §B).
 *
 * Built client-side from plain serializable rows for the same reason every
 * other admin list table is (see `brands-table.tsx`): `DataTable`'s cell
 * renderers are functions and cannot cross the Server → Client boundary.
 *
 * Nothing here is authorization. The page only renders for a caller that
 * passed `requireAdminPermission('users.manage')`, and each action re-runs
 * `requirePermission` server-side before touching a row — hiding a button
 * is a courtesy to the person, not a control (P06 §7/§17).
 */
export function UsersTable({
  rows,
  locale,
  labels,
}: {
  rows: UserRow[];
  locale: Locale;
  labels: UsersTableLabels;
}) {
  const router = useRouter();
  const roleSelectId = useId();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [roleTarget, setRoleTarget] = useState<UserRow | null>(null);
  const [pendingRole, setPendingRole] = useState<StaffRoleValue>('STAFF');
  const [activeTarget, setActiveTarget] = useState<UserRow | null>(null);

  function openRoleDialog(row: UserRow): void {
    setError(null);
    setPendingRole(row.role);
    setRoleTarget(row);
  }

  async function saveRole(): Promise<void> {
    if (!roleTarget) return;
    setBusyId(roleTarget.id);
    setError(null);
    const result = await setStaffRoleAction(roleTarget.id, pendingRole, locale);
    setBusyId(null);
    if (!result.ok) {
      setError(result.error ?? null);
      return;
    }
    setRoleTarget(null);
    toast({ title: labels.roleChanged, variant: 'success' });
    router.refresh();
  }

  async function toggleActive(): Promise<void> {
    if (!activeTarget) return;
    const next = !activeTarget.active;
    setBusyId(activeTarget.id);
    setError(null);
    const result = await setStaffActiveAction(activeTarget.id, next, locale);
    setBusyId(null);
    if (!result.ok) {
      setError(result.error ?? null);
      return;
    }
    setActiveTarget(null);
    toast({ title: next ? labels.enabledToast : labels.disabledToast, variant: 'success' });
    router.refresh();
  }

  const columns: DataTableColumn<UserRow>[] = [
    {
      key: 'user',
      header: labels.colUser,
      cell: (row) => (
        <div className="flex flex-col">
          <span className="font-medium text-(--color-text)">
            {displayName(row)}
            {row.isSelf ? (
              <span className="ms-2 text-caption font-normal text-(--color-text-muted)">
                ({labels.you})
              </span>
            ) : null}
          </span>
          {/* An email address is one LTR run in both languages. */}
          <span dir="ltr" className="text-caption text-(--color-text-muted)">
            {row.email}
          </span>
        </div>
      ),
    },
    {
      key: 'role',
      header: labels.colRole,
      cell: (row) => (
        <StatusBadge
          label={labels.roles[row.role]}
          tone={row.role === 'OWNER' ? 'info' : 'neutral'}
        />
      ),
    },
    {
      key: 'status',
      header: labels.colStatus,
      cell: (row) => (
        <StatusBadge
          label={row.active ? labels.statusActive : labels.statusDisabled}
          tone={row.active ? 'success' : 'error'}
        />
      ),
    },
    {
      key: 'lastLogin',
      header: labels.colLastLogin,
      cell: (row) => (
        <span className="text-(--color-text-muted)">
          {row.lastLoginLabel ?? labels.neverSignedIn}
        </span>
      ),
    },
    {
      key: 'created',
      header: labels.colCreated,
      cell: (row) => <span className="text-(--color-text-muted)">{row.createdLabel}</span>,
    },
    {
      key: 'actions',
      header: labels.actions,
      align: 'end',
      cell: (row) =>
        row.isSelf ? (
          <span className="text-caption text-(--color-text-muted)">{labels.selfNotice}</span>
        ) : (
          <div className="flex items-center justify-end gap-1">
            <Button
              variant="ghost"
              size="icon"
              aria-label={`${labels.changeRole} — ${displayName(row)}`}
              disabled={busyId === row.id}
              onClick={() => openRoleDialog(row)}
            >
              <ShieldCheck className="size-4" aria-hidden="true" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label={`${row.active ? labels.disable : labels.enable} — ${displayName(row)}`}
              disabled={busyId === row.id}
              onClick={() => {
                setError(null);
                setActiveTarget(row);
              }}
            >
              {row.active ? (
                <Ban className="size-4 text-(--color-error)" aria-hidden="true" />
              ) : (
                <UserCheck className="size-4 text-(--color-success)" aria-hidden="true" />
              )}
            </Button>
          </div>
        ),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <DataTable
        columns={columns}
        rows={rows}
        getRowId={(row) => row.id}
        emptyTitle={labels.emptyTitle}
        emptyDescription={labels.emptyDescription}
      />

      <Dialog
        open={roleTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRoleTarget(null);
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {labels.changeRoleTitle.replace('{user}', roleTarget ? displayName(roleTarget) : '')}
            </DialogTitle>
            <DialogDescription>{labels.changeRoleDescription}</DialogDescription>
          </DialogHeader>

          {/* Inside the dialog, not above the table: a refusal ("you cannot
              demote the last owner") arrives while this is open, and an
              alert behind the overlay is one nobody reads. */}
          {error ? (
            <Alert variant="error" role="alert">
              {error}
            </Alert>
          ) : null}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={roleSelectId}>{labels.roleLabel}</Label>
            <Select
              value={pendingRole}
              onValueChange={(value) => setPendingRole(value as StaffRoleValue)}
            >
              <SelectTrigger id={roleSelectId}>
                <SelectValue>{labels.roles[pendingRole]}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {ROLE_ORDER.map((role) => (
                  <SelectItem key={role} value={role}>
                    {labels.roles[role]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-caption text-(--color-text-muted)">{labels.roleHelp[pendingRole]}</p>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setRoleTarget(null)}
              disabled={busyId !== null}
            >
              {labels.cancel}
            </Button>
            <Button
              onClick={saveRole}
              loading={busyId !== null}
              disabled={roleTarget?.role === pendingRole}
            >
              {busyId !== null ? labels.saving : labels.save}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmationDialog
        open={activeTarget !== null}
        onOpenChange={(open) => {
          if (!open) setActiveTarget(null);
        }}
        title={activeTarget?.active ? labels.confirmDisableTitle : labels.confirmEnableTitle}
        // Same reason as the role dialog above: a server refusal has to be
        // readable without closing the thing that caused it. `ConfirmationDialog`
        // has one slot for prose, so the error replaces the prompt rather
        // than sitting behind the overlay.
        description={
          error ??
          (activeTarget?.active
            ? labels.confirmDisableDescription
            : labels.confirmEnableDescription
          ).replace('{user}', activeTarget ? displayName(activeTarget) : '')
        }
        confirmLabel={labels.confirm}
        cancelLabel={labels.cancel}
        onConfirm={toggleActive}
        destructive={activeTarget?.active ?? false}
        loading={busyId !== null}
      />
    </div>
  );
}
