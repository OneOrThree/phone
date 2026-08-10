// useReduceMotion — '동작 줄이기' 상태 스토어의 초기값·구독 정책 테스트.
// 핵심은 "확정 전에는 보수적으로 켜짐으로 읽는다"와 "네이티브 리스너는 앱당 1개"다.
//
// 이 훅은 모듈 스코프에 상태를 1개만 두고 초기화도 1회뿐이라, 테스트마다 리셋하지 않고
// **한 파일 = 한 인스턴스**로 두고 단계 순서대로 검증한다(jest는 파일 내 test를 선언 순서로 실행).
// 조회 실패 경로는 다른 인스턴스가 필요해 useReduceMotion.queryFailure.test.ts 로 분리했다.
import { act, renderHook } from '@testing-library/react-native';
import { AccessibilityInfo, type EmitterSubscription } from 'react-native';
import { useReduceMotion, useReduceMotionReady } from './useReduceMotion';

// addEventListener는 이벤트별 오버로드라 mockImplementation이 첫 오버로드(announcementFinished)로
// 좁혀진다 — 반환 구독 객체와 핸들러 타입은 테스트용으로 단언해서 넘긴다.
const fakeSubscription = { remove: jest.fn() } as unknown as EmitterSubscription;

// 초기 조회를 테스트가 직접 resolve해서 '미확정' 구간을 관찰한다
let resolveQuery: (v: boolean) => void;
const query = new Promise<boolean>((resolve) => {
  resolveQuery = resolve;
});
let changeHandler: ((v: boolean) => void) | undefined;

const isEnabled = jest
  .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
  .mockReturnValue(query as ReturnType<typeof AccessibilityInfo.isReduceMotionEnabled>);
const addListener = jest
  .spyOn(AccessibilityInfo, 'addEventListener')
  .mockImplementation((_event, handler) => {
    changeHandler = handler as unknown as (v: boolean) => void;
    return fakeSubscription;
  });

describe('useReduceMotion', () => {
  test('조회가 끝나기 전에는 true — 접근성 설정을 어기느니 애니메이션을 생략한다', async () => {
    const { result } = await renderHook(() => useReduceMotion());
    expect(result.current).toBe(true);
  });

  // ⚠️ `useReduceMotion()`의 미확정 구간 true는 **실제 설정이 아니다.** 그 값으로 되돌릴 수 없는
  //    1회성 결정(단계 시퀀스 시작·진입 판정)을 내리면 설정을 켜지 않은 사용자도 연출을 통째로
  //    잃는다(결정 D-30). `ready`는 "지금 이 값으로 결정해도 되는가"를 묻는 짝이라, 이 구간을
  //    구분하지 못하면 방어가 통째로 무력해진다.
  test('조회 전에는 ready=false — 확정 여부를 값과 분리해 알려준다', async () => {
    const { result } = await renderHook(() => useReduceMotionReady());
    expect(result.current).toBe(false);
  });

  test('조회가 false로 끝나면 애니메이션을 허용한다', async () => {
    const { result } = await renderHook(() => useReduceMotion());
    await act(async () => resolveQuery(false));
    expect(result.current).toBe(false);
  });

  test('조회가 끝나면 ready=true', async () => {
    const { result } = await renderHook(() => useReduceMotionReady());
    expect(result.current).toBe(true);
  });

  test('설정 변경 이벤트가 오면 값이 갱신된다', async () => {
    const { result } = await renderHook(() => useReduceMotion());
    expect(result.current).toBe(false);
    await act(async () => changeHandler?.(true));
    expect(result.current).toBe(true);
    await act(async () => changeHandler?.(false));
    expect(result.current).toBe(false);
  });

  test('구독자가 0이 되는 사이의 변경도 놓치지 않는다 — 리스너를 떼지 않기 때문', async () => {
    const a = await renderHook(() => useReduceMotion());
    const b = await renderHook(() => useReduceMotion());
    await a.unmount();
    await b.unmount();

    // 화면에 버튼이 하나도 없는 동안 설정이 켜진 상황
    await act(async () => changeHandler?.(true));

    const c = await renderHook(() => useReduceMotion());
    // 비동기 재조회를 기다리지 않고 곧바로 최신 값을 준다
    expect(c.result.current).toBe(true);
  });

  test('버튼이 몇 개든 네이티브 리스너·초기 조회는 각각 1회뿐이다', async () => {
    await renderHook(() => useReduceMotion());
    await renderHook(() => useReduceMotion());
    expect(addListener).toHaveBeenCalledTimes(1);
    expect(isEnabled).toHaveBeenCalledTimes(1);
  });
});
