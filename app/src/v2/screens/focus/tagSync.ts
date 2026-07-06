// 과목명 → 서버 FocusTag 매칭/생성 (세션 업로드용).
// 로컬 과목(SubjectContext)은 서버 tag와 별개라, 업로드 직전에 이름으로 서버 태그를 찾고
// 없으면 만들어 tagId를 얻는다 → by-category(과목별 통계)가 '미분류'가 아닌 실제 과목으로 집계된다.
// 모듈 캐시(이름→tagId)로 세션마다 목록 재조회를 피한다. 실패 시 null(태그 없이 업로드 — 기존 동작).
// ⚠️ 캐시는 계정 단위 — 재시작 없이 계정을 전환하면 이전 유저의 tagId가 남아 서버가 거부하므로,
//    userId가 바뀌면 캐시를 비운다(리뷰 반영).
import { getFocusTags, setupFocusTag } from '@/services/focusApi';

let cache: Map<string, string> | null = null;
let cacheUserId: string | null = null;

async function refreshCache(): Promise<void> {
  const tags = await getFocusTags();
  cache = new Map(tags.map((t) => [t.name, t.tagId]));
}

export async function ensureFocusTagId(
  name: string,
  userId: string | null,
): Promise<string | null> {
  try {
    // 계정이 바뀌면 이전 계정의 태그 캐시를 폐기
    if (cacheUserId !== userId) {
      cache = null;
      cacheUserId = userId;
    }
    if (!cache) await refreshCache();
    const hit = cache?.get(name);
    if (hit) return hit;
    // 서버에 없는 과목 — 생성 후 재조회로 id 확보(생성 응답에 id가 없음).
    // 중복 생성(409 등)이어도 재조회에서 잡히므로 생성 실패는 무시.
    await setupFocusTag({ name }).catch(() => {});
    await refreshCache();
    return cache?.get(name) ?? null;
  } catch {
    return null;
  }
}
