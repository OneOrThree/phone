// CompactActivityReport.swift
// screentimereport 익스텐션
//
// 역할: HomeScreen "사용" StatBox에 표시할, 총 사용 시간 숫자만 담은 컴팩트 리포트
//
// TotalActivityReport와 데이터 가공 로직(buildActivityReport)을 공유하고,
// 화면에 그리는 뷰(CompactActivityView)만 다름

import DeviceActivity
import ExtensionKit
import SwiftUI

// 메인 앱에서 DeviceActivityReport(.init("Compact Activity"), ...)로 요청하면
// 이 리포트가 응답함
extension DeviceActivityReport.Context {
    static let compactActivity = Self("Compact Activity")
}

struct CompactActivityReport: DeviceActivityReportScene {

    let context: DeviceActivityReport.Context = .compactActivity

    let content: (ActivityReport) -> CompactActivityView

    func makeConfiguration(representing data: DeviceActivityResults<DeviceActivityData>) async -> ActivityReport {
        return await buildActivityReport(from: data)
    }
}
