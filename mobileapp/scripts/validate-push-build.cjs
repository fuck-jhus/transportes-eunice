const fs = require('node:fs');
const path = require('node:path');
const config = require('../app.json').expo;
const platform = process.env.EAS_BUILD_PLATFORM;
if (!config.plugins.some(plugin => (Array.isArray(plugin) ? plugin[0] : plugin) === 'expo-notifications')) {
  throw new Error('La build requiere expo-notifications.');
}
if (platform === 'android') {
  const file = path.resolve(process.env.GOOGLE_SERVICES_JSON || path.join(__dirname, '../google-services.json'));
  if (!fs.existsSync(file)) throw new Error('Falta Firebase de Eunice: configura GOOGLE_SERVICES_JSON (archivo EAS) o google-services.json antes de compilar Android.');
  // Reuse the package check from the config without printing any file contents.
  require('../app.config.js')({ config });
  console.log('Configuración Firebase Android de Eunice validada. FCM v1 debe estar asociado también en EAS Credentials.');
} else {
  console.log('Plugin push presente. Las credenciales APNs se verifican por separado en EAS Credentials.');
}
