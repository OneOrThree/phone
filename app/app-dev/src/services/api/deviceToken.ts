/**
 * 푸시 기기 토큰 등록·삭제 도메인 모듈(GROMO-2524). 알림 서버가 이 기기의 FCM 토큰을 사용자에 묶는다.
 *
 * ⚠️ **2.0 앱이 `/api/v1` 을 부르는 첫 예외다.** 공개 표면은 무접두 경로지만(`client.ts` 머리 주석) 이
 * 두 경로는 서버가 `/api/v1/users/me/device-token` 에만 두었고(`UserNotificationController`) nginx 가
 * 2.0 용으로 열어 둔 호환 표면이다. 그래서 성공은 `{data}` 봉투 없는 본문, 오류는 **legacy 최상위
 * `{code,message}`** 로 온다 — `request()` 가 둘 다 읽어 `ApiError.code` 로 올린다. 이 파일 밖에서 `/api/v1`
 * 을 부르지 않는다.
 *
 * 계약:
 *  - `PUT    /api/v1/users/me/device-token`  Bearer AT + `Idempotency-Key` + 본문
 *            `{ deviceToken(필수 ≤512), ownershipToken?(직전 응답값·정규 UUID), deviceBootstrap? }`
 *            → 200 `{ ownershipToken, deliveryTag? }`. `deliveryTag` 는 서버가 싣기 전·응답 재생에는
 *            없다 — 부재는 영구 정상이다.
 *  - `DELETE /api/v1/users/me/device-token`  본문 없이 헤더 `X-Device-Token`·`X-Device-Ownership`·
 *            `Idempotency-Key` → 204.
 *  - 오류 code: 409 `DEVICE_OWNERSHIP_CONFLICT`·`SESSION_REVOKED`·`STALE_AUTH_GENERATION`·
 *            `IDEMPOTENCY_KEY_CONFLICT`, 401 `USER_INACTIVE`, 502, 503.
 *
 * 만료 AT 의 401 `UNAUTHORIZED` 는 `request()` 가 refresh 로 한 번 갱신해 같은 요청을 다시 보낸다 —
 * 멱등 키도 그대로다. 응답 유실 뒤의 재시도(같은 키·같은 본문으로 서버가 저장 응답을 재생)는 호출부 몫이다.
 */
import { ApiError, request, uuid } from './client';

const DEVICE_TOKEN_PATH = '/api/v1/users/me/device-token';

export type DeviceRegistrationBody = {
  deviceToken: string;
  /** 직전 등록 응답의 값(CAS). 첫 등록·소유자가 바뀐 기기는 생략한다 — 빈 값은 서버가 400 이다. */
  ownershipToken?: string;
  /** 그 로그인 세션의 1회용 자격(`auth.takeDeviceBootstrap`). 없으면 생략한다. */
  deviceBootstrap?: string;
};

export type DeviceRegistration = {
  /** 다음 등록·삭제 요청에 실을 CAS 값. */
  ownershipToken: string;
  /** 이 등록의 푸시 식별 태그. 서버가 주지 않으면 키 자체가 없다. */
  deliveryTag?: string;
};

/** `idempotencyKey` 는 호출부가 고정해서 넘긴다 — 응답이 유실돼 다시 보낼 때 같은 값이어야 재생된다. */
export async function registerDevice(
  body: DeviceRegistrationBody,
  idempotencyKey: string,
): Promise<DeviceRegistration> {
  const result = await request<{ ownershipToken?: unknown; deliveryTag?: unknown } | null>(
    DEVICE_TOKEN_PATH,
    { method: 'PUT', body, idempotencyKey },
  );
  // 형식만 본다 — 값의 의미(UUID 여부)는 서버가 다음 요청에서 판정한다.
  if (typeof result?.ownershipToken !== 'string' || !result.ownershipToken)
    throw new ApiError('UPSTREAM_CONTRACT_MISMATCH', '기기 등록 응답이 올바르지 않아요.', 502);
  return {
    ownershipToken: result.ownershipToken,
    ...(typeof result.deliveryTag === 'string' ? { deliveryTag: result.deliveryTag } : {}),
  };
}

/** 대상 토큰·CAS 값은 본문이 아니라 헤더로 보낸다. `ownershipToken` 이 없으면 그 헤더는 생략한다. */
export async function deleteDevice(
  deviceToken: string,
  ownershipToken: string | undefined,
  idempotencyKey: string = uuid(),
): Promise<void> {
  await request<unknown>(DEVICE_TOKEN_PATH, {
    method: 'DELETE',
    headers: {
      'X-Device-Token': deviceToken,
      ...(ownershipToken ? { 'X-Device-Ownership': ownershipToken } : {}),
    },
    idempotencyKey,
  });
}
