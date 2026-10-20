const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loader } = require('./helpers/navigation.cjs');
const { reactHarness, find, text, settle } = require('./helpers/reactHarness.cjs');
const esm = value => ({ __esModule: true, default: value });
const native = { ActivityIndicator: 'ActivityIndicator', Text: 'Text', View: 'View', Pressable: 'Pressable', StyleSheet: { create: value => value } };
const ui = Object.fromEntries(['AppTextField', 'ChoiceChip', 'EmptyState', 'PrimaryButton', 'ScreenHeader', 'ScreenScroll', 'SurfaceCard'].map(name => [name, name]));
ui.uiStyles = () => ({});
const colors = new Proxy({}, { get: () => '#123456' });
function componentHarness(api) {
  const harness = reactHarness();
  const load = loader({ react: harness.React, 'react-native': native, '@expo/vector-icons': { Feather: 'Icon', MaterialCommunityIcons: 'Icon' },
    '../api/client': esm(api), '../context/ToastContext': { useToast: () => ({ showToast() {} }) },
    '../theme/AppTheme': { useAppTheme: () => ({ colors }) }, '../components/MobileUI': ui, './MobileUI': ui });
  return { harness, load };
}

test('editing an inactive account preserves its status and concurrency version', async () => {
  let saved;
  const account = { idUsuario: 2, nombreCompleto: 'Fixture', usuarioLogin: 'fixture', tipoRol: 'Piloto', estado: 'Inactivo', version: 'AQ==' };
  const { harness, load } = componentHarness({ get: async () => ({ data: [account] }), put: async (_url, payload) => { saved = payload; } });
  const { UsersScreen } = load('src/screens/UsersScreen.tsx'); const render = () => harness.render(UsersScreen);
  render(); await settle(); let tree = render(); find(tree, n => n.type === 'Pressable' && n.props.onPress).props.onPress();
  tree = render(); find(tree, n => n.props?.label === 'Nombre completo').props.onChangeText('Nombre editado');
  tree = render(); find(tree, n => n.props?.label === 'Guardar cuenta').props.onPress(); await settle();
  assert.equal(saved.estado, 'Inactivo'); assert.equal(saved.version, 'AQ=='); harness.dispose();
});

test('alert summary uses the period aggregate, not the truncated recent list', async () => {
  const requests = [];
  const { harness, load } = componentHarness({ get: async (url, options) => { requests.push({ url, options }); return { data: url === '/alertas'
    ? Array.from({ length: 50 }, (_, i) => ({ idAlerta: i + 1, tipoAlerta: 'Frenado Brusco', fechaHora: new Date().toISOString(), valorRegistrado: -4, nombrePiloto: 'Fixture', placaAutobus: 'FIX' }))
    : url === '/alertas/estadisticas' ? { totalAlertas: 100, alertasPorTipo: { 'Exceso de Velocidad': 30, 'Frenado Brusco': 70 } } : [] }; } });
  const { AlertsScreen } = load('src/screens/AlertsScreen.tsx'); harness.render(AlertsScreen); await settle(); const tree = harness.render(AlertsScreen);
  assert.equal(find(tree, n => n.props?.label === 'Total').props.value, 100);
  assert.equal(find(tree, n => n.props?.label === 'Velocidad').props.value, 30);
  assert.equal(find(tree, n => n.props?.label === 'Frenados').props.value, 70);
  assert.ok(requests.every(x => x.options.params.anio && x.options.params.mes)); harness.dispose();
});

test('an initial network error is not presented as an empty confirmed fleet', async () => {
  const { harness, load } = componentHarness({ get: async () => { throw new Error('offline'); } });
  const { BusesScreen } = load('src/screens/BusesScreen.tsx'); harness.render(BusesScreen, {}); await settle(); const tree = harness.render(BusesScreen, {});
  assert.equal(find(tree, n => n.type === 'EmptyState'), null);
  assert.equal(find(tree, n => n.props?.onRetry).props.error, true); harness.dispose();
});

test('trip push opens its authorized detail and a late earlier push cannot replace it', async () => {
  const pending = new Map(); let handled = 0;
  const { harness, load } = componentHarness({ get: url => url === '/viajes' ? Promise.resolve({ data: [] })
    : new Promise(resolve => pending.set(url, resolve)) });
  const { TripsScreen } = load('src/screens/TripsScreen.tsx');
  const user = { idUsuario: 1, tipoRol: 'Piloto' };
  let props = { user, openTarget: { tripId: 77, requestId: 1 }, onPushHandled: () => handled++ };
  harness.render(TripsScreen, props); await settle();
  props = { ...props, openTarget: { tripId: 88, requestId: 2 } }; harness.render(TripsScreen, props);
  const trip = id => ({ idViaje: id, idUsuario: 1, nombreRuta: 'Viaje ' + id, placaAutobus: 'TEST', fechaInicio: new Date().toISOString(), estadoViaje: 'En Curso' });
  pending.get('/viajes/77')({ data: trip(77) }); await settle(); assert.equal(handled, 0);
  pending.get('/viajes/88')({ data: trip(88) }); await settle();
  assert.equal(handled, 1); assert.ok(text(harness.render(TripsScreen, props)).includes('Viaje 88'));
  harness.dispose();
});

test('evaluation push loads its period and is consumed only once', async () => {
  const requests = []; let handled = 0;
  const { harness, load } = componentHarness({ get: async (url, options) => { requests.push(options.params); return { data: url.endsWith('estadisticas') ? {} : [] }; } });
  const { AlertsScreen } = load('src/screens/AlertsScreen.tsx');
  const props = { openTarget: { section: 'ranking', period: '2025-06', requestId: 1 }, onPushHandled: () => handled++ };
  harness.render(AlertsScreen, props); await settle(); harness.render(AlertsScreen, props); await settle();
  assert.equal(requests.at(-1).anio, 2025); assert.equal(requests.at(-1).mes, 6); assert.equal(handled, 1);
  harness.dispose();
});
