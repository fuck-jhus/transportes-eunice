const fs = require('node:fs');
const path = require('node:path');

// Firebase's public Android app configuration is distinct from the private FCM service
// account uploaded to EAS. Never substitute another app's Firebase configuration.
module.exports = ({ config }) => {
  const candidate = process.env.GOOGLE_SERVICES_JSON || path.join(__dirname, 'google-services.json');
  const file = path.resolve(candidate);
  if (process.env.GOOGLE_SERVICES_JSON && !fs.existsSync(file)) {
    throw new Error('GOOGLE_SERVICES_JSON no apunta a un archivo disponible.');
  }
  if (!fs.existsSync(file)) return config;
  const firebase = JSON.parse(fs.readFileSync(file, 'utf8'));
  const client = firebase.client?.find(item => item.client_info?.android_client_info?.package_name === config.android?.package);
  if (!client || !firebase.project_info?.project_id) {
    throw new Error('El archivo Firebase no contiene la aplicación Android de Eunice.');
  }
  if (config.extra?.firebaseProjectId && firebase.project_info.project_id !== config.extra.firebaseProjectId) {
    throw new Error('El archivo Firebase pertenece a otro proyecto; se requiere el proyecto de Eunice.');
  }
  const projectNumber = firebase.project_info.project_number;
  if (!/^\d+$/.test(projectNumber ?? '')
    || !client.client_info.mobilesdk_app_id?.startsWith(`1:${projectNumber}:android:`)
    || !client.api_key?.some(key => typeof key.current_key === 'string' && key.current_key.trim())) {
    throw new Error('La configuración Firebase Android está incompleta: faltan los identificadores o la clave pública del cliente.');
  }
  return { ...config, android: { ...config.android, googleServicesFile: file } };
};
