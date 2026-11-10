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
  MessageCircle,
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
    <main className="auth-page">
      <section className="auth-sheet">
        <header className="auth-brand">
          <span className="auth-brand-mark" aria-hidden="true"><BusFront size={22} /></span>
          <span>
            <strong>Eunice</strong>
            <small>Transportes y Viajes</small>
          </span>
          <button
            className="auth-theme"
            type="button"
            onClick={toggleTheme}
            aria-label={isDark ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro'}
            title={isDark ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro'}
          >
            {isDark ? <Sun size={18} /> : <Moon size={18} />}
          </button>
        </header>

        <div className="auth-body">
          <div className="auth-heading">
            <span className="auth-kicker">Centro de operaciones</span>
            <h1>¡Hola! Sigamos en ruta.</h1>
            <p>Entra con el usuario que te asignó administración.</p>
          </div>

          {error && (
            <div className="auth-alert" role="alert">
              <AlertCircle size={18} aria-hidden="true" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="auth-form">
            <label className="auth-field">
              <span>Usuario</span>
              <span className="auth-input">
                <UserRound size={18} aria-hidden="true" />
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
              </span>
            </label>

            <label className="auth-field">
              <span>Contraseña</span>
              <span className="auth-input">
                <LockKeyhole size={18} aria-hidden="true" />
                <input
                  id="password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Tu contraseña"
                  autoComplete="current-password"
                  maxLength={200}
                  disabled={isSubmitting}
                  required
                />
                <button
                  className="auth-eye"
                  type="button"
                  onClick={() => setShowPassword((visible) => !visible)}
                  aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                  title={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </span>
            </label>

            <button className="auth-submit" type="submit" disabled={isSubmitting}>
              <span>{isSubmitting ? 'Verificando…' : 'Entrar al panel'}</span>
              {isSubmitting ? <span className="button-spinner" /> : <ArrowRight size={19} />}
            </button>
          </form>

          <p className="auth-help">¿No puedes entrar? Pide a un administrador que revise tu cuenta.</p>
        </div>

        <footer className="auth-foot">
          <a
            className="auth-apk"
            href="/downloads/transportes-eunice-android.apk?v=14"
            download="Transportes-Eunice-Android.apk"
            aria-label="Descargar aplicación de Transportes Eunice para Android"
          >
            <span className="auth-apk-icon" aria-hidden="true"><Smartphone size={18} /></span>
            <span><strong>App para pilotos</strong><small>Descargar para Android</small></span>
            <Download size={17} aria-hidden="true" />
          </a>
          <small>Sistema privado de Transportes y Agencia de Viajes Eunice</small>
        </footer>
      </section>

      <section className="auth-scene" aria-label="Transportes y Viajes Eunice">
        <img
          src={loginBusGuatemala}
          alt="Autobús de pasajeros recorriendo una carretera entre volcanes de Guatemala"
        />
        <div className="auth-scene-copy">
          <span className="auth-road" aria-hidden="true" />
          <h2>Cada ruta,<br />bajo control.</h2>
          <ul>
            <li><MapPinned size={16} aria-hidden="true" /> Flota en vivo en el mapa</li>
            <li><ShieldCheck size={16} aria-hidden="true" /> Alertas de velocidad y riesgo</li>
            <li><MessageCircle size={16} aria-hidden="true" /> Chat con pilotos y pasajeros</li>
          </ul>
        </div>
      </section>
    </main>
  );
};
