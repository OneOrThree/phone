// ScreenTimeReportViewManager.m
// ScreenTimeReportViewManager를 React Native 브릿지에 등록

#import <React/RCTViewManager.h>

// RCT_EXTERN_MODULE은 @interface 블록 안에서 사용해야 함
@interface RCT_EXTERN_MODULE(ScreenTimeReportViewManager, RCTViewManager)

// DeviceActivityReport.Context 이름 ("Total Activity" | "Compact Activity")
RCT_EXPORT_VIEW_PROPERTY(reportContext, NSString)
RCT_EXPORT_VIEW_PROPERTY(goalSeconds, double)
// 표시할 날짜 오프셋(일): 0=오늘, -1=어제. 온보딩 '어제 스크린타임' 화면에서 사용.
RCT_EXPORT_VIEW_PROPERTY(dayOffset, double)

@end

// 집중 세션 허용앱 목록 네이티브 뷰 — RN 컴포넌트명 'AllowedAppsListView'
@interface RCT_EXTERN_MODULE(AllowedAppsListViewManager, RCTViewManager)

@end
