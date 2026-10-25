import React

@objc(ScreenTimeReportViewManager)
final class ScreenTimeReportViewManager: RCTViewManager {
    override static func requiresMainQueueSetup() -> Bool { true }
    override func view() -> UIView! { ScreenTimeReportUIView() }
}
