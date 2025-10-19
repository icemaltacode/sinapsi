import { useCallback, useEffect, useState } from 'react';
import { Loader2, Pencil, Plus, Trash2 } from 'lucide-react';

import { Button } from '../../components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '../../components/ui/dialog';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { apiRequest } from '../../lib/api';
import { useAuth } from '../../context/auth-context';

interface AdminUser {
  userId: string;
  email: string;
  displayName: string;
  role: 'student' | 'admin';
  firstName?: string;
  lastName?: string;
  avatarKey?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

interface UsersResponse {
  items: AdminUser[];
  nextCursor?: string | null;
}

interface FormState {
  email: string;
  displayName: string;
  firstName: string;
  lastName: string;
  role: 'student' | 'admin';
  avatarKey: string;
  temporaryPassword: string;
}

const defaultFormState: FormState = {
  email: '',
  displayName: '',
  firstName: '',
  lastName: '',
  role: 'student',
  avatarKey: '',
  temporaryPassword: ''
};

function UserDialog({
  mode,
  triggerLabel,
  onCompleted,
  initialUser
}: {
  mode: 'create' | 'edit';
  triggerLabel: string;
  onCompleted: (payload: { user: AdminUser; temporaryPassword?: string }) => void;
  initialUser?: AdminUser;
}) {
  const { idToken } = useAuth();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(defaultFormState);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open && initialUser) {
      setForm({
        email: initialUser.email,
        displayName: initialUser.displayName,
        firstName: initialUser.firstName ?? '',
        lastName: initialUser.lastName ?? '',
        role: initialUser.role,
        avatarKey: initialUser.avatarKey ?? '',
        temporaryPassword: ''
      });
    } else if (!open) {
      setForm(defaultFormState);
      setError(null);
    }
  }, [open, initialUser]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!idToken) return;

    setLoading(true);
    setError(null);

    try {
      if (mode === 'create') {
        const response = await apiRequest<{ user: AdminUser; temporaryPassword?: string }>(
          '/admin/users',
          {
            method: 'POST',
            token: idToken,
            body: {
              email: form.email,
              displayName: form.displayName,
              firstName: form.firstName || undefined,
              lastName: form.lastName || undefined,
              role: form.role,
              avatarKey: form.avatarKey || undefined,
              temporaryPassword: form.temporaryPassword || undefined
            }
          }
        );
        onCompleted(response);
      } else if (initialUser) {
        const response = await apiRequest<{ user: AdminUser }>(
          `/admin/users/${initialUser.userId}`,
          {
            method: 'PUT',
            token: idToken,
            body: {
              displayName: form.displayName,
              firstName: form.firstName || undefined,
              lastName: form.lastName || undefined,
              role: form.role,
              avatarKey: form.avatarKey || undefined
            }
          }
        );
        onCompleted({ user: response.user });
      }

      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save user');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={mode === 'create' ? 'default' : 'ghost'} size={mode === 'create' ? 'default' : 'icon'}>
          {mode === 'create' ? (
            <>
              <Plus className='mr-2 h-4 w-4' />
              {triggerLabel}
            </>
          ) : (
            <Pencil className='h-4 w-4' />
          )}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{mode === 'create' ? 'Invite new user' : 'Edit user'}</DialogTitle>
          <DialogDescription>
            {mode === 'create'
              ? 'Provision a new Sinapsi user and send them their temporary password.'
              : 'Update profile details and role.'}
          </DialogDescription>
        </DialogHeader>

        <form className='space-y-4' onSubmit={handleSubmit}>
          {mode === 'create' ? (
            <div className='grid gap-2'>
              <Label htmlFor='email'>Email</Label>
              <Input
                id='email'
                type='email'
                required
                value={form.email}
                onChange={(event) => setForm((state) => ({ ...state, email: event.target.value }))}
              />
            </div>
          ) : null}

          <div className='grid gap-2'>
            <Label htmlFor='displayName'>Display name</Label>
            <Input
              id='displayName'
              required
              value={form.displayName}
              onChange={(event) => setForm((state) => ({ ...state, displayName: event.target.value }))}
            />
          </div>

          <div className='grid gap-2 md:grid-cols-2'>
            <div className='grid gap-2'>
              <Label htmlFor='firstName'>First name</Label>
              <Input
                id='firstName'
                value={form.firstName}
                onChange={(event) => setForm((state) => ({ ...state, firstName: event.target.value }))}
              />
            </div>
            <div className='grid gap-2'>
              <Label htmlFor='lastName'>Last name</Label>
              <Input
                id='lastName'
                value={form.lastName}
                onChange={(event) => setForm((state) => ({ ...state, lastName: event.target.value }))}
              />
            </div>
          </div>

          <div className='grid gap-2'>
            <Label htmlFor='avatar'>Avatar key (optional)</Label>
            <Input
              id='avatar'
              value={form.avatarKey}
              onChange={(event) => setForm((state) => ({ ...state, avatarKey: event.target.value }))}
            />
          </div>

          <div className='grid gap-2'>
            <Label htmlFor='role'>Role</Label>
            <select
              id='role'
              className='h-10 rounded-lg border border-input bg-background/80 px-3 text-sm'
              value={form.role}
              onChange={(event) => setForm((state) => ({ ...state, role: event.target.value as 'student' | 'admin' }))}
            >
              <option value='student'>Student</option>
              <option value='admin'>Admin</option>
            </select>
          </div>

          {mode === 'create' ? (
            <div className='grid gap-2'>
              <Label htmlFor='tempPassword'>Temporary password (optional)</Label>
              <Input
                id='tempPassword'
                value={form.temporaryPassword}
                onChange={(event) =>
                  setForm((state) => ({ ...state, temporaryPassword: event.target.value }))
                }
                placeholder='Auto-generate if left blank'
              />
            </div>
          ) : null}

          {error ? <p className='text-sm text-destructive'>{error}</p> : null}

          <DialogFooter>
            <DialogClose asChild>
              <Button type='button' variant='ghost'>
                Cancel
              </Button>
            </DialogClose>
            <Button type='submit' disabled={loading}>
              {loading ? (
                <>
                  <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                  Saving…
                </>
              ) : (
                mode === 'create' ? 'Create user' : 'Save changes'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function AdminUsersPage() {
  const { idToken } = useAuth();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [inputValue, setInputValue] = useState('');
  const [nextCursor, setNextCursor] = useState<string | undefined>();
  const [cursorStack, setCursorStack] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  const fetchUsers = useCallback(
    async ({ cursor, searchTerm }: { cursor?: string; searchTerm?: string } = {}) => {
      if (!idToken) return;
      setLoading(true);
      setError(null);
      try {
        const response = await apiRequest<UsersResponse>('/admin/users', {
          token: idToken,
          query: {
            limit: 10,
            cursor,
            search: searchTerm ?? search
          }
        });
        setUsers(response.items);
        setNextCursor(response.nextCursor ?? undefined);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unable to load users');
      } finally {
        setLoading(false);
      }
    },
    [idToken, search]
  );

  useEffect(() => {
    if (idToken) {
      fetchUsers();
    }
  }, [idToken, fetchUsers]);

  const handleSearch = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSearch(inputValue);
    setCursorStack([]);
    fetchUsers({ searchTerm: inputValue, cursor: undefined });
  };

  const handleNext = () => {
    if (!nextCursor) return;
    setCursorStack((stack) => [...stack, nextCursor]);
    fetchUsers({ cursor: nextCursor });
  };

  const handlePrev = () => {
    setCursorStack((stack) => {
      const next = [...stack];
      next.pop();
      const prevCursor = next.length ? next[next.length - 1] : undefined;
      fetchUsers({ cursor: prevCursor });
      return next;
    });
  };

  const handleCreateCompleted = (payload: { user: AdminUser; temporaryPassword?: string }) => {
    setMessage(
      payload.temporaryPassword
        ? `User created. Temporary password: ${payload.temporaryPassword}`
        : 'User created successfully.'
    );
    fetchUsers();
  };

  const handleEditCompleted = (payload: { user: AdminUser }) => {
    setMessage('User updated.');
    setUsers((list) => list.map((user) => (user.userId === payload.user.userId ? payload.user : user)));
  };

  const handleDelete = async (userId: string) => {
    if (!idToken) return;
    try {
      await apiRequest(`/admin/users/${userId}`, {
        method: 'DELETE',
        token: idToken
      });
      setUsers((list) => list.filter((user) => user.userId !== userId));
      setMessage('User deleted.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to delete user');
    }
  };

  return (
    <section className='space-y-6 rounded-2xl border border-border/40 bg-card/70 p-6 shadow-xl backdrop-blur'>
      <header className='flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between'>
        <div>
          <h1 className='text-2xl font-semibold text-white'>Users</h1>
          <p className='text-sm text-muted-foreground'>Manage admins and students, invite new people, or deactivate accounts.</p>
        </div>
        <UserDialog mode='create' triggerLabel='Invite user' onCompleted={handleCreateCompleted} />
      </header>

      <form className='flex flex-col gap-3 sm:flex-row sm:items-center' onSubmit={handleSearch}>
        <div className='flex-1'>
          <Input
            placeholder='Search by email'
            value={inputValue}
            onChange={(event) => setInputValue(event.target.value)}
          />
        </div>
        <Button type='submit' variant='secondary'>Search</Button>
      </form>

      {message ? <p className='rounded-lg border border-border/60 bg-background/60 px-4 py-3 text-sm text-foreground'>{message}</p> : null}
      {error ? <p className='rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive'>{error}</p> : null}

      <div className='overflow-hidden rounded-xl border border-border/40 bg-background/60'>
        <table className='min-w-full divide-y divide-border/60 text-left text-sm'>
          <thead className='bg-white/5 text-xs uppercase tracking-wider text-muted-foreground'>
            <tr>
              <th className='px-4 py-3 font-semibold'>User</th>
              <th className='px-4 py-3 font-semibold'>Role</th>
              <th className='px-4 py-3 font-semibold'>Status</th>
              <th className='px-4 py-3 font-semibold'>Updated</th>
              <th className='px-4 py-3 text-right font-semibold'>Actions</th>
            </tr>
          </thead>
          <tbody className='divide-y divide-border/40 text-foreground'>
            {loading ? (
              <tr>
                <td colSpan={5} className='px-4 py-10 text-center text-muted-foreground'>
                  <Loader2 className='mx-auto h-5 w-5 animate-spin' />
                </td>
              </tr>
            ) : users.length ? (
              users.map((user) => (
                <tr key={user.userId}>
                  <td className='px-4 py-3'>
                    <div className='flex flex-col'>
                      <span className='font-semibold text-white'>{user.displayName}</span>
                      <span className='text-xs text-muted-foreground'>{user.email}</span>
                    </div>
                  </td>
                  <td className='px-4 py-3 capitalize'>{user.role}</td>
                  <td className='px-4 py-3 text-xs uppercase tracking-wide text-foreground/70'>
                    {user.isActive ? 'Active' : 'Inactive'}
                  </td>
                  <td className='px-4 py-3 text-sm text-muted-foreground'>
                    {new Date(user.updatedAt).toLocaleString()}
                  </td>
                  <td className='px-4 py-3 text-right'>
                    <div className='flex items-center justify-end gap-2'>
                      <UserDialog
                        mode='edit'
                        triggerLabel='Edit'
                        onCompleted={handleEditCompleted}
                        initialUser={user}
                      />
                      <Button
                        type='button'
                        variant='ghost'
                        size='icon'
                        className='text-destructive hover:bg-destructive/10'
                        onClick={() => handleDelete(user.userId)}
                      >
                        <Trash2 className='h-4 w-4' />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={5} className='px-4 py-10 text-center text-muted-foreground'>
                  No users found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className='flex items-center justify-between'>
        <Button
          type='button'
          variant='ghost'
          onClick={handlePrev}
          disabled={loading || cursorStack.length === 0}
        >
          Previous
        </Button>
        <span className='text-xs text-muted-foreground'>Page size: 10</span>
        <Button
          type='button'
          variant='ghost'
          onClick={handleNext}
          disabled={loading || !nextCursor}
        >
          Next
        </Button>
      </div>
    </section>
  );
}
