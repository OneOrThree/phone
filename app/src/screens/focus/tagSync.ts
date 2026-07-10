// 과목명 → 서버 FocusTag 매칭/생성 (세션 업로드용) + 과목 편집의 서버 반영(GROMO-677).
// 로컬 과목(SubjectContext)은 서버 tag와 별개라, 업로드 직전에 이름으로 서버 태그를 찾고
// 없으면 만들어 tagId를 얻는다 → by-category(과목별 통계)가 '미분류'가 아닌 실제 과목으로 집계된다.
// 모듈 캐시(이름→tagId)로 세션마다 목록 재조회를 피한다. 실패 시 null(태그 없이 업로드 — 기존 동작).
// ⚠️ 캐시는 계정 단위 — 재시작 없이 계정을 전환하면 이전 유저의 tagId가 남아 서버가 거부하므로,
//    userId가 바뀌면 캐시를 비운다(리뷰 반영).
import { getFocusTags, setupFocusTag, updateFocusTag, deleteFocusTag } from '@/services/focusApi';

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

// ── 과목 편집 → 서버 태그 반영 (GROMO-677) ─────────────────────────────────
// SubjectContext의 생성/이름변경/삭제를 서버에 동기화한다. 전부 fire-and-forget —
// 실패해도 던지지 않는다(오프라인 등). 못 맞춘 생성분은 업로드 시 ensureFocusTagId가 자가치유.
// tagId는 호출 시점에 목록을 재조회해 현재 계정 토큰 기준으로 해석한다(이전 계정 캐시 오염 방지).

async function resolveTagIdByName(name: string): Promise<string | null> {
  await refreshCache();
  return cache?.get(name) ?? null;
}

// 과목 생성 → POST /tag. 서버가 이름으로 find-or-create 하므로 멱등.
export async function syncTagCreated(name: string): Promise<void> {
  try {
    await setupFocusTag({ name });
    await refreshCache();
  } catch {}
}

// 과목 이름변경 → PATCH /tag(서버는 옛 채택 소프트삭제 + 새 이름 재채택).
// 서버에 옛 이름이 아직 없으면(생성 동기화 실패 등) 새 이름으로 등록만 한다.
export async function syncTagRenamed(oldName: string, newName: string): Promise<void> {
  try {
    const tagId = await resolveTagIdByName(oldName);
    if (tagId) await updateFocusTag({ tagId, name: newName });
    else await setupFocusTag({ name: newName });
    await refreshCache();
  } catch {}
}

// 과목 삭제 → DELETE /tag/{tagId} (서버는 소프트 삭제 — 과거 세션 기록은 보존).
// 서버에 없는 과목이면 할 일 없음.
export async function syncTagDeleted(name: string): Promise<void> {
  try {
    const tagId = await resolveTagIdByName(name);
    if (tagId) {
      await deleteFocusTag(tagId);
      await refreshCache();
    }
  } catch {}
}
