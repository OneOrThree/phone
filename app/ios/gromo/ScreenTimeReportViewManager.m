// ScreenTimeReportViewManager.m
// ScreenTimeReportViewManager를 React Native 브릿지에 등록

#import <React/RCTViewManager.h>

// RCT_EXTERN_MODULE은 @interface 블록 안에서 사용해야 함
@interface RCT_EXTERN_MODULE(ScreenTimeReportViewManager, RCTViewManager)
@end
