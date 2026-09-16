import { DrumPickerCore, type DrumPickerProps } from './DrumPickerCore';

// 네이티브는 ScrollView가 제공하는 drag/momentum 종료 이벤트로 선택을 확정한다.
export function DrumPicker(props: DrumPickerProps) {
  return <DrumPickerCore {...props} scrollAdapter="native" />;
}
