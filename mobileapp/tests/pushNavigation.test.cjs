const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loader } = require('./helpers/navigation.cjs');
const { getPushTarget } = loader()('src/utils/pushNavigation.ts');
const pilot = { idUsuario: 1, tipoRol: 'Piloto' };
const admin = { idUsuario: 2, tipoRol: 'Administrador' };

test('passenger reports and messages open their conversation rather than the general channel', () => {
  const conversationId = '56d99663-7202-4174-9a2f-77d14e6c2c22';
  for (const type of ['content_report', 'passenger_message']) {
    const target = getPushTarget({ type, tab: 'chat', conversationId }, admin, 10);
    assert.equal(target.chat.mode, 'passengers'); assert.equal(target.chat.conversationId, conversationId);
  }
  assert.equal(getPushTarget({ tab: 'chat', channelId: '7' }, pilot).chat.channelId, 7);
});

test('push navigation validates the account, role, trip identity and evaluation period', () => {
  assert.equal(getPushTarget({ tab: 'trips', tripId: 5, recipientId: '2' }, pilot), null);
  for (const tab of ['users', 'alerts', 'buses', 'unknown']) assert.equal(getPushTarget({ tab }, pilot), null);
  assert.equal(getPushTarget({ tab: 'trips', tripId: '55' }, pilot, 20).trip.tripId, 55);
  assert.equal(getPushTarget({ tab: 'trips', tripId: true }, pilot).trip, undefined);
  const target = getPushTarget({ tab: 'alerts', section: 'ranking', period: '2026-09' }, admin);
  assert.equal(target.alerts.section, 'ranking'); assert.equal(target.alerts.period, '2026-09');
  assert.equal(getPushTarget({ tab: 'alerts', period: '2026-13' }, admin).alerts.period, undefined);
});
