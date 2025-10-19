import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';

import { AuthProvider, useAuth } from './context/auth-context';
import { ThemeProvider } from './components/theme-provider';
import { LoginView } from './routes/login-view';
import { NewPasswordView } from './routes/new-password-view';
import { TokenConsole } from './routes/token-console';
import { AdminLayout } from './layouts/admin-layout';
import { AdminUsersPage } from './routes/admin/users-page';
import { AccountPage } from './routes/account-page';
import { AppHeader } from './components/layout/header';

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

  return <TokenConsole />;
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
      <AdminUsersPage />
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

      <main className='container py-10'>
        <AccountPage />
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
            <Route path='/admin' element={<AdminRoute />} />
            <Route path='/account' element={<AccountRoute />} />
            <Route path='*' element={<Navigate to='/' replace />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </ThemeProvider>
  );
}
