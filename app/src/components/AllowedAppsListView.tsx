// AllowedAppsListView.tsx
// AllowedAppsListViewManager 네이티브 뷰의 JS 컴포넌트
//
// 역할: 집중 세션 허용앱 목록(아이콘+이름)을 그리는 네이티브 SwiftUI 뷰를
//       <AllowedAppsListView /> 로 사용할 수 있게 선언.
//
// 왜 네이티브인가? 허용앱은 opaque 토큰이라 JS에서 아이콘/이름을 읽을 수 없고,
// SwiftUI Label(token)으로만 프라이버시 보호 형태로 렌더 가능하다.
// App Group의 gromo:focus:allowedSelection을 네이티브가 직접 읽어 표시한다.
//
// 사용:
//   import AllowedAppsListView from '@/components/AllowedAppsListView';
//   {AllowedAppsListView && <AllowedAppsListView style={{ height: 120 }} />}
// 높이가 없으면 0으로 접히므로 style로 height를 반드시 지정.

import { requireNativeComponent, Platform, type ViewProps } from 'react-native';
import type { ComponentType } from 'react';

// ViewManager 클래스명에서 "Manager"를 뗀 이름으로 등록됨:
// AllowedAppsListViewManager → 'AllowedAppsListView'
const AllowedAppsListView: ComponentType<ViewProps> | null =
  Platform.OS === 'ios'
    ? requireNativeComponent<ViewProps>('AllowedAppsListView')
    : null;

export default AllowedAppsListView;
