import { useEffect } from 'react';
import { ArrowLeft, Bell, BusFront, Mail, MapPin, MessageSquare, Navigation, Phone, ShieldCheck } from 'lucide-react';
import './publicInfoPage.css';

type PublicInfoPageProps = {
  page: 'privacy' | 'support';
  language: 'es' | 'en';
};

const companyEmail = 'agenciaeunice@yahoo.com';
const companyPhone = '+502 5466-9683';

const PrivacySpanish = () => (
  <>
    <section>
      <h2>1. Responsable y alcance</h2>
      <p>Transportes y Agencia de Viajes Eunice opera la aplicación Transportes Eunice IoT para coordinar viajes, unidades, pilotos, seguridad operativa y comunicación de la flota. Esta política explica qué información utiliza la aplicación y con qué finalidad.</p>
    </section>
    <section>
      <h2>2. Información utilizada</h2>
      <ul>
        <li><strong>Cuenta e identidad operativa:</strong> usuario, nombre, rol, estado de acceso y sesión autenticada.</li>
        <li><strong>Ubicación y telemetría:</strong> ubicación precisa, hora, velocidad, dirección y datos de movimiento necesarios para monitorear una unidad durante un viaje activo.</li>
        <li><strong>Operación de transporte:</strong> autobús asignado, placa, rutas, destinos, viajes, horarios, alertas e incidencias.</li>
        <li><strong>Comunicaciones:</strong> mensajes del canal operativo, conversaciones privadas y consultas de pasajeros, incluyendo el alias proporcionado por el pasajero.</li>
        <li><strong>Datos técnicos:</strong> plataforma, identificador de instalación, token de notificaciones y registros técnicos indispensables para seguridad y funcionamiento.</li>
      </ul>
    </section>
    <section>
      <h2>3. Uso de la información</h2>
      <p>La información se usa para autenticar al personal autorizado, mostrar la posición de la flota, registrar recorridos, detectar eventos operativos, coordinar al equipo, responder a pasajeros, enviar notificaciones y proteger el servicio frente a accesos no autorizados.</p>
    </section>
    <section>
      <h2>4. Ubicación en segundo plano</h2>
      <p>Para perfiles de piloto, la aplicación puede utilizar ubicación en segundo plano durante un viaje activo para conservar la continuidad del monitoreo aunque la pantalla esté bloqueada. El piloto puede ver el estado de transmisión y usar los controles de privacidad disponibles. La aplicación no utiliza la ubicación para publicidad.</p>
    </section>
    <section>
      <h2>5. Proveedores y divulgación</h2>
      <p>Se utilizan proveedores técnicos de alojamiento, mapas, rutas y notificaciones exclusivamente para prestar las funciones descritas. No vendemos información personal, no mostramos publicidad y no realizamos seguimiento entre aplicaciones con fines publicitarios.</p>
    </section>
    <section>
      <h2>6. Conservación y seguridad</h2>
      <p>Conservamos la información durante el tiempo necesario para operar el servicio, mantener el historial autorizado, atender obligaciones aplicables y resolver incidentes. Aplicamos autenticación, cifrado en tránsito, controles por rol y medidas de acceso restringido.</p>
    </section>
    <section>
      <h2>7. Solicitudes de privacidad</h2>
      <p>Para solicitar acceso, corrección o eliminación de información asociada a una cuenta, comunícate con administración o escribe a <a href={`mailto:${companyEmail}`}>{companyEmail}</a>. Algunas bitácoras pueden conservarse cuando sean necesarias por seguridad u obligaciones legales.</p>
    </section>
    <section>
      <h2>8. Menores y cambios</h2>
      <p>La aplicación está dirigida a personal autorizado de la operación y no está diseñada para menores. Podemos actualizar esta política cuando cambien las funciones o requisitos aplicables; la fecha vigente aparecerá en esta página.</p>
    </section>
  </>
);

const PrivacyEnglish = () => (
  <>
    <section>
      <h2>1. Controller and scope</h2>
      <p>Transportes y Agencia de Viajes Eunice operates Transportes Eunice IoT to coordinate trips, vehicles, drivers, operational safety, and fleet communications. This policy describes the information used by the app and why it is needed.</p>
    </section>
    <section>
      <h2>2. Information used</h2>
      <ul>
        <li><strong>Account and operational identity:</strong> username, name, role, access status, and authenticated session.</li>
        <li><strong>Location and telemetry:</strong> precise location, time, speed, direction, and motion data required to monitor a vehicle during an active trip.</li>
        <li><strong>Transportation operations:</strong> assigned bus, plate number, routes, destinations, trips, schedules, alerts, and incidents.</li>
        <li><strong>Communications:</strong> operational channel messages, private conversations, and passenger inquiries, including a passenger-provided alias.</li>
        <li><strong>Technical data:</strong> platform, installation identifier, notification token, and technical records required for security and operation.</li>
      </ul>
    </section>
    <section>
      <h2>3. How information is used</h2>
      <p>Information is used to authenticate authorized staff, display fleet positions, record trips, identify operational events, coordinate the team, answer passengers, deliver notifications, and protect the service from unauthorized access.</p>
    </section>
    <section>
      <h2>4. Background location</h2>
      <p>For driver accounts, the app may use background location during an active trip to maintain monitoring when the screen is locked. Drivers can see transmission status and use the available privacy controls. Location is never used for advertising.</p>
    </section>
    <section>
      <h2>5. Providers and disclosure</h2>
      <p>Technical hosting, mapping, routing, and notification providers are used only to deliver the functions described above. We do not sell personal information, display advertising, or track users across apps for advertising purposes.</p>
    </section>
    <section>
      <h2>6. Retention and security</h2>
      <p>Information is retained only as long as needed to operate the service, maintain authorized history, meet applicable obligations, and resolve incidents. We use authentication, encrypted transport, role-based controls, and restricted access.</p>
    </section>
    <section>
      <h2>7. Privacy requests</h2>
      <p>To request access, correction, or deletion of account-related information, contact your administrator or email <a href={`mailto:${companyEmail}`}>{companyEmail}</a>. Some logs may be retained where required for security or legal obligations.</p>
    </section>
    <section>
      <h2>8. Children and changes</h2>
      <p>The app is intended for authorized operational staff and is not designed for children. This policy may be updated as features or applicable requirements change; the effective date will remain available on this page.</p>
    </section>
  </>
);

const SupportSpanish = () => (
  <>
    <section>
      <h2>Acceso a la aplicación</h2>
      <p>Transportes Eunice IoT es una herramienta privada. Las credenciales son creadas por administración. Si tu acceso fue suspendido, olvidaste tus datos o cambiaste de dispositivo, solicita asistencia al responsable de la operación.</p>
    </section>
    <section className="public-info-grid">
      <article><Navigation size={21} /><h3>Ubicación y recorridos</h3><p>Activa la ubicación precisa y permite el uso en segundo plano para mantener el monitoreo durante un viaje activo.</p></article>
      <article><Bell size={21} /><h3>Notificaciones</h3><p>Activa las notificaciones en Ajustes de iPhone para recibir mensajes, asignaciones y avisos operativos.</p></article>
      <article><MessageSquare size={21} /><h3>Chat operativo</h3><p>Los mensajes se sincronizan en tiempo real. Si pierdes conexión, conserva la aplicación abierta y vuelve a intentarlo al recuperar internet.</p></article>
      <article><ShieldCheck size={21} /><h3>Privacidad y cuenta</h3><p>Puedes solicitar corrección o eliminación de información contactando a administración o mediante el correo de soporte.</p></article>
    </section>
    <section>
      <h2>Contacto</h2>
      <p>Describe el problema, el modelo de iPhone y la pantalla donde ocurre. Nunca envíes tu contraseña.</p>
    </section>
  </>
);

const SupportEnglish = () => (
  <>
    <section>
      <h2>App access</h2>
      <p>Transportes Eunice IoT is a private operational tool. Credentials are created by an administrator. If access was suspended, credentials were forgotten, or the device changed, contact the operations administrator.</p>
    </section>
    <section className="public-info-grid">
      <article><Navigation size={21} /><h3>Location and trips</h3><p>Enable precise location and background access to maintain monitoring during an active trip.</p></article>
      <article><Bell size={21} /><h3>Notifications</h3><p>Enable notifications in iPhone Settings to receive messages, assignments, and operational alerts.</p></article>
      <article><MessageSquare size={21} /><h3>Operational chat</h3><p>Messages sync in real time. If the connection is lost, keep the app open and retry when internet access returns.</p></article>
      <article><ShieldCheck size={21} /><h3>Privacy and account</h3><p>Account information correction or deletion can be requested through administration or the support email.</p></article>
    </section>
    <section>
      <h2>Contact</h2>
      <p>Include a description of the issue, the iPhone model, and the affected screen. Never send your password.</p>
    </section>
  </>
);

export const PublicInfoPage = ({ page, language }: PublicInfoPageProps) => {
  const isSpanish = language === 'es';
  const isPrivacy = page === 'privacy';
  const alternatePath = isPrivacy
    ? (isSpanish ? '/privacy' : '/privacidad')
    : (isSpanish ? '/support' : '/soporte');

  useEffect(() => {
    document.documentElement.lang = language;
    document.title = isPrivacy
      ? (isSpanish ? 'Política de Privacidad | Transportes Eunice' : 'Privacy Policy | Transportes Eunice')
      : (isSpanish ? 'Soporte | Transportes Eunice' : 'Support | Transportes Eunice');
  }, [isPrivacy, isSpanish, language]);

  return (
    <main className="public-info-page">
      <header className="public-info-header">
        <a className="public-info-back" href="/"><ArrowLeft size={16} /> {isSpanish ? 'Volver' : 'Back'}</a>
        <a className="public-info-language" href={alternatePath}>{isSpanish ? 'English' : 'Español'}</a>
      </header>

      <article className="public-info-card">
        <div className="public-info-brand"><span><BusFront size={25} /></span><div><strong>Eunice</strong><small>Transportes y Agencia de Viajes</small></div></div>
        <div className="public-info-hero">
          <p>{isPrivacy ? (isSpanish ? 'PRIVACIDAD Y DATOS' : 'PRIVACY AND DATA') : (isSpanish ? 'CENTRO DE AYUDA' : 'HELP CENTER')}</p>
          <h1>{isPrivacy ? (isSpanish ? 'Política de Privacidad' : 'Privacy Policy') : (isSpanish ? 'Soporte de la aplicación' : 'App Support')}</h1>
          <span>{isSpanish ? 'Vigente desde el 30 de septiembre de 2026' : 'Effective September 30, 2026'}</span>
        </div>

        <div className="public-info-content">
          {isPrivacy
            ? (isSpanish ? <PrivacySpanish /> : <PrivacyEnglish />)
            : (isSpanish ? <SupportSpanish /> : <SupportEnglish />)}
        </div>

        <footer className="public-info-contact">
          <div><Mail size={16} /><a href={`mailto:${companyEmail}`}>{companyEmail}</a></div>
          <div><Phone size={16} /><a href="tel:+50254669683">{companyPhone}</a></div>
          <div><MapPin size={16} /><span>Melchor de Mencos, Petén, Guatemala</span></div>
        </footer>
      </article>
    </main>
  );
};
