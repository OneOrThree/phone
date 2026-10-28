#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(MetaAppEventsModule, NSObject)
RCT_EXTERN_METHOD(syncTracking:(BOOL)requestPermission
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
@end
