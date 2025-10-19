import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Users } from 'lucide-react';

import { AppHeader } from '../components/layout/header';
import { cn } from '../lib/utils';
import { useAuth } from '../context/auth-context';

interface AdminLayoutProps {
  children?: ReactNode;
}

const NAV_LINKS = [{ label: 'Users', to: '/admin' }];

export function AdminLayout({ children }: AdminLayoutProps) {
  const { user, signOut } = useAuth();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);

  const navLinks = useMemo(() => NAV_LINKS, []);
  const content = children ?? <Outlet />;

  return (
    <div className='min-h-screen bg-[radial-gradient(circle_at_top_left,_#232E60,_#0b1120_55%,_#06070d)] text-foreground'>
      <AppHeader
        userName={user?.displayName ?? user?.email ?? 'Sinapsi User'}
        avatarUrl={user?.avatarUrl}
        onLogout={signOut}
        showAdmin
        adminHref='/admin'
        isAdminRoute={location.pathname.startsWith('/admin')}
        navLinks={[{ label: 'Home', to: '/' }, { label: 'Account', to: '/account' }, ...navLinks]}
      />

      <div className='container flex gap-6 py-8'>
        <aside
          className={cn(
            'hidden rounded-2xl border border-border/40 bg-card/70 p-4 text-sm text-muted-foreground shadow-xl backdrop-blur md:block',
            collapsed ? 'w-20' : 'w-64'
          )}
        >
          <button
            type='button'
            onClick={() => setCollapsed((value) => !value)}
            className='mb-6 flex w-full items-center justify-between rounded-lg border border-border/50 bg-background/60 px-3 py-2 text-foreground/80 transition hover:bg-background'
          >
            <span className={cn('text-xs font-semibold uppercase tracking-wide', collapsed && 'hidden')}>Admin</span>
            {collapsed ? <ChevronRight className='h-4 w-4' /> : <ChevronLeft className='h-4 w-4' />}
          </button>

          <nav className='space-y-2'>
            <Link
              to='/admin'
              className={cn(
                'flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition',
                location.pathname === '/admin'
                  ? 'bg-primary/90 text-primary-foreground shadow'
                  : 'text-muted-foreground hover:bg-white/10 hover:text-foreground'
              )}
            >
              <Users className='h-4 w-4' />
              {!collapsed && <span>Users</span>}
            </Link>
          </nav>
        </aside>

        <main className='flex-1 space-y-6'>{content}</main>
      </div>
    </div>
  );
}
