/* eslint-env jest */
import { Animated } from 'react-native';

/**
 * 테스트 전용. Jest 에는 네이티브 애니메이터가 없어(목은 16ms 뒤 끝났다고만 알린다) 네이티브 드라이버
 * 애니메이션의 진행을 볼 수 없다. 같은 설정을 JS 드라이버로 돌려 경과 값을 관찰한다(FiButton.test 와 같은 방식).
 * 네이티브 반복(iterations: -1)은 JS 드라이버에 없어 Animated.loop 로 흉내 낸다.
 * jest.restoreAllMocks(또는 돌려준 spy 의 mockRestore)로 되돌린다.
 */
export function observeAnimatedOnJsDriver() {
  const timing = Animated.timing;
  return jest.spyOn(Animated, 'timing').mockImplementation((value, config) => {
    const animation = timing(value, { ...config, useNativeDriver: false });
    return (config as { iterations?: number }).iterations === -1
      ? Animated.loop(animation)
      : animation;
  });
}
