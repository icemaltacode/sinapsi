import { BrowserRouter, Navigate, Outlet, Route, Routes } from 'react-router-dom';

import { AuthProvider, useAuth } from './context/auth-context';
import { ThemeProvider } from './components/theme-provider';
import { LoginView } from './routes/login-view';
import { NewPasswordView } from './routes/new-password-view';
import { AdminLayout } from './layouts/admin-layout';
import { AdminUsersPage } from './routes/admin/users-page';
import { AdminProvidersPage } from './routes/admin/providers-page';
import { AccountPage } from './routes/account-page';
import { AppHeader } from './components/layout/header';
import { HomeLayout } from './layouts/home-layout';
import { HomePage } from './routes/home-page';

function RootRoute() {
  const { stage } = useAuth();

  if (stage === 'loading') {
    return (
      <main className='app'>
        <section className='panel w-full max-w-md text-center text-sm text-muted-foreground'>
          Checking session…
        </section>
      </main>
    );
  }

  if (stage === 'signedOut') {
    return <LoginView />;
  }

  if (stage === 'newPassword') {
    return <NewPasswordView />;
  }

  return (
    <HomeLayout>
      <HomePage />
    </HomeLayout>
  );
}

function AdminRoute() {
  const { stage, isAdmin } = useAuth();

  if (stage === 'loading') {
    return null;
  }

  if (stage !== 'signedIn' || !isAdmin) {
    return <Navigate to='/' replace />;
  }

  return (
    <AdminLayout>
      <Outlet />
    </AdminLayout>
  );
}

function AccountRoute() {
  const { stage, user, signOut, isAdmin } = useAuth();

  if (stage === 'loading') {
    return null;
  }

  if (stage !== 'signedIn') {
    return <Navigate to='/' replace />;
  }

  return (
    <div className='min-h-screen bg-[radial-gradient(circle_at_top_left,_#232E60,_#0b1120_55%,_#06070d)] text-foreground'>
      <AppHeader
        userName={user?.displayName ?? user?.email ?? 'Sinapsi User'}
        avatarUrl={user?.avatarUrl}
        onLogout={signOut}
        showAdmin={isAdmin}
        adminHref='/admin'
        isAdminRoute={false}
        navLinks={[{ label: 'Home', to: '/' }, ...(isAdmin ? [{ label: 'Admin', to: '/admin' }] : [])]}
      />

      <main className='flex w-full justify-center px-3 py-10 md:px-6'>
        <section className='w-full max-w-4xl rounded-2xl border border-border/40 bg-card/70 p-6 shadow-xl backdrop-blur'>
          <AccountPage />
        </section>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path='/' element={<RootRoute />} />
            <Route path='/admin' element={<AdminRoute />}>
              <Route index element={<AdminUsersPage />} />
              <Route path='providers' element={<AdminProvidersPage />} />
            </Route>
            <Route path='/account' element={<AccountRoute />} />
            <Route path='*' element={<Navigate to='/' replace />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </ThemeProvider>
  );
}
