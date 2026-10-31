import test from 'node:test';
import assert from 'node:assert/strict';
import { Upstream } from '../server/upstream.mjs';
import contract from '../server/contract.json' with { type: 'json' };

const operator = { dataToken: 'data-token', notificationToken: 'noti-token' };
function upstream(transform = (_, identity) => identity) {
  return new Upstream({ mode: 'connected', environment: 'prod', expectedFcmProjectId: 'catus-prod',
    dataUrl: 'https://data.internal', notificationUrl: 'https://notification.internal',
    fetchImpl: async (url) => {
      const service = url.hostname.split('.')[0];
      const identity = { environment: 'prod', fcmProjectId: 'catus-prod',
        contractVersion: '1', capabilities: [...contract[service]] };
      return Response.json(transform(service, identity));
    },
  });
}

test('서비스별 필수 계약을 지원하면 추가 capability와 필드를 허용한다', async () => {
  await upstream((_, value) => ({ ...value, futureField: true,
    capabilities: [...value.capabilities, 'future.v2'] })).verifyEnvironment('prod', 'member-1', operator);
});
for (const service of ['data', 'notification']) {
  for (const change of [value => ({ ...value, contractVersion: '2' }),
    value => ({ ...value, capabilities: value.capabilities.slice(1) }),
    value => ({ ...value, capabilities: null })]) {
    test(`${service}의 필수 계약 누락·비호환 응답은 연결을 차단한다 ${change.toString()}`, async () => {
      await assert.rejects(upstream((name, value) => name === service ? change(value) : value)
        .verifyEnvironment('prod', 'member-1', operator), error => error.definite === true);
    });
  }
}
test('API 계약이 맞아도 DB 환경 또는 FCM 프로젝트가 다르면 거부한다', async () => {
  for (const mismatch of [{ environment: 'dev' }, { fcmProjectId: 'catus-dev' }]) {
    await assert.rejects(upstream((_, value) => ({ ...value, ...mismatch }))
      .verifyEnvironment('prod', 'member-1', operator));
  }
});
test('Data에 content.app-requirements.v1 이 없으면 연결을 거부한다', async () => {
  await assert.rejects(upstream((name, value) => name === 'data' ? { ...value,
    capabilities: value.capabilities.filter(item => item !== 'content.app-requirements.v1') } : value)
    .verifyEnvironment('prod', 'member-1', operator), error => error.definite === true);
  assert.ok(contract.data.includes('content.app-requirements.v1'));
});
