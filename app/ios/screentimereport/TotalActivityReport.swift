// TotalActivityReport.swift
// screentimereport 익스텐션
//
// 역할: Apple DeviceActivity 프레임워크에서 스크린 타임 원시 데이터를 받아
//       우리 앱에서 쓸 수 있는 형태(ActivityReport)로 가공하는 파일
//
// 동작 흐름:
//   메인 앱에서 DeviceActivityReport(.init("Total Activity"), ...)를 렌더링하면
//   → iOS가 이 익스텐션을 호출
//   → makeConfiguration()이 raw 데이터를 ActivityReport로 변환
//   → TotalActivityView에 전달해서 화면에 표시

import DeviceActivity   // Apple 스크린 타임 데이터 접근 프레임워크
import ExtensionKit     // 익스텐션 앱 개발용 프레임워크
import ManagedSettings  // 앱 제한/설정 관련 프레임워크
import SwiftUI

// DeviceActivityReport.Context는 리포트의 "이름표"
// 메인 앱에서 DeviceActivityReport(.init("Total Activity"), ...)를 호출하면
// iOS가 이 context와 일치하는 익스텐션을 찾아서 실행함
extension DeviceActivityReport.Context {
    static let totalActivity = Self("Total Activity")
}

// 앱 하나의 사용 정보를 담는 구조체
struct AppUsage: Identifiable {
    let id = UUID()             // SwiftUI 리스트 렌더링용 고유 ID
    let name: String            // 앱 이름 (예: "카카오톡")
    let duration: TimeInterval  // 사용 시간 (초 단위)
}

// 전체 리포트 데이터를 담는 구조체
// makeConfiguration()이 만들고, TotalActivityView가 받아서 화면에 표시
struct ActivityReport {
    let totalDuration: TimeInterval  // 오늘 총 사용 시간 (초 단위)
    let apps: [AppUsage]             // 앱별 사용 시간 목록 (사용 시간 내림차순)
    let goalSeconds: TimeInterval  // 메인 앱이 App Group에 저장한 목표 시간 (없으면 -1)
}

// DeviceActivityReportScene: Apple이 제공하는 프로토콜
// "어떤 context 요청에 어떤 뷰를 응답할지" 정의하는 핵심 구조체
struct TotalActivityReport: DeviceActivityReportScene {

    // 이 리포트가 응답할 context 지정
    // 메인 앱의 DeviceActivityReport(.init("Total Activity"), ...)와 매칭됨
    let context: DeviceActivityReport.Context = .totalActivity

    // 가공된 ActivityReport를 받아 TotalActivityView를 만드는 클로저
    let content: (ActivityReport) -> TotalActivityView

    // Apple DeviceActivity 프레임워크에서 스크린 타임 원시 데이터를 받아
    // 우리 앱에서 쓸 수 있는 형태(ActivityReport)로 가공하는 파일
    func makeConfiguration(representing data: DeviceActivityResults<DeviceActivityData>) async -> ActivityReport {
        return await buildActivityReport(from: data)
    }
}

// 원시 DeviceActivity 데이터를 ActivityReport로 가공
// TotalActivityReport / CompactActivityReport에서 공통으로 사용
func buildActivityReport(from data: DeviceActivityResults<DeviceActivityData>) async -> ActivityReport {
    var apps: [AppUsage] = []
    var totalDuration: TimeInterval = 0

    // 데이터 구조: data → activitySegments → categories → applications 순으로 중첩
    for await d in data {
        for await segment in d.activitySegments {
            totalDuration += segment.totalActivityDuration  // 세그먼트 총 시간 누적

            for await category in segment.categories {
                for await app in category.applications {
                    // 앱 표시 이름 (시스템에서 제공, 없으면 "알 수 없음")
                    let name = app.application.localizedDisplayName ?? "알 수 없음"
                    apps.append(AppUsage(name: name, duration: app.totalActivityDuration))
                }
            }
        }
    }

    // 많이 쓴 앱이 위에 오도록 내림차순 정렬
    apps.sort { $0.duration > $1.duration }

    // App Group UserDefaults에 총 사용 시간 저장 (메인 앱에서 읽을 수 있도록)
    let sharedDefaults = UserDefaults(suiteName: "group.com.oneorthree.gromo")
    if let sharedDefaults = sharedDefaults {
        sharedDefaults.set(totalDuration, forKey: "gromo:screentime:totalDuration")
        sharedDefaults.set(Date(), forKey: "gromo:screentime:lastUpdated")
    }

    // 메인 앱이 App Group에 쓴 목표 시간을 읽어서 "남은 시간" 계산에 사용
    // synchronize(): 프로세스 간 공유 UserDefaults 캐시를 디스크에서 강제 재로드
    sharedDefaults?.synchronize()
    let goalSeconds = sharedDefaults?.double(forKey: "gromo:user:goalSeconds") ?? -1

    return ActivityReport(totalDuration: totalDuration, apps: apps, goalSeconds: goalSeconds)
}

// TimeInterval(초)을 "X시간 Y분" 형태로 변환
// TotalActivityView / CompactActivityView에서 공통으로 사용
func formatDuration(_ duration: TimeInterval) -> String {
    let hours = Int(duration) / 3600
    let minutes = Int(duration) / 60 % 60
    if hours > 0 {
        return "\(hours)시간 \(minutes)분"
    } else {
        return "\(minutes)분"
    }
}
