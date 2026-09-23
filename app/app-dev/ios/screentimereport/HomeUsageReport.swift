// HomeUsageReport.swift
// screentimereport 익스텐션
//
// 역할: v2 홈 "핸드폰 사용" 칸에 표시할 리포트 — 오늘 총 사용시간 + 목표 대비 진행 바.
//   TotalActivityReport와 데이터 가공(buildActivityReport)을 공유하고, 그리는 뷰만 다름.
//   totalDuration은 자정~현재를 직접 읽으므로 "이미 쓴 시간"까지 항상 정확.
//   목표(goalSeconds)는 메인 앱이 ScreenTimeReportView goalSeconds prop으로 App Group에 기록한 값.

import DeviceActivity
import ExtensionKit
import SwiftUI

// 메인 앱에서 DeviceActivityReport(.init("Home Usage"), ...)로 요청하면 이 리포트가 응답
extension DeviceActivityReport.Context {
    static let homeUsage = Self("Home Usage")
}

struct HomeUsageReport: DeviceActivityReportScene {

    let context: DeviceActivityReport.Context = .homeUsage

    let content: (ActivityReport) -> HomeUsageView

    func makeConfiguration(representing data: DeviceActivityResults<DeviceActivityData>) async -> ActivityReport {
        return await buildActivityReport(from: data)
    }
}
