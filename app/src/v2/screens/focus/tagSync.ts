// 과목명 → 서버 FocusTag 매칭/생성 (세션 업로드용).
// 로컬 과목(SubjectContext)은 서버 tag와 별개라, 업로드 직전에 이름으로 서버 태그를 찾고
// 없으면 만들어 tagId를 얻는다 → by-category(과목별 통계)가 '미분류'가 아닌 실제 과목으로 집계된다.
// 모듈 캐시(이름→tagId)로 세션마다 목록 재조회를 피한다. 실패 시 null(태그 없이 업로드 — 기존 동작).
import { getFocusTags, setupFocusTag } from '@/services/focusApi';

let cache: Map<string, string> | null = null;

async function refreshCache(): Promise<void> {
  const tags = await getFocusTags();
  cache = new Map(tags.map((t) => [t.name, t.tagId]));
}

export async function ensureFocusTagId(name: string): Promise<string | null> {
  try {
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
