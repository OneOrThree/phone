#import <React/RCTViewManager.h>

@interface RCT_EXTERN_MODULE(ScreenTimeReportViewManager, RCTViewManager)
RCT_EXPORT_VIEW_PROPERTY(reportContext, NSString)
RCT_EXPORT_VIEW_PROPERTY(goalSeconds, double)
RCT_EXPORT_VIEW_PROPERTY(dayOffset, double)
@end
