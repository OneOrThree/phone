// useReduceMotion — 초기 조회와 설정 변경 이벤트의 순서 역전.
// 조회는 비동기라, 조회가 도는 사이 들어온 이벤트보다 나중에 완료될 수 있다.
// 이때 낡은 조회 결과가 최신 설정을 덮어쓰면 안 된다.
// 훅의 모듈 상태·초기화가 앱(=파일)당 1회라 이 시나리오도 별도 파일로 뗀다
// (본류는 useReduceMotion.test.ts).
import { act, renderHook } from '@testing-library/react-native';
import { AccessibilityInfo, type EmitterSubscription } from 'react-native';
import { useReduceMotion } from './useReduceMotion';

let resolveQuery: (v: boolean) => void;
const query = new Promise<boolean>((resolve) => {
  resolveQuery = resolve;
});
let changeHandler: ((v: boolean) => void) | undefined;

jest
  .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
  .mockReturnValue(query as ReturnType<typeof AccessibilityInfo.isReduceMotionEnabled>);
jest.spyOn(AccessibilityInfo, 'addEventListener').mockImplementation((_event, handler) => {
  changeHandler = handler as unknown as (v: boolean) => void;
  return { remove: jest.fn() } as unknown as EmitterSubscription;
});

describe('useReduceMotion — 늦게 도착한 초기 조회', () => {
  test('이벤트로 받은 최신 값을 초기 조회 결과가 덮어쓰지 않는다', async () => {
    const { result } = await renderHook(() => useReduceMotion());

    // 조회가 아직 대기 중인 사이에 사용자가 '동작 줄이기'를 켠 상황
    await act(async () => changeHandler?.(true));
    expect(result.current).toBe(true);

    // 그 뒤 뒤늦게 완료된 초기 조회는 켜지기 전 값(false)을 들고 온다
    await act(async () => resolveQuery(false));
    expect(result.current).toBe(true);
  });

  test('초기 조회를 버린 뒤에도 이후 이벤트는 정상 반영된다', async () => {
    const { result } = await renderHook(() => useReduceMotion());
    await act(async () => changeHandler?.(false));
    expect(result.current).toBe(false);
  });
});
