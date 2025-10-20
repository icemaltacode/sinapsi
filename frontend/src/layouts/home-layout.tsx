import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { MessageCircle, PanelLeftOpen, X } from 'lucide-react';

import { AppHeader } from '../components/layout/header';
import { cn } from '../lib/utils';
import { useAuth } from '../context/auth-context';

interface HomeLayoutProps {
  children?: ReactNode;
}

const NAV_LINKS = [{ label: 'Chat', to: '/', icon: MessageCircle }];

export function HomeLayout({ children }: HomeLayoutProps) {
  const { user, signOut, isAdmin } = useAuth();
  const location = useLocation();
  const navLinks = useMemo(() => NAV_LINKS, []);

  const getInitialPointerState = () => {
    if (typeof window === 'undefined') {
      return { iconRail: false, isPointerCoarse: null as boolean | null };
    }

    const coarse = window.matchMedia('(pointer: coarse)').matches;
    const fine = window.matchMedia('(pointer: fine)').matches;
    const isCoarseOnly = coarse && !fine;

    return {
      iconRail: !isCoarseOnly
    };
  };

  const initialState = getInitialPointerState();
  const [iconRail, setIconRail] = useState(initialState.iconRail);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const content = children ?? <Outlet />;

  useEffect(() => {
    const calculateInputMode = () => {
      const coarse = window.matchMedia('(pointer: coarse)').matches;
      const fine = window.matchMedia('(pointer: fine)').matches;
      const isCoarseOnly = coarse && !fine;

      setIconRail(!isCoarseOnly);
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

  const renderNavLinks = (
    options: { onNavigate?: () => void; showLabels?: boolean; pointerHover?: boolean } = {}
  ) => (
    <nav className='flex flex-col gap-2'>
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
            {options.pointerHover ? (
              <span className='ml-3 hidden whitespace-nowrap group-hover/sidebar:inline-block'>{label}</span>
            ) : options.showLabels || !iconRail ? (
              <span className='ml-3'>{label}</span>
            ) : null}
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
        showAdmin={isAdmin}
        adminHref='/admin'
        isAdminRoute={false}
        navLinks={[{ label: 'Account', to: '/account' }, ...(isAdmin ? [{ label: 'Admin', to: '/admin' }] : [])]}
      />

      <div className='flex w-full flex-col gap-4 px-2 py-8 md:flex-row md:gap-6 md:px-6 lg:px-8'>
        <div className='md:hidden'>
          <button
            type='button'
            onClick={() => setMobileMenuOpen(true)}
            aria-controls='home-mobile-menu'
            aria-expanded={mobileMenuOpen}
            className='flex items-center gap-2 rounded-lg border border-border/50 bg-card/70 p-3 text-foreground shadow transition hover:bg-card/60'
          >
            <PanelLeftOpen className='h-4 w-4' />
          </button>
        </div>

        <aside
          className={cn(
            'group/sidebar hidden rounded-2xl border border-border/40 bg-card/70 text-sm text-muted-foreground shadow-xl backdrop-blur md:flex md:flex-col',
            iconRail ? 'md:w-16 md:p-3 md:hover:w-56 md:hover:p-4 md:transition-all md:duration-200' : 'md:w-56 md:p-4'
          )}
        >
          {iconRail ? renderNavLinks({ pointerHover: true }) : renderNavLinks({ showLabels: true })}
        </aside>

        <main className='flex-1 space-y-6 rounded-2xl border border-border/40 bg-card/70 px-4 py-6 shadow-xl backdrop-blur md:px-6'>
          {content}
        </main>
      </div>

      {mobileMenuOpen && (
        <div className='fixed inset-0 z-50 flex md:hidden'>
          <button
            type='button'
            aria-label='Close navigation'
            className='absolute inset-0 bg-black/60 backdrop-blur-sm'
            onClick={() => setMobileMenuOpen(false)}
          />

          <div
            id='home-mobile-menu'
            className='relative z-10 flex h-full w-64 flex-col rounded-r-2xl border border-border/40 bg-card/80 p-6 text-muted-foreground shadow-xl'
          >
            <div className='mb-6 flex items-center justify-between'>
              <span className='text-xs font-semibold uppercase tracking-wide text-foreground'>Navigation</span>
              <button
                type='button'
                onClick={() => setMobileMenuOpen(false)}
                className='rounded-full border border-border/50 p-2 text-foreground transition hover:bg-background/60'
                aria-label='Close navigation'
              >
                <X className='h-4 w-4' />
              </button>
            </div>

            {renderNavLinks({ onNavigate: () => setMobileMenuOpen(false), showLabels: true })}
          </div>
        </div>
      )}
    </div>
  );
}
