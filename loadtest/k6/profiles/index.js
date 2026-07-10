// 프로파일 선택기 — k6 는 동적 import 가 안 되므로 전부 정적 import 후 __ENV.PROFILE 로 선택.
import * as warmup from './warmup.js';
import * as smoke from './smoke.js';
import * as load from './load.js';
import * as stress from './stress.js';
import * as spike from './spike.js';
import * as soak from './soak.js';

const PROFILES = { warmup, smoke, load, stress, spike, soak };

export function resolveProfile() {
  const name = __ENV.PROFILE || 'smoke';
  const p = PROFILES[name];
  if (!p) throw new Error(`알 수 없는 PROFILE: ${name} (${Object.keys(PROFILES).join('|')})`);
  return p;
}
