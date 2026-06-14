// ScreenTimeReportViewManager.swift
// React Native에 ScreenTimeReportUIView를 등록하는 ViewManager

import Foundation

@objc(ScreenTimeReportViewManager)
class ScreenTimeReportViewManager: RCTViewManager {

    override static func requiresMainQueueSetup() -> Bool {
        return true
    }

    // React Native가 이 뷰를 렌더링할 때 호출 — ScreenTimeReportUIView 인스턴스를 반환
    // iOS 16 미만에서는 빈 UIView 반환
    override func view() -> UIView! {
        if #available(iOS 16.0, *) {
            return ScreenTimeReportUIView()
        }
        return UIView()
    }
}
