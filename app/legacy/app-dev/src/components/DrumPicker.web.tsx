import { DrumPickerCore, type DrumPickerProps } from './DrumPickerCore';

// 웹은 DOM scroll 종료를 debounce로 보정한다. 시각·애니메이션 구현은 네이티브와 완전히 공유한다.
export function DrumPicker(props: DrumPickerProps) {
  return <DrumPickerCore {...props} scrollAdapter="web" />;
}
