import { ApiError, CLIENT_STALE_SESSION, request, uuid } from './api/client';
import { currentFocusSession } from './api/focusSessions';
import type { IslandCreated } from './api/islands';
import { sessionGeneration } from './api/session';
import { isPublicWebDemo } from './demoMode';

/** 서버 배포를 마친 공개 웹 빌드에서만 켠다. 네이티브는 기존 입장 정책을 쓴다. */
export const usesSharedWebIsland = () =>
  isPublicWebDemo() && process.env.EXPO_PUBLIC_WEB_SHARED_ISLAND === '1';

let intent: { generation: number; key: string; pending?: Promise<IslandCreated> } | undefined;
let assigned: { generation: number; id: string } | undefined;
export const sharedWebIslandId = () =>
  assigned?.generation === sessionGeneration() ? assigned.id : undefined;

/** 실패 재시도는 같은 키, 완료 후 새 입장은 새 키. 동시 입장 요청은 하나로 합친다. */
export function enterSharedWebIsland(): Promise<IslandCreated> {
  const generation = sessionGeneration();
  if (!intent || intent.generation !== generation) intent = { generation, key: uuid() };
  const attempt = intent;
  if (attempt.pending) return attempt.pending;
  attempt.pending = request<IslandCreated>('/me/web-island', {
    method: 'POST',
    idempotencyKey: attempt.key,
  })
    .then((result) => {
      if (sessionGeneration() !== generation)
        throw new ApiError(CLIENT_STALE_SESSION, '로그인 정보가 바뀌었어요.', 0);
      assigned = { generation, id: result.id };
      if (intent === attempt) intent = undefined;
      return result;
    })
    .finally(() => {
      attempt.pending = undefined;
    });
  return attempt.pending;
}

/** 기존 집중은 강제 종료하지 않는다. 실제 진행 세션이 있을 때만 배정을 미룬다. */
export async function enterWebIslandAtBoot(): Promise<void> {
  try {
    await enterSharedWebIsland();
  } catch (error) {
    if (
      error instanceof ApiError &&
      error.code === 'STATE_CONFLICT' &&
      (await currentFocusSession())
    )
      return;
    throw error;
  }
}
