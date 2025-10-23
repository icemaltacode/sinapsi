import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Key, Layers, PanelLeftOpen, Users, X } from 'lucide-react';

import { AppHeader } from '../components/layout/header';
import { cn } from '../lib/utils';
import { useAuth } from '../context/auth-context';

interface AdminLayoutProps {
  children?: ReactNode;
}

const NAV_LINKS = [
  { label: 'Users', to: '/admin', icon: Users },
  { label: 'Providers', to: '/admin/providers', icon: Key },
  { label: 'Models', to: '/admin/models', icon: Layers }
];

export function AdminLayout({ children }: AdminLayoutProps) {
  const { user, signOut } = useAuth();
  const location = useLocation();

  const getInitialPointerState = () => {
    if (typeof window === 'undefined') {
      return { collapsed: false, isPointerCoarse: null as boolean | null };
    }

    const coarse = window.matchMedia('(pointer: coarse)').matches;
    const fine = window.matchMedia('(pointer: fine)').matches;
    const isCoarseOnly = coarse && !fine;

    return {
      collapsed: !isCoarseOnly,
      isPointerCoarse: isCoarseOnly
    };
  };

  const initialState = getInitialPointerState();
  const [collapsed, setCollapsed] = useState(initialState.collapsed);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isPointerCoarse, setIsPointerCoarse] = useState<boolean | null>(initialState.isPointerCoarse);

  useEffect(() => {
    const calculateInputMode = () => {
      const coarse = window.matchMedia('(pointer: coarse)').matches;
      const fine = window.matchMedia('(pointer: fine)').matches;

      setIsPointerCoarse(coarse && !fine);
    };

    calculateInputMode();

    const coarseQuery = window.matchMedia('(pointer: coarse)');
    const fineQuery = window.matchMedia('(pointer: fine)');

    const handleChange = () => calculateInputMode();

    coarseQuery.addEventListener('change', handleChange);
    fineQuery.addEventListener('change', handleChange);

    return () => {
      coarseQuery.removeEventListener('change', handleChange);
      fineQuery.removeEventListener('change', handleChange);
    };
  }, []);

  useEffect(() => {
    if (isPointerCoarse === false) {
      setCollapsed(true);
    } else if (isPointerCoarse === true) {
      setCollapsed(false);
    }
  }, [isPointerCoarse]);

  const navLinks = useMemo(() => NAV_LINKS, []);
  const content = children ?? <Outlet />;

  const renderNavLinks = (
    options: { collapsed: boolean; onNavigate?: () => void; pointerHover?: boolean } = {
      collapsed: false
    }
  ) => (
    <nav className='space-y-2'>
      {navLinks.map(({ label, to, icon: Icon }) => {
        const isActive = location.pathname === to;

        return (
          <Link
            key={to}
            to={to}
            aria-label={label}
            onClick={options.onNavigate}
            className={cn(
              'group flex items-center rounded-lg px-3 py-2 text-sm font-medium transition',
              isActive
                ? 'bg-primary/90 text-primary-foreground shadow'
                : 'text-muted-foreground hover:bg-white/10 hover:text-foreground'
            )}
          >
            <Icon className='h-4 w-4 flex-shrink-0' />
            <span
              className={cn(
                'ml-3 whitespace-nowrap',
                options.pointerHover
                  ? 'hidden group-hover/sidebar:inline-block'
                  : options.collapsed
                    ? 'hidden'
                    : 'inline-block'
              )}
            >
              {label}
            </span>
          </Link>
        );
      })}
    </nav>
  );

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

      <div className='flex w-full flex-col gap-4 px-2 py-8 md:flex-row md:gap-6 md:px-6 lg:px-8'>
        <div className='md:hidden'>
          <button
            type='button'
            onClick={() => setMobileMenuOpen(true)}
            aria-controls='admin-mobile-menu'
            aria-expanded={mobileMenuOpen}
            className='flex items-center gap-2 rounded-lg border border-border/50 bg-card/70 p-3 text-foreground shadow transition hover:bg-card/60'
          >
            <PanelLeftOpen className='h-4 w-4' />
          </button>
        </div>

        <aside
          className={cn(
            'group/sidebar hidden rounded-2xl border border-border/40 bg-card/70 text-sm text-muted-foreground shadow-xl backdrop-blur md:block',
            collapsed ? 'w-20' : 'w-56',
            isPointerCoarse === false
              ? 'md:w-16 md:p-3 md:hover:w-56 md:hover:p-4 md:transition-all md:duration-200'
              : 'md:p-4'
          )}
          >
          {isPointerCoarse === false ? (
            <div className='mb-4 hidden items-center justify-between text-xs font-semibold uppercase tracking-wide text-foreground md:flex'>
              <span>Admin</span>
            </div>
          ) : (
            <button
              type='button'
              onClick={() => setCollapsed((value) => !value)}
              className='mb-6 flex w-full items-center justify-between rounded-lg border border-border/50 bg-background/60 px-3 py-2 text-foreground/80 transition hover:bg-background'
            >
              <span className={cn('text-xs font-semibold uppercase tracking-wide', collapsed && 'hidden')}>Admin</span>
              {collapsed ? <ChevronRight className='h-4 w-4' /> : <ChevronLeft className='h-4 w-4' />}
            </button>
          )}

          {renderNavLinks({
            collapsed: isPointerCoarse === false ? false : collapsed,
            pointerHover: isPointerCoarse === false
          })}
        </aside>

        <main className='flex-1 space-y-6 rounded-2xl border border-border/40 bg-card/70 px-6 py-6 shadow-xl backdrop-blur'>
          {content}
        </main>
      </div>

      {mobileMenuOpen && (
        <div className='fixed inset-0 z-50 flex md:hidden'>
          <button
            type='button'
            aria-label='Close admin menu'
            className='absolute inset-0 bg-black/60 backdrop-blur-sm'
            onClick={() => setMobileMenuOpen(false)}
          />

          <div
            id='admin-mobile-menu'
            className='relative z-10 flex h-full w-64 flex-col rounded-r-2xl border border-border/40 bg-card/80 p-6 text-muted-foreground shadow-xl'
          >
            <div className='mb-6 flex items-center justify-between'>
              <span className='text-xs font-semibold uppercase tracking-wide text-foreground'>Admin</span>
              <button
                type='button'
                onClick={() => setMobileMenuOpen(false)}
                className='rounded-full border border-border/50 p-2 text-foreground transition hover:bg-background/60'
                aria-label='Close admin menu'
              >
                <X className='h-4 w-4' />
              </button>
            </div>

            {renderNavLinks({ collapsed: false, onNavigate: () => setMobileMenuOpen(false) })}
          </div>
        </div>
      )}
    </div>
  );
}
