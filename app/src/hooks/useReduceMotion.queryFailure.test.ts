// useReduceMotion — 초기 조회가 실패한 경우.
// 훅의 모듈 상태·초기화가 앱(=파일)당 1회라 실패 시나리오만 별도 파일로 뗀다
// (본류는 useReduceMotion.test.ts).
import { act, renderHook } from '@testing-library/react-native';
import { AccessibilityInfo, type EmitterSubscription } from 'react-native';
import { useReduceMotion } from './useReduceMotion';

jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockRejectedValue(new Error('unavailable'));
jest
  .spyOn(AccessibilityInfo, 'addEventListener')
  .mockReturnValue({ remove: jest.fn() } as unknown as EmitterSubscription);

test('조회 실패는 false로 확정한다 — 값을 못 읽는 기기에서 애니메이션이 통째로 사라지지 않게', async () => {
  // 확정 전 보수적 true 구간은 useReduceMotion.test.ts 가 검증한다 — 여기선 실패 확정만 본다
  const { result } = await renderHook(() => useReduceMotion());
  await act(async () => {});
  expect(result.current).toBe(false);
});
