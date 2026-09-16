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

async function ensureFocusTagIdOperation(
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

// 조회/생성 경로도 인증 전환의 drain 대상이다. 편집 큐와 같은 gate·세대를 사용해 전환 전에
// 시작한 작업은 끝까지 이전 토큰으로 마치고, 전환 준비 뒤 시작한 작업은 commit 시 폐기하거나
// rollback 시 이전 세션에서 재개한다.
export function ensureFocusTagId(name: string, userId: string | null): Promise<string | null> {
  const gen = editGeneration;
  const pauseGate = editPauseGate;
  const operation = (async () => {
    if (pauseGate) await pauseGate;
    if (gen !== editGeneration) return null;
    return ensureFocusTagIdOperation(name, userId);
  })();
  activeEnsures.add(operation);
  operation.finally(() => activeEnsures.delete(operation)).catch(() => {});
  return operation;
}

// ── 과목 편집 → 서버 태그 반영 (GROMO-677) ─────────────────────────────────
// SubjectContext의 생성/이름변경/삭제를 서버에 동기화한다. 전부 fire-and-forget —
// 실패해도 던지지 않는다(오프라인 등). 못 맞춘 생성분은 업로드 시 ensureFocusTagId가 자가치유.
// tagId는 호출 시점에 목록을 재조회해 현재 계정 토큰 기준으로 해석한다(이전 계정 캐시 오염 방지).
// 편집끼리는 순차 큐로 직렬화 — 생성 POST가 끝나기 전에 이름변경/삭제가 먼저 서버에 도착하는
// 순서 역전(유령 태그 잔존 → 복원 시 부활)을 막는다(리뷰 반영). 실패해도 체인은 이어진다.

let editChain: Promise<void> = Promise.resolve();
let editGeneration = 0;
let editPauseGate: Promise<void> | null = null;
const activeEnsures = new Set<Promise<string | null>>();
function enqueueEdit(task: () => Promise<void>): void {
  // 등록 시점의 pause gate와 세대를 캡처한다. 계정 전환 준비 뒤 들어온 편집은 전환 결과가
  // 결정될 때까지 기다렸다가, rollback이면 이전 계정에서 계속하고 commit이면 건너뛴다.
  const gen = editGeneration;
  const pauseGate = editPauseGate;
  const run = async () => {
    if (pauseGate) await pauseGate;
    if (gen === editGeneration) await task();
  };
  editChain = editChain.then(run, run);
}

export interface TagEditTransition {
  commit: () => void;
  rollback: () => void;
}

// 새 토큰을 저장하기 전에 이미 실행 중이거나 대기 중인 이전 계정 편집을 모두 끝낸다.
// 준비 이후 들어온 편집은 gate 뒤에 세워 저장 성공 시 폐기하고, 실패 시 이전 세션에서 재개한다.
export async function beginTagEditTransition(): Promise<TagEditTransition> {
  const tailBeforePause = editChain;
  let releasePause!: () => void;
  editPauseGate = new Promise<void>((resolve) => {
    releasePause = resolve;
  });
  // gate 설정 전 시작한 ensure 작업의 현재 snapshot도 함께 drain한다. gate 설정 뒤 들어오는
  // ensure는 위에서 pauseGate를 기다리므로 이 snapshot에서 빠져도 새 토큰으로 실행되지 않는다.
  await Promise.allSettled([tailBeforePause, ...activeEnsures]);

  let settled = false;
  const settle = (committed: boolean) => {
    if (settled) return;
    settled = true;
    if (committed) editGeneration++;
    editPauseGate = null;
    releasePause();
  };
  return {
    commit: () => settle(true),
    rollback: () => settle(false),
  };
}

// 로그아웃/계정 전환 시 대기 중인 편집 동기화를 폐기한다(리뷰 반영) — 큐에 남은 이전 계정의
// 생성/이름변경/삭제가 새 계정 토큰으로 실행되며 새 계정 태그를 오염시키는 누출 방지.
// 동기 호출이 필요한 비인증 초기화용이다. 인증 전환은 beginTagEditTransition으로 실행 중 작업까지
// drain한 뒤 커밋/롤백한다.
export function abortTagEdits(): void {
  editGeneration++;
}

async function resolveTagIdByName(name: string): Promise<string | null> {
  await refreshCache();
  return cache?.get(name) ?? null;
}

// 과목 생성 → POST /tag. 서버가 이름으로 find-or-create 하므로 멱등.
export function syncTagCreated(name: string): void {
  enqueueEdit(async () => {
    try {
      await setupFocusTag({ name });
      await refreshCache();
    } catch {}
  });
}

// 과목 이름변경 → PATCH /tag(서버는 옛 채택 소프트삭제 + 새 이름 재채택).
// 서버에 옛 이름이 아직 없으면(생성 동기화 실패 등) 새 이름으로 등록만 한다.
export function syncTagRenamed(oldName: string, newName: string): void {
  enqueueEdit(async () => {
    try {
      const tagId = await resolveTagIdByName(oldName);
      if (tagId) await updateFocusTag({ tagId, name: newName });
      else await setupFocusTag({ name: newName });
      await refreshCache();
    } catch {}
  });
}

// 과목 삭제 → DELETE /tag/{tagId} (서버는 소프트 삭제 — 과거 세션 기록은 보존).
// 서버에 없는 과목이면 할 일 없음.
export function syncTagDeleted(name: string): void {
  enqueueEdit(async () => {
    try {
      const tagId = await resolveTagIdByName(name);
      if (tagId) {
        await deleteFocusTag(tagId);
        await refreshCache();
      }
    } catch {}
  });
}
