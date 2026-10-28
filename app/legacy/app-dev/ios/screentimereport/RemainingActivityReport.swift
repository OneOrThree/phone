// RemainingActivityReport.swift
// screentimereport 익스텐션
//
// 역할: HomeScreen "남은" StatBox에 표시할, "목표 - 사용 = 남은" 시간을
//       익스텐션 내부에서 계산해 보여주는 리포트
//
// TotalActivityReport와 데이터 가공 로직(buildActivityReport)을 공유하고,
// 화면에 그리는 뷰(RemainingActivityView)만 다름

import DeviceActivity
import ExtensionKit
import SwiftUI

// 메인 앱에서 DeviceActivityReport(.init("Remaining Activity"), ...)로 요청하면
// 이 리포트가 응답함
extension DeviceActivityReport.Context {
    static let remainingActivity = Self("Remaining Activity")
}

struct RemainingActivityReport: DeviceActivityReportScene {

    let context: DeviceActivityReport.Context = .remainingActivity

    let content: (ActivityReport) -> RemainingActivityView

    func makeConfiguration(representing data: DeviceActivityResults<DeviceActivityData>) async -> ActivityReport {
        return await buildActivityReport(from: data)
    }
}
