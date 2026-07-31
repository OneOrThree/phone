// groupApi.groupErrorCode 유닛 테스트 — 명세 docs/app/group-plan.md §3-2·§11.
// HTTP status가 아니라 서버 에러 바디의 code로 분기하는 게 계약이라(ROOM_FULL·ALREADY_MEMBER 둘 다 409)
// 이 함수가 조용히 null을 뱉기 시작하면 화면 분기가 전부 공통 문구로 무너진다.
import { AxiosError, AxiosHeaders } from 'axios';
import { groupErrorCode } from './groupApi';

// 서버 GlobalExceptionHandler가 내려주는 { code, message } 바디를 실은 axios 에러를 만든다.
function axiosErrorWith(status: number, data: unknown): AxiosError {
  const config = { headers: new AxiosHeaders() };
  return new AxiosError('request failed', 'ERR_BAD_REQUEST', config, null, {
    status,
    statusText: '',
    headers: {},
    config,
    data,
  });
}

describe('groupErrorCode', () => {
  test.each([
    ['GUEST_FORBIDDEN', 403],
    ['ALREADY_MEMBER', 409],
    ['ROOM_FULL', 409],
    ['NOT_FOUND', 404],
    ['MEMBER_ONLY', 403],
    ['HOST_WITHDRAW', 400],
  ])('서버 enum 이름 %s 를 그대로 돌려준다', (code, status) => {
    expect(groupErrorCode(axiosErrorWith(status, { code, message: '...' }))).toBe(code);
  });

  test('같은 409라도 code로 구분된다 — status만으론 불가능한 분기', () => {
    const already = groupErrorCode(axiosErrorWith(409, { code: 'ALREADY_MEMBER', message: '' }));
    const full = groupErrorCode(axiosErrorWith(409, { code: 'ROOM_FULL', message: '' }));
    expect(already).not.toBe(full);
  });

  test('바디에 code가 없으면 null', () => {
    expect(groupErrorCode(axiosErrorWith(500, { message: 'oops' }))).toBeNull();
  });

  test('응답 자체가 없으면(네트워크 오류) null', () => {
    expect(groupErrorCode(new AxiosError('Network Error'))).toBeNull();
  });

  test('axios 에러가 아니면 null', () => {
    expect(groupErrorCode(new Error('boom'))).toBeNull();
    expect(groupErrorCode(null)).toBeNull();
  });
});
