// 외부 의존성 없는 쓰기 시나리오 공용 — VU별 전용 slot(계정 2 + 섬 3)과 명령 호출 헬퍼.
// slot 은 seed/60_write_fixture.sh 가 만든 PARAMS_DIR/write_fixture.json 의 한 원소다. VU 마다 slot 하나를
// 독점하므로(vu.idInTest-1) 같은 계정에 상태 전이가 겹치지 않는다. 슬롯 수 ≥ MAX_VUS 여야 한다.
import http from 'k6/http';
import crypto from 'k6/crypto';
import { check } from 'k6';
import { vu } from 'k6/execution';
import { BASE_URL } from './config.js';
import { authParams } from './auth.js';
import { sharedJson } from './params.js';

export const slotList = () => sharedJson('write_slots', 'write_fixture.json');

export function mySlot(list) {
  const slot = list[vu.idInTest - 1];
  if (!slot) throw new Error('MAX_VUS 이상 slot fixture 필요 — seed/60_write_fixture.sh --slots N');
  return slot;
}

export const uuid = () => {
  const bytes = new Uint8Array(crypto.randomBytes(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const h = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};

// 공개 응답은 {data: …} 봉투다(없으면 본문 그대로). 필드가 없으면 undefined.
export const field = (res, name) => {
  try {
    const j = res.json();
    return (j && j.data !== undefined && j.data !== null ? j.data : j)[name];
  } catch (_) {
    return undefined;
  }
};

// 명령 1건. idem=true 면 Idempotency-Key(UUID) 를 붙인다(현재 섬 이동·가입·나가기·승인은 필수, 편지·핀은 받지 않음).
// 성공하면 응답, 실패하면 null — 에러율 Rate(errors)에 기록하고 토큰 없이 코드만 경고한다.
export function call(method, path, who, endpoint, errors, { body, idem = false, ok = [200, 201, 204] } = {}) {
  const params = authParams(who, endpoint);
  if (idem) params.headers['Idempotency-Key'] = uuid();
  const res = http.request(method, BASE_URL + path, body === undefined ? null : JSON.stringify(body), params);
  const good = check(res, { '요청 성공': (r) => ok.includes(r.status) });
  errors.add(!good);
  if (!good) {
    let code;
    try { code = res.json('error.code') || res.json('code'); } catch (_) {}
    console.warn(`${endpoint} status=${res.status} code=${code || 'unknown'}`);
    return null;
  }
  return res;
}
