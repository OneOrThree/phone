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

// 워치 명령 인박스(GROMO-1600) — 수신·영속화는 WatchCommandInbox 싱글턴이 하고,
// 여기서는 JS가 드레인·킬스위치를 만질 창구만 연다.
RCT_EXTERN_METHOD(
    drainWatchCommands:(RCTPromiseResolveBlock)resolve
    rejecter:(RCTPromiseRejectBlock)reject
)

RCT_EXTERN_METHOD(
    ackWatchCommands:(NSArray *)commandIds
    resolver:(RCTPromiseResolveBlock)resolve
    rejecter:(RCTPromiseRejectBlock)reject
)

RCT_EXTERN_METHOD(
    getWatchKillSwitch:(RCTPromiseResolveBlock)resolve
    rejecter:(RCTPromiseRejectBlock)reject
)

RCT_EXTERN_METHOD(
    setWatchKillSwitch:(BOOL)enabled
    resolver:(RCTPromiseResolveBlock)resolve
    rejecter:(RCTPromiseRejectBlock)reject
)

// 디버그 전용 — 워치 앱 부재 상태에서 인박스 경로를 손으로 태우는 수단
RCT_EXTERN_METHOD(
    debugEnqueueWatchCommand:(NSString *)json
    resolver:(RCTPromiseResolveBlock)resolve
    rejecter:(RCTPromiseRejectBlock)reject
)

@end
