import { Menu } from 'lucide-react';
import { Link } from 'react-router-dom';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '../ui/dropdown-menu';
import { Sheet, SheetClose, SheetContent, SheetTrigger } from '../ui/sheet';
import { Button } from '../ui/button';
import { ThemeToggle } from '../theme-toggle';
import { cn } from '../../lib/utils';

interface HeaderProps {
  userName?: string;
  onLogout: () => void;
  className?: string;
  showAdmin?: boolean;
  adminHref?: string;
  isAdminRoute?: boolean;
  navLinks?: Array<{ label: string; to: string }>;
  avatarUrl?: string;
}

const gradientBg =
  'bg-gradient-to-r from-[#232E60] via-[#232E60]/80 to-[#EC5763]/70';

export function AppHeader({
  userName = 'Sinapsi User',
  onLogout,
  className,
  showAdmin,
  adminHref = '/admin',
  isAdminRoute,
  navLinks = [],
  avatarUrl
}: HeaderProps) {
  return (
    <header
      className={cn(
        'sticky top-0 z-40 w-full border-b border-border/40 shadow-sm backdrop-blur',
        gradientBg,
        className
      )}
    >
      <div className='container flex h-16 items-center justify-between gap-4'>
        <div className='flex items-center gap-3'>
          <Sheet>
            <SheetTrigger asChild>
              <Button
                variant='ghost'
                size='icon'
                className='text-primary-foreground md:hidden'
              >
                <Menu className='h-5 w-5' />
                <span className='sr-only'>Open navigation</span>
              </Button>
            </SheetTrigger>
            <SheetContent className='bg-gradient-to-b from-[#232E60] via-[#161f3f] to-[#080b18] text-slate-100'>
              <div className='mt-8 space-y-4'>
                <p className='text-sm uppercase tracking-widest text-slate-300'>Navigation</p>
                <nav className='flex flex-col gap-2 text-lg font-medium'>
                  {navLinks.map((link) => (
                    <SheetClose asChild key={link.to}>
                      <Link
                        className='rounded-md px-2 py-1 transition hover:bg-white/10'
                        to={link.to}
                      >
                        {link.label}
                      </Link>
                    </SheetClose>
                  ))}
                </nav>
              </div>
            </SheetContent>
          </Sheet>

          <Link to='/' className='flex items-center gap-2 text-primary-foreground'>
            <div className='flex h-9 w-9 items-center justify-center rounded-lg bg-white/15 font-semibold tracking-wide text-white shadow-inner shadow-black/40'>
              S
            </div>
            <span className='text-lg font-semibold tracking-tight'>Sinapsi</span>
          </Link>
        </div>

        <div className='flex items-center gap-2 md:gap-4'>
          {showAdmin ? (
            <Button
              asChild
              variant='ghost'
              className={cn(
                'hidden rounded-full border border-white/25 bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-white/90 transition hover:bg-white/20 md:inline-flex',
                isAdminRoute && 'bg-white/25 text-white'
              )}
            >
              <Link to={adminHref}>Admin</Link>
            </Button>
          ) : null}

          <ThemeToggle />

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant='ghost'
                className='flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-sm font-medium text-white/90 backdrop-blur hover:bg-white/20'
              >
                <span className='hidden text-right sm:block'>{userName}</span>
                <div className='flex h-9 w-9 items-center justify-center overflow-hidden rounded-full bg-white/20 text-base font-semibold uppercase'>
                  {avatarUrl ? (
                    <img src={avatarUrl} alt='Avatar' className='h-full w-full object-cover' />
                  ) : (
                    <span>{userName?.slice(0, 2) ?? 'SU'}</span>
                  )}
                </div>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className='w-56' align='end' forceMount>
              <DropdownMenuLabel className='font-semibold'>Signed in as</DropdownMenuLabel>
              <p className='px-2 text-sm text-muted-foreground'>{userName}</p>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild className='cursor-pointer'>
                <Link to='/account'>Account</Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className='cursor-pointer text-destructive focus:bg-destructive/10 focus:text-destructive'
                onSelect={onLogout}
              >
                Logout
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}
