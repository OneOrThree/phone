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
import FamilyControls   // FamilyActivitySelection (측정 대상 유무 판별)
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

// 카테고리 하나의 사용 정보를 담는 구조체
struct CategoryUsage: Identifiable {
    let id = UUID()
    let name: String            // 카테고리 이름 (예: "소셜")
    let duration: TimeInterval  // 사용 시간 (초 단위, 소속 앱 합산)
}

// 전체 리포트 데이터를 담는 구조체
// makeConfiguration()이 만들고, TotalActivityView가 받아서 화면에 표시
struct ActivityReport {
    let totalDuration: TimeInterval  // 오늘 총 사용 시간 (초 단위)
    let apps: [AppUsage]             // 앱별 사용 시간 목록 (사용 시간 내림차순)
    let categories: [CategoryUsage]  // 카테고리별 사용 시간 목록 (내림차순)
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
    var categoryDurations: [String: TimeInterval] = [:]
    var segmentTotal: TimeInterval = 0
    var appSum: TimeInterval = 0

    // 데이터 구조: data → activitySegments → categories → applications 순으로 중첩.
    // 총합 후보를 두 개 집계한다:
    //  - segmentTotal: Apple이 계산한 세그먼트 총 사용시간. 홈화면 체류·웹 등 앱 미귀속
    //    사용분까지 포함해 정확하지만(앱별 합산은 실측 -48분), DeviceActivityFilter의
    //    앱/카테고리 필터가 이 레벨엔 **적용되지 않는다**(측정 대상을 골라도 전체 기기
    //    사용량이 나옴 — Apple Developer Forums 735012).
    //  - appSum: 앱별 합산. 필터가 실제로 반영되는 레벨이라 측정 대상 선택 시 이걸 총합으로
    //    쓴다. (개별 앱+웹도메인 선택 시 웹도메인 사용분이 빠지는 건 한계로 남는다.)
    // gromo 자신의 사용 시간은 어느 쪽에서도 제외한다(GROMO-843) — 집중 세션 중 앱을 켜둔
    // 시간이 "핸드폰 사용"으로 잡히면 안 되기 때문.
    // bundleIdentifier는 리포트 익스텐션 안에서만 값이 채워진다(메인 앱에선 opaque 토큰뿐).
    for await d in data {
        for await segment in d.activitySegments {
            segmentTotal += segment.totalActivityDuration
            for await categoryActivity in segment.categories {
                let catName = categoryActivity.category.localizedDisplayName ?? "기타"
                for await app in categoryActivity.applications {
                    let duration = app.totalActivityDuration
                    if app.application.bundleIdentifier == "com.oneorthree.gromo" {
                        segmentTotal -= duration
                        continue
                    }
                    appSum += duration
                    let name = app.application.localizedDisplayName ?? "알 수 없음"
                    apps.append(AppUsage(name: name, duration: duration))
                    categoryDurations[catName, default: 0] += duration
                }
            }
        }
    }

    // 많이 쓴 앱이 위에 오도록 내림차순 정렬
    apps.sort { $0.duration > $1.duration }

    // 카테고리별 사용 시간 목록 (내림차순)
    let categories = categoryDurations
        .map { CategoryUsage(name: $0.key, duration: $0.value) }
        .sorted { $0.duration > $1.duration }

    // 측정 대상 선택 유무로 총합을 고른다 — 메인 앱(ScreenTimeReportUIView)이 필터를 만들 때와
    // 동일한 키·동일한 빈 선택 판정을 써서 "필터가 걸렸는지"를 판별한다.
    // synchronize(): 프로세스 간 공유 UserDefaults 캐시를 디스크에서 강제 재로드 —
    // 메인 앱이 방금 바꾼 선택/목표를 읽기 전에 수행한다.
    let sharedDefaults = UserDefaults(suiteName: "group.com.oneorthree.gromo")
    sharedDefaults?.synchronize()
    var hasSelection = false
    if let selectionData = sharedDefaults?.data(forKey: "gromo:goal:selection"),
       let selection = try? JSONDecoder().decode(FamilyActivitySelection.self, from: selectionData) {
        hasSelection = !(selection.applicationTokens.isEmpty
            && selection.categoryTokens.isEmpty
            && selection.webDomainTokens.isEmpty)
    }
    let totalDuration = hasSelection ? appSum : segmentTotal

    // App Group UserDefaults에 총 사용 시간 저장 (메인 앱에서 읽을 수 있도록)
    if let sharedDefaults = sharedDefaults {
        sharedDefaults.set(totalDuration, forKey: "gromo:screentime:totalDuration")
        sharedDefaults.set(Date(), forKey: "gromo:screentime:lastUpdated")
    }

    // 메인 앱이 App Group에 쓴 목표 시간을 읽어서 "남은 시간" 계산에 사용
    let goalSeconds = sharedDefaults?.double(forKey: "gromo:user:goalSeconds") ?? -1

    return ActivityReport(
        totalDuration: totalDuration,
        apps: apps,
        categories: categories,
        goalSeconds: goalSeconds
    )
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

// TimeInterval(초)을 "HH:MM:SS" 형태로 변환 — 홈 "핸드폰 사용" 값 전용
// (JS 홈 "공부 집중" 값과 포맷을 맞춤)
func formatClock(_ duration: TimeInterval) -> String {
    let total = max(0, Int(duration))
    return String(format: "%02d:%02d:%02d", total / 3600, total / 60 % 60, total % 60)
}
