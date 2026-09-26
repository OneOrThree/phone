import assert from 'node:assert/strict';
import { constructionPhase, normalizedConstructionProgress } from './constructionProgress';

const sample = {
  buildingId: 'library' as const,
  status: 'BUILDING',
  startedAt: '2026-09-21T00:00:00Z',
  completesAt: '2026-09-21T01:00:00Z',
  serverNow: '2026-09-21T00:10:00Z',
  version: 3,
};
const epoch = Date.parse(sample.startedAt);

test('서버 시각 offset을 사용하고 앱의 시각 점프에도 서버 시각 흐름에 맞춰 진행한다', () => {
  assert.equal(normalizedConstructionProgress(sample, epoch + 600_000, epoch + 600_000), 1 / 6);
  assert.equal(
    normalizedConstructionProgress(sample, epoch + 660_000, epoch + 600_000),
    1 / 6 + 60_000 / 3_600_000,
  );
});

test('0–15%, 15–75%, 75–100%, 완료 예정 이후의 단계를 나눈다', () => {
  assert.equal(constructionPhase(0), 'foundation');
  assert.equal(constructionPhase(0.1499), 'foundation');
  assert.equal(constructionPhase(0.15), 'building');
  assert.equal(constructionPhase(0.75), 'finishing');
  assert.equal(constructionPhase(1), 'awaiting-confirmation');
  assert.equal(constructionPhase(0, false), 'pre');
});

test('잘못된 구간은 0으로, 정상 구간의 양끝은 0~1로 제한한다', () => {
  assert.equal(
    normalizedConstructionProgress({ ...sample, completesAt: sample.startedAt }, epoch, epoch),
    0,
  );
  assert.equal(normalizedConstructionProgress(sample, epoch, epoch + 600_000), 0);
  assert.equal(normalizedConstructionProgress(sample, epoch + 10_000_000, epoch + 600_000), 1);
});
