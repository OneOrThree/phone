// WatchSessionModule.m
// gromo 메인 앱 타겟
//
// 역할: WatchSessionModule.swift를 React Native 브릿지에 등록하는 Objective-C 파일
//       (ScreenTimeModule.m과 같은 RCT_EXTERN_MODULE 패턴)

#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(WatchSessionModule, NSObject)

RCT_EXTERN_METHOD(
    getPairingStatus:(RCTPromiseResolveBlock)resolve
    rejecter:(RCTPromiseRejectBlock)reject
)

@end
