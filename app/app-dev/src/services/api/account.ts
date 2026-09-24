/**
 * 계정 프로필 도메인 모듈(GROMO-2066). 공개 business-api 의 무접두 경로만 부른다.
 *
 * 계약:
 *  - `PATCH /me`  프로필 수정. `Idempotency-Key` 필수. 부분 수정 — 허용 키는
 *                 name/catColor 뿐이고, 명시 null·미지 필드는 400. 응답은 저장된
 *                 계정 스냅샷 {id,name,catColor,mainIslandId} 이다.
 *  - `DELETE /me` 회원 탈퇴. 확인 문자열과 `Idempotency-Key`를 보내며 서버가
 *                 계정과 세션 삭제를 완료한 뒤 {deleted:true}를 돌려준다.
 */
import { request, uuid } from './client';

/** `PATCH /me` 의 data — `GET /me`(`Account`)의 프로필 부분집합이다. */
export type AccountProfile = {
  id: string;
  name: string | null;
  catColor: string | null;
  /** 프로필 메인 섬(GROMO-1971) — 무소속이면 null. */
  mainIslandId: string | null;
};

/** 부분 수정 입력 — 명시 null 은 계약 위반이라 undefined 로만 생략한다. */
export type ProfilePatch = {
  name?: string;
  catColor?: string;
};

export function updateProfile(
  body: ProfilePatch,
  idempotencyKey: string = uuid(),
): Promise<AccountProfile> {
  return request<AccountProfile>('/me', { method: 'PATCH', body, idempotencyKey });
}

export type AccountWithdrawal = { deleted: boolean };

export function withdrawAccount(idempotencyKey: string = uuid()): Promise<AccountWithdrawal> {
  return request<AccountWithdrawal>('/me', {
    method: 'DELETE',
    body: { confirmation: 'DELETE' },
    idempotencyKey,
  });
}
