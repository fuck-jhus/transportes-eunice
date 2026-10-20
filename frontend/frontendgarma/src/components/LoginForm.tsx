import { useEffect, useState, type FormEvent } from 'react';
import {
  AlertCircle,
  ArrowRight,
  BusFront,
  Download,
  Eye,
  EyeOff,
  LockKeyhole,
  MapPinned,
  Moon,
  ShieldCheck,
  Smartphone,
  Sun,
  UserRound,
} from 'lucide-react';
import { useAuth } from '../context/useAuth';
import loginBusGuatemala from '../assets/login-bus-guatemala.jpg';

export const LoginForm = () => {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const saved = localStorage.getItem('garma_theme');
    return saved === 'dark' || saved === 'light' ? saved : 'dark';
  });

  const isDark = theme === 'dark';

  useEffect(() => {
    document.body.classList.toggle('dark-theme', isDark);
  }, [isDark]);

  const toggleTheme = () => {
    const nextTheme = isDark ? 'light' : 'dark';
    setTheme(nextTheme);
    localStorage.setItem('garma_theme', nextTheme);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedUsername = username.trim();

    if (!normalizedUsername || !password) {
      setError('Ingresa tu usuario y contraseña para continuar.');
      return;
    }

    try {
      setError(null);
      setIsSubmitting(true);
      await login(normalizedUsername, password);
    } catch (caughtError: unknown) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : 'No pudimos iniciar la sesión. Verifica tus datos e inténtalo de nuevo.',
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="login-shell">
      <section className="login-brand-panel" aria-label="Transportes y Viajes Eunice">
        <img
          className="login-hero-image"
          src={loginBusGuatemala}
          alt="Autobús de pasajeros recorriendo una carretera entre volcanes de Guatemala"
        />
        <div className="login-hero-shade" aria-hidden="true" />

        <header className="login-brand">
          <span className="brand-mark" aria-hidden="true">
            <BusFront size={25} />
          </span>
          <span>
            <strong>Eunice</strong>
            <small>Transportes &amp; Viajes</small>
          </span>
        </header>

        <div className="login-brand-copy">
          <span className="eyebrow">
            <MapPinned size={15} /> Operaciones en Guatemala
          </span>
          <h1>Cada ruta,<br />bajo control.</h1>
          <p>
            Seguimiento de flota y prevención de riesgos para tomar mejores decisiones en el camino.
          </p>
          <div className="login-hero-pills" aria-label="Funciones principales">
            <span><MapPinned size={16} /> Ubicación en vivo</span>
            <span><ShieldCheck size={16} /> Prevención activa</span>
          </div>
        </div>
      </section>

      <section className="login-form-panel">
        <button
          className="theme-switch"
          type="button"
          onClick={toggleTheme}
          aria-label={isDark ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro'}
          title={isDark ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro'}
        >
          {isDark ? <Sun size={18} /> : <Moon size={18} />}
          <span>{isDark ? 'Claro' : 'Oscuro'}</span>
        </button>

        <div className="login-card">
          <div className="login-mobile-brand" aria-label="Transportes y Agencia de Viajes Eunice">
            <strong>Eunice</strong>
            <span>Transportes y Agencia de Viajes</span>
          </div>
          <div className="login-card-icon" aria-hidden="true">
            <BusFront size={24} />
          </div>
          <div className="login-card-heading">
            <span className="eyebrow">Portal de operaciones</span>
            <h2>Ingresa a tu cuenta</h2>
            <p>Accede con las credenciales asignadas por administración.</p>
          </div>

          {error && (
            <div className="form-alert" role="alert">
              <AlertCircle size={19} aria-hidden="true" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="login-form">
            <label htmlFor="username">Usuario</label>
            <div className="input-shell">
              <UserRound size={19} aria-hidden="true" />
              <input
                id="username"
                name="username"
                type="text"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                placeholder="Tu nombre de usuario"
                autoComplete="username"
                maxLength={50}
                disabled={isSubmitting}
                required
                autoFocus
              />
            </div>

            <label htmlFor="password">Contraseña</label>
            <div className="input-shell">
              <LockKeyhole size={19} aria-hidden="true" />
              <input
                id="password"
                name="password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Ingresa tu contraseña"
                autoComplete="current-password"
                maxLength={200}
                disabled={isSubmitting}
                required
              />
              <button
                className="password-toggle"
                type="button"
                onClick={() => setShowPassword((visible) => !visible)}
                aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                title={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>

            <button className="login-submit" type="submit" disabled={isSubmitting}>
              <span>{isSubmitting ? 'Verificando acceso…' : 'Ingresar'}</span>
              {isSubmitting ? <span className="button-spinner" /> : <ArrowRight size={19} />}
            </button>
          </form>

          <div className="login-app-download" aria-label="Aplicación para Android">
            <span className="login-app-download-icon" aria-hidden="true">
              <Smartphone size={21} />
            </span>
            <span className="login-app-download-copy">
              <strong>¿Usas Android?</strong>
              <small>Instala la aplicación móvil oficial.</small>
            </span>
            <a
              className="login-app-download-button"
                href="/downloads/transportes-eunice-android.apk?v=14"
              download="Transportes-Eunice-Android.apk"
              aria-label="Descargar aplicación de Transportes Eunice para Android"
            >
              <Download size={18} aria-hidden="true" />
              <span>Descargar APK</span>
            </a>
          </div>

          <p className="login-help">
            ¿No puedes ingresar? Solicita a un administrador que revise el estado de tu cuenta.
          </p>
        </div>

        <p className="login-legal">Sistema privado de Transportes y Agencia de Viajes Eunice</p>
      </section>
    </main>
  );
};
