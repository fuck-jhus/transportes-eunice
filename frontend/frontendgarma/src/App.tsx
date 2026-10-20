import { lazy, Suspense } from 'react';
import { BusFront } from 'lucide-react';
import { LoginForm } from './components/LoginForm';
import { ProtectedRoute } from './components/ProtectedRoute';
import { AuthProvider } from './context/AuthContext';
import { useAuth } from './context/useAuth';
import { PublicTripPage } from './components/PublicTripPage';
import { PublicInfoPage } from './components/PublicInfoPage';

const TelemetryDashboard = lazy(() =>
  import('./components/TelemetryDashboard').then((module) => ({ default: module.TelemetryDashboard }))
);

const SessionLoader = () => (
  <main className="session-loader" aria-live="polite" aria-busy="true">
    <div className="session-loader-mark">
      <BusFront size={27} />
    </div>
    <div className="session-loader-spinner" />
    <p>Preparando el centro de operaciones…</p>
  </main>
);

const MainAppContent = () => {
  const { isAuthenticated, loading } = useAuth();

  if (loading) return <SessionLoader />;

  if (!isAuthenticated) return <LoginForm />;

  return (
    <ProtectedRoute allowedRoles={['Piloto', 'Administrador', 'Supervisor']}>
      <Suspense fallback={<SessionLoader />}>
        <TelemetryDashboard />
      </Suspense>
    </ProtectedRoute>
  );
};

const App = () => {
  const normalizedPath = window.location.pathname.replace(/\/+$/, '') || '/';
  if (normalizedPath === '/privacidad') return <PublicInfoPage page="privacy" language="es" />;
  if (normalizedPath === '/privacy') return <PublicInfoPage page="privacy" language="en" />;
  if (normalizedPath === '/soporte') return <PublicInfoPage page="support" language="es" />;
  if (normalizedPath === '/support') return <PublicInfoPage page="support" language="en" />;

  const publicTripMatch = window.location.pathname.match(/^\/viaje\/([A-Za-z0-9_-]{24,96})\/?$/);
  if (publicTripMatch) return <PublicTripPage token={publicTripMatch[1]} />;

  return (
    <AuthProvider>
      <MainAppContent />
    </AuthProvider>
  );
};

export default App;
