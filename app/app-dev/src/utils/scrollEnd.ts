import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';

/** ScrollView와 overflow 패널 모두에서 아래쪽 한 터치 영역 안에 들어왔는지 확인한다. */
export function isNearScrollEnd(
  event: NativeSyntheticEvent<NativeScrollEvent> | React.UIEvent<HTMLElement>,
): boolean {
  if ('contentOffset' in event.nativeEvent) {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    return contentOffset.y + layoutMeasurement.height >= contentSize.height - 44;
  }
  const node = event.currentTarget as HTMLElement;
  return node.scrollTop + node.clientHeight >= node.scrollHeight - 44;
}
