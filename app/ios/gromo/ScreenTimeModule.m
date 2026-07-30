// ScreenTimeModule.m
// gromo 메인 앱 타겟
//
// 역할: ScreenTimeModule.swift를 React Native 브릿지에 등록하는 Objective-C 파일
//
// 왜 .m 파일이 필요한가?
//   React Native의 브릿지 시스템은 Objective-C 매크로(RCT_EXPORT_MODULE 등)로 동작함
//   Swift만으로는 이 매크로를 쓸 수 없어서, ObjC 파일이 "등록" 역할을 담당

#import <React/RCTBridgeModule.h>

// @interface RCT_EXTERN_MODULE(...) ... @end 형태로 작성해야 함
// RCT_EXTERN_MODULE은 @interface 선언 안에서 클래스명 자리에 쓰는 매크로
@interface RCT_EXTERN_MODULE(ScreenTimeModule, NSObject)

// RCT_EXTERN_METHOD: Swift 메서드를 JS에서 호출 가능하도록 등록
RCT_EXTERN_METHOD(
    requestAuthorization:(RCTPromiseResolveBlock)resolve
    rejecter:(RCTPromiseRejectBlock)reject
)

RCT_EXTERN_METHOD(
    getAuthorizationStatus:(RCTPromiseResolveBlock)resolve
    rejecter:(RCTPromiseRejectBlock)reject
)

RCT_EXTERN_METHOD(
    setGoalSeconds:(double)seconds
    resolver:(RCTPromiseResolveBlock)resolve
    rejecter:(RCTPromiseRejectBlock)reject
)

RCT_EXTERN_METHOD(
    stopGoalMonitoring:(RCTPromiseResolveBlock)resolve
    rejecter:(RCTPromiseRejectBlock)reject
)

RCT_EXTERN_METHOD(
    startUsageBucketMonitoring:(double)maxMinutesValue
    resolver:(RCTPromiseResolveBlock)resolve
    rejecter:(RCTPromiseRejectBlock)reject
)

RCT_EXTERN_METHOD(
    getTodayUsageBucketMinutes:(RCTPromiseResolveBlock)resolve
    rejecter:(RCTPromiseRejectBlock)reject
)

RCT_EXTERN_METHOD(
    getYesterdayUsageBucketMinutes:(RCTPromiseResolveBlock)resolve
    rejecter:(RCTPromiseRejectBlock)reject
)

RCT_EXTERN_METHOD(
    getUsageBucketDebugInfo:(RCTPromiseResolveBlock)resolve
    rejecter:(RCTPromiseRejectBlock)reject
)

RCT_EXTERN_METHOD(
    setPendingSelectionApplyDate:(NSString *)dateString
    resolver:(RCTPromiseResolveBlock)resolve
    rejecter:(RCTPromiseRejectBlock)reject
)

RCT_EXTERN_METHOD(
    presentAppPicker:(RCTPromiseResolveBlock)resolve
    rejecter:(RCTPromiseRejectBlock)reject
)

RCT_EXTERN_METHOD(
    promoteSelection:(RCTPromiseResolveBlock)resolve
    rejecter:(RCTPromiseRejectBlock)reject
)

// ── 집중 세션 허용앱 / 실드 (GROMO-553) ──

RCT_EXTERN_METHOD(
    presentAllowedAppPicker:(RCTPromiseResolveBlock)resolve
    rejecter:(RCTPromiseRejectBlock)reject
)

RCT_EXTERN_METHOD(
    presentAllowedAppManager:(RCTPromiseResolveBlock)resolve
    rejecter:(RCTPromiseRejectBlock)reject
)

RCT_EXTERN_METHOD(
    getAllowedSelectionCounts:(RCTPromiseResolveBlock)resolve
    rejecter:(RCTPromiseRejectBlock)reject
)

RCT_EXTERN_METHOD(
    startFocusShield:(NSString *)subjectName
    resolver:(RCTPromiseResolveBlock)resolve
    rejecter:(RCTPromiseRejectBlock)reject
)

RCT_EXTERN_METHOD(
    stopFocusShield:(RCTPromiseResolveBlock)resolve
    rejecter:(RCTPromiseRejectBlock)reject
)

RCT_EXTERN_METHOD(
    setFocusAllowSafariWeb:(BOOL)allowed
    resolver:(RCTPromiseResolveBlock)resolve
    rejecter:(RCTPromiseRejectBlock)reject
)

RCT_EXTERN_METHOD(
    getFocusAllowSafariWeb:(RCTPromiseResolveBlock)resolve
    rejecter:(RCTPromiseRejectBlock)reject
)

// ── 집중 세션 Live Activity (GROMO-553) ──

RCT_EXTERN_METHOD(
    saveCharacterSnapshot:(NSString *)base64
    resolver:(RCTPromiseResolveBlock)resolve
    rejecter:(RCTPromiseRejectBlock)reject
)

RCT_EXTERN_METHOD(
    startFocusActivity:(NSString *)subjectName
    otherSubjectsJson:(NSString *)otherSubjectsJson
    resolver:(RCTPromiseResolveBlock)resolve
    rejecter:(RCTPromiseRejectBlock)reject
)

RCT_EXTERN_METHOD(
    endFocusActivity:(RCTPromiseResolveBlock)resolve
    rejecter:(RCTPromiseRejectBlock)reject
)

@end
