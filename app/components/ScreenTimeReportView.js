// ScreenTimeReportView.js
// ScreenTimeReportViewManager 네이티브 뷰의 JS 컴포넌트
//
// 역할: Swift로 만든 네이티브 뷰(ScreenTimeReportUIView)를
//       React Native JSX에서 <ScreenTimeReportView /> 형태로 사용할 수 있게 선언
//
// 사용 방법:
//   import ScreenTimeReportView from '../components/ScreenTimeReportView';
//   <ScreenTimeReportView style={{ flex: 1 }} />
//
// props:
//   reportContext (string, 기본값 "Total Activity")
//     - "Total Activity": 총 사용 시간 + 앱별 목록 (ScreenTimeScreen)
//     - "Compact Activity": 총 사용 시간 숫자만 (HomeScreen "사용" StatBox)
//     - "Remaining Activity": 남은 시간 (HomeScreen "남은" StatBox)
//   goalSeconds (number, Remaining Activity 전용)
//     - didSet에서 App Group에 동기 기록 → 익스텐션이 항상 최신 목표 시간을 읽음

import { requireNativeComponent, Platform } from 'react-native';

// requireNativeComponent: RN이 ViewManager 클래스명에서 "Manager" 접미사를 제거한 이름으로 등록
// ScreenTimeReportViewManager → 'ScreenTimeReportView'
const ScreenTimeReportView =
  Platform.OS === 'ios' ? requireNativeComponent('ScreenTimeReportView') : null;

export default ScreenTimeReportView;
