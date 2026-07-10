// seed 산출물(params) 로더 — "seed 와 부하가 같은 세상을 봐야 한다" (설계 §1-6)
// 파일은 make run 이 GCS(gs://<project>-params/<seed-version>/)에서 부하 VM 에 내려받는다.
// SharedArray: VU 간 메모리 공유 — init context 에서만 생성 가능하므로 스크립트 최상단에서 호출.
import { SharedArray } from 'k6/data';

const DIR = __ENV.PARAMS_DIR || '../params';

export const sharedJson = (name, file) =>
  new SharedArray(name, () => JSON.parse(open(`${DIR}/${file}`)));

// 자주 쓰는 로더 — zipf 파일은 핫유저가 가중치만큼 중복 수록되어 uniform 샘플링 = Zipf 분포
export const usersZipf = () => sharedJson('users_zipf', 'users_zipf.json');
export const usersUniform = () => sharedJson('users_uniform', 'users_uniform.json');
export const groupIds = () => sharedJson('group_ids', 'group_ids.json');
export const searchTerms = () => sharedJson('search_terms', 'search_terms.json');
