// ScreenTimeModule.swift
// gromo 메인 앱 타겟
//
// 역할: React Native JS 코드에서 호출할 수 있는 네이티브 모듈
//       스크린 타임 접근 권한 요청 및 현재 권한 상태 확인 기능 제공
//
// 사용 방법 (JS에서):
//   import { NativeModules } from 'react-native';
//   const { ScreenTimeModule } = NativeModules;
//   await ScreenTimeModule.requestAuthorization();

import Foundation
import ActivityKit     // 집중 세션 Live Activity(다이나믹 아일랜드)
import FamilyControls  // 스크린 타임 권한 요청에 필요한 Apple 프레임워크
import DeviceActivity  // DeviceActivityCenter, DeviceActivitySchedule, DeviceActivityEvent
import ManagedSettings // 집중 세션 중 앱 차단(shield)
import SwiftUI         // FamilyActivityPicker 표시용

// @objc: Objective-C 런타임에 노출 (React Native 브릿지가 ObjC 기반이라 필요)
@objc(ScreenTimeModule)
class ScreenTimeModule: NSObject {

    // React Native 브릿지에 이 모듈을 등록할 때 사용하는 이름
    // JS에서 NativeModules.ScreenTimeModule로 접근 가능
    @objc static func moduleName() -> String {
        return "ScreenTimeModule"
    }

    // 메인 스레드가 아닌 별도 스레드에서 실행 허용 (성능 최적화)
    @objc static func requiresMainQueueSetup() -> Bool {
        return false
    }

    // 스크린 타임 권한 요청
    // JS에서 await ScreenTimeModule.requestAuthorization() 으로 호출
    //
    // resolve: 성공 시 호출 (true = 권한 승인, false = 거부)
    // reject: 에러 발생 시 호출
    @objc func requestAuthorization(
        _ resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        // FamilyControls의 requestAuthorization은 iOS 16.0 이상 필요
        guard #available(iOS 16.0, *) else {
            reject("UNAVAILABLE", "iOS 16.0 이상에서만 사용 가능합니다.", nil)
            return
        }
        Task {
            do {
                // .individual: 본인 기기 데이터 접근 권한 요청 (가족 관리와 구분)
                try await AuthorizationCenter.shared.requestAuthorization(for: .individual)
                let isApproved = AuthorizationCenter.shared.authorizationStatus == .approved
                resolve(isApproved)
            } catch {
                reject("AUTH_ERROR", "권한 요청 실패: \(error.localizedDescription)", error)
            }
        }
    }

    // 현재 권한 상태 확인
    // JS에서 await ScreenTimeModule.getAuthorizationStatus() 로 호출
    // 반환값: "approved" | "denied" | "notDetermined"
    @objc func getAuthorizationStatus(
        _ resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        guard #available(iOS 16.0, *) else {
            resolve("notDetermined")
            return
        }
        let status = AuthorizationCenter.shared.authorizationStatus
        switch status {
        case .approved:
            resolve("approved")
        case .denied:
            resolve("denied")
        case .notDetermined:
            resolve("notDetermined")
        @unknown default:
            resolve("notDetermined")
        }
    }

    // 총 스크린 타임 조회 (App Group을 통해 익스텐션에서 저장된 값 읽기)
    // JS에서 await ScreenTimeModule.getTotalScreenTime() 로 호출
    // 반환값: 초 단위 숫자 (예: 9157 = 2시간 32분 37초)
    @objc func getTotalScreenTime(
        _ resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        let sharedDefaults = UserDefaults(suiteName: "group.com.oneorthree.gromo")
        let totalDuration = sharedDefaults?.double(forKey: "gromo:screentime:totalDuration") ?? 0
        resolve(totalDuration)
    }

    // 목표 시간을 App Group에 저장 (익스텐션에서 읽어서 "남은 시간" 계산에 사용)
    // JS에서 await ScreenTimeModule.setGoalSeconds(goalSeconds) 로 호출
    @objc func setGoalSeconds(
        _ seconds: Double,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        let sharedDefaults = UserDefaults(suiteName: "group.com.oneorthree.gromo")
        sharedDefaults?.set(seconds, forKey: "gromo:user:goalSeconds")
        resolve(nil)
    }

    // 매일 자정 기준으로 스크린 타임 목표 달성 여부를 모니터링 시작
    // goalSeconds를 threshold로 설정 — 초과하면 Monitor 익스텐션의 eventDidReachThreshold가 호출됨
    // goalSeconds 변경 시 재호출하면 이전 모니터링을 교체함
    @objc func startGoalMonitoring(
        _ goalSecondsValue: Double,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        guard #available(iOS 16.0, *) else {
            resolve(nil)
            return
        }

        let center = DeviceActivityCenter()
        let activityName = DeviceActivityName("gromo.daily")

        var startComponents = DateComponents()
        startComponents.hour = 0
        startComponents.minute = 0

        var endComponents = DateComponents()
        endComponents.hour = 23
        endComponents.minute = 59

        let schedule = DeviceActivitySchedule(
            intervalStart: startComponents,
            intervalEnd: endComponents,
            repeats: true
        )

        // App Group에 저장된 "측정 대상"(picker로 선택한 앱/카테고리) 로드
        // 이게 있어야 threshold 이벤트가 실제로 발화함 (빈 배열이면 발화 안 함)
        let defaults = UserDefaults(suiteName: "group.com.oneorthree.gromo")
        guard
            let data = defaults?.data(forKey: "gromo:goal:selection"),
            let selection = try? JSONDecoder().decode(FamilyActivitySelection.self, from: data),
            !(selection.applicationTokens.isEmpty
                && selection.categoryTokens.isEmpty
                && selection.webDomainTokens.isEmpty)
        else {
            // 아직 측정 대상 미선택 → 모니터링 시작 불가 (picker 먼저 띄워야 함)
            resolve(false)
            return
        }

        let totalSeconds = Int(goalSecondsValue)
        var threshold = DateComponents()
        threshold.hour = totalSeconds / 3600
        threshold.minute = (totalSeconds % 3600) / 60
        threshold.second = totalSeconds % 60

        // 선택한 앱/카테고리의 누적 사용시간이 threshold(목표시간)에 도달하면
        // Monitor 익스텐션의 eventDidReachThreshold가 호출됨
        let event = DeviceActivityEvent(
            applications: selection.applicationTokens,
            categories: selection.categoryTokens,
            webDomains: selection.webDomainTokens,
            threshold: threshold
        )

        do {
            center.stopMonitoring([activityName])
            try center.startMonitoring(
                activityName,
                during: schedule,
                events: [DeviceActivityEvent.Name("gromo.goal.threshold"): event]
            )
            resolve(true)
        } catch {
            reject("MONITOR_ERROR", "모니터링 시작 실패: \(error.localizedDescription)", error)
        }
    }

    // 30분 버킷 사용량 모니터링 시작 — 보상 판정(gromo.daily)과 분리된 별도 스케줄.
    // 하루 스케줄(00:00~23:59)에 30·60·90…분 threshold 이벤트를 촘촘히 박아,
    // Monitor 익스텐션이 "도달한 최고 눈금(분)"을 App Group에 기록 → 메인 앱이 읽어 사용량 근사치로 표시.
    // (Report 익스텐션의 App Group 쓰기 차단(원인 3)을 우회하는 정석 경로)
    @objc func startUsageBucketMonitoring(
        _ maxMinutesValue: Double,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        guard #available(iOS 16.0, *) else {
            resolve(false)
            return
        }

        let center = DeviceActivityCenter()
        let activityName = DeviceActivityName("gromo.usage.buckets")

        var startComponents = DateComponents()
        startComponents.hour = 0
        startComponents.minute = 0

        var endComponents = DateComponents()
        endComponents.hour = 23
        endComponents.minute = 59

        let schedule = DeviceActivitySchedule(
            intervalStart: startComponents,
            intervalEnd: endComponents,
            repeats: true
        )

        // 측정 대상(picker selection) 로드 — 토큰이 있어야 threshold가 발화함.
        let defaults = UserDefaults(suiteName: "group.com.oneorthree.gromo")
        guard
            let data = defaults?.data(forKey: "gromo:goal:selection"),
            let selection = try? JSONDecoder().decode(FamilyActivitySelection.self, from: data),
            !(selection.applicationTokens.isEmpty
                && selection.categoryTokens.isEmpty
                && selection.webDomainTokens.isEmpty)
        else {
            resolve(false)
            return
        }

        // 30분 간격 눈금(30,60,…). 이벤트 과다(RAM 6MB)·경계 뭉갬 방지로 720분(12h·24개)로 상한.
        let step = 30
        let maxMinutes = min(max(Int(maxMinutesValue), step), 720)
        var events: [DeviceActivityEvent.Name: DeviceActivityEvent] = [:]
        var m = step
        while m <= maxMinutes {
            var threshold = DateComponents()
            threshold.hour = m / 60
            threshold.minute = m % 60
            events[DeviceActivityEvent.Name("gromo.usage.bucket.\(m)")] = DeviceActivityEvent(
                applications: selection.applicationTokens,
                categories: selection.categoryTokens,
                webDomains: selection.webDomainTokens,
                threshold: threshold
            )
            m += step
        }

        do {
            center.stopMonitoring([activityName])
            try center.startMonitoring(activityName, during: schedule, events: events)
            resolve(true)
        } catch {
            reject("MONITOR_ERROR", "버킷 모니터링 시작 실패: \(error.localizedDescription)", error)
        }
    }

    // 오늘의 사용량 버킷(분) 조회 — Monitor가 기록한 "도달 최고 눈금".
    // 날짜가 오늘이 아니면(자정 넘어 아직 리셋 전 등) 0으로 취급.
    @objc func getTodayUsageBucketMinutes(
        _ resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        let defaults = UserDefaults(suiteName: "group.com.oneorthree.gromo")
        let mins = defaults?.integer(forKey: "gromo:screentime:usageBucketMinutes") ?? 0
        let date = defaults?.string(forKey: "gromo:screentime:usageBucketDate")
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        let today = formatter.string(from: Date())
        resolve(date == today ? mins : 0)
    }

    // 어제 날짜의 스크린 타임 목표 달성 결과를 App Group에서 읽어 반환
    // 반환값: "success" | "fail" | nil (어제 결과 없음 — 첫 설치 또는 모니터링 미실행)
    @objc func getYesterdayResult(
        _ resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        let sharedDefaults = UserDefaults(suiteName: "group.com.oneorthree.gromo")

        let calendar = Calendar.current
        guard let yesterday = calendar.date(byAdding: .day, value: -1, to: Date()) else {
            resolve(nil)
            return
        }

        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        let yesterdayStr = formatter.string(from: yesterday)

        let lastResultDate = sharedDefaults?.string(forKey: "gromo:screentime:lastResultDate") ?? ""
        let lastResult = sharedDefaults?.string(forKey: "gromo:screentime:lastResult") ?? ""

        if lastResultDate == yesterdayStr {
            resolve(lastResult)
        } else {
            resolve(nil)
        }
    }

    // [테스트] FamilyActivityPicker를 띄워 "측정에 포함할 앱/카테고리"를 선택받음
    // 목적: picker 동선 확인 + 선택 결과를 App Group에 저장
    // 반환값: { applications, categories, webDomains } (각 선택 개수) | nil(취소)
    @objc func presentAppPicker(
        _ resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        guard #available(iOS 16.0, *) else {
            reject("UNAVAILABLE", "iOS 16.0 이상에서만 사용 가능합니다.", nil)
            return
        }
        // UI 표시는 반드시 메인 스레드에서
        DispatchQueue.main.async {
            guard let top = ScreenTimeModule.topViewController() else {
                reject("NO_VC", "표시할 화면을 찾을 수 없습니다.", nil)
                return
            }

            let pickerView = GoalAppPickerView(
                onDone: { selection in
                    // 선택 결과를 App Group "대기(pending)" 키에 저장 (FamilyActivitySelection은 Codable)
                    // 활성 적용은 promoteSelection()에서 다음날 승격 시 처리
                    let defaults = UserDefaults(suiteName: "group.com.oneorthree.gromo")
                    if let data = try? JSONEncoder().encode(selection) {
                        defaults?.set(data, forKey: "gromo:goal:selectionPending")
                    }
                    top.dismiss(animated: true)
                    resolve([
                        "applications": selection.applicationTokens.count,
                        "categories": selection.categoryTokens.count,
                        "webDomains": selection.webDomainTokens.count
                    ])
                },
                onCancel: {
                    top.dismiss(animated: true)
                    resolve(nil)
                }
            )

            let host = UIHostingController(rootView: pickerView)
            top.present(host, animated: true)
        }
    }

    // 대기(pending) 측정 대상을 활성(active)으로 승격
    // 다음날 적용 시점(앱 실행 시 날짜 비교 후)에 JS에서 호출
    // 반환값: true(승격함) | false(대기 없음)
    @objc func promoteSelection(
        _ resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        let defaults = UserDefaults(suiteName: "group.com.oneorthree.gromo")
        if let data = defaults?.data(forKey: "gromo:goal:selectionPending") {
            defaults?.set(data, forKey: "gromo:goal:selection")
            defaults?.removeObject(forKey: "gromo:goal:selectionPending")
            resolve(true)
        } else {
            resolve(false)
        }
    }

    // MARK: - 집중 세션 허용앱 / 실드 (GROMO-553)
    //
    // "허용앱" = 집중 세션 중에도 쓸 수 있는 앱. 세션 시작 시 허용앱을 제외한
    // 모든 앱에 shield를 걸고(OS가 가림막 표시), 정지 시 해제한다.
    // 측정 대상(gromo:goal:selection)과 별개 키로 관리하며 pending 승격 없이 즉시 적용.

    // 허용앱 선택 picker — 선택 결과를 gromo:focus:allowedSelection에 바로 저장.
    // 반환값: { applications, categories, webDomains } (각 선택 개수) | nil(취소)
    // ⚠️ shield의 예외(.all(except:))는 개별 앱 토큰만 지원 — 카테고리 선택은 개수만 저장되고 차단 예외론 무시됨.
    @objc func presentAllowedAppPicker(
        _ resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        guard #available(iOS 16.0, *) else {
            reject("UNAVAILABLE", "iOS 16.0 이상에서만 사용 가능합니다.", nil)
            return
        }
        DispatchQueue.main.async {
            guard let top = ScreenTimeModule.topViewController() else {
                reject("NO_VC", "표시할 화면을 찾을 수 없습니다.", nil)
                return
            }

            let pickerView = GoalAppPickerView(
                title: "집중 중 허용 앱",
                onDone: { selection in
                    let defaults = UserDefaults(suiteName: "group.com.oneorthree.gromo")
                    if let data = try? JSONEncoder().encode(selection) {
                        defaults?.set(data, forKey: "gromo:focus:allowedSelection")
                    }
                    top.dismiss(animated: true)
                    resolve([
                        "applications": selection.applicationTokens.count,
                        "categories": selection.categoryTokens.count,
                        "webDomains": selection.webDomainTokens.count
                    ])
                },
                onCancel: {
                    top.dismiss(animated: true)
                    resolve(nil)
                }
            )

            let host = UIHostingController(rootView: pickerView)
            top.present(host, animated: true)
        }
    }

    // 저장된 허용앱 선택 개수 조회 — 메뉴/드로어 표시용.
    // 반환값: { applications, categories, webDomains } | nil(미설정)
    @objc func getAllowedSelectionCounts(
        _ resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        guard #available(iOS 16.0, *) else {
            resolve(nil)
            return
        }
        let defaults = UserDefaults(suiteName: "group.com.oneorthree.gromo")
        guard
            let data = defaults?.data(forKey: "gromo:focus:allowedSelection"),
            let selection = try? JSONDecoder().decode(FamilyActivitySelection.self, from: data)
        else {
            resolve(nil)
            return
        }
        resolve([
            "applications": selection.applicationTokens.count,
            "categories": selection.categoryTokens.count,
            "webDomains": selection.webDomainTokens.count
        ])
    }

    // 집중 세션 실드 켜기 — 허용앱(개별 앱 토큰)을 제외한 모든 앱/웹을 차단.
    // 허용앱 미설정이면 예외 없이 전부 차단(집중의 기본 동작).
    // subjectName은 커스텀 가림막(ShieldConfiguration 익스텐션)이 문구에 쓰도록 App Group에 기록.
    @objc func startFocusShield(
        _ subjectName: String,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        guard #available(iOS 16.0, *) else {
            resolve(false)
            return
        }
        guard AuthorizationCenter.shared.authorizationStatus == .approved else {
            resolve(false)
            return
        }

        let defaults = UserDefaults(suiteName: "group.com.oneorthree.gromo")
        defaults?.set(subjectName, forKey: "gromo:focus:shieldSubject")

        var allowedApps = Set<ApplicationToken>()
        var allowedWebDomains = Set<WebDomainToken>()
        if let data = defaults?.data(forKey: "gromo:focus:allowedSelection"),
           let selection = try? JSONDecoder().decode(FamilyActivitySelection.self, from: data) {
            allowedApps = selection.applicationTokens
            allowedWebDomains = selection.webDomainTokens
        }

        let store = ManagedSettingsStore(named: ManagedSettingsStore.Name("gromoFocus"))
        store.shield.applicationCategories = .all(except: allowedApps)
        store.shield.webDomainCategories = .all(except: allowedWebDomains)
        resolve(true)
    }

    // 집중 세션 실드 끄기 — 세션 정지/앱 재실행(고아 세션 정리) 시 호출.
    @objc func stopFocusShield(
        _ resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        guard #available(iOS 16.0, *) else {
            resolve(nil)
            return
        }
        let store = ManagedSettingsStore(named: ManagedSettingsStore.Name("gromoFocus"))
        store.clearAllSettings()
        resolve(nil)
    }

    // MARK: - 집중 세션 Live Activity (GROMO-553)

    // 캐릭터 스냅샷(base64 PNG)을 App Group 컨테이너에 저장.
    // Live Activity(Widget)와 가림막(ShieldConfiguration)이 이 파일을 읽어 표시한다.
    @objc func saveCharacterSnapshot(
        _ base64: String,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        guard
            let data = Data(base64Encoded: base64),
            let container = FileManager.default.containerURL(
                forSecurityApplicationGroupIdentifier: "group.com.oneorthree.gromo"
            )
        else {
            resolve(false)
            return
        }
        do {
            try data.write(to: container.appendingPathComponent("focusCharacter.png"))
            resolve(true)
        } catch {
            resolve(false)
        }
    }

    // 집중 Live Activity 시작 — 타이머는 위젯의 Text(timerInterval:)가 자체 갱신하므로
    // 시작 시각만 넘기면 업데이트가 필요 없다. 실패해도 세션 진행엔 영향 없음(false 반환).
    @objc func startFocusActivity(
        _ subjectName: String,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        guard #available(iOS 16.2, *) else {
            resolve(false)
            return
        }
        Task { @MainActor in
            // 잔여 액티비티 정리 후 시작(중복 방지)
            for activity in Activity<GromoFocusAttributes>.activities {
                await activity.end(nil, dismissalPolicy: .immediate)
            }
            guard ActivityAuthorizationInfo().areActivitiesEnabled else {
                resolve(false)
                return
            }
            do {
                _ = try Activity.request(
                    attributes: GromoFocusAttributes(subjectName: subjectName),
                    content: .init(
                        state: GromoFocusAttributes.ContentState(startedAt: Date()),
                        staleDate: nil
                    )
                )
                resolve(true)
            } catch {
                resolve(false)
            }
        }
    }

    // 집중 Live Activity 종료 — 세션 정지/화면 이탈 시 호출(멱등).
    @objc func endFocusActivity(
        _ resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        guard #available(iOS 16.2, *) else {
            resolve(nil)
            return
        }
        Task {
            for activity in Activity<GromoFocusAttributes>.activities {
                await activity.end(nil, dismissalPolicy: .immediate)
            }
            resolve(nil)
        }
    }

    // 현재 화면 최상단 ViewController 찾기 (picker를 그 위에 present)
    private static func topViewController() -> UIViewController? {
        let keyWindow = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap { $0.windows }
            .first { $0.isKeyWindow }
        var top = keyWindow?.rootViewController
        while let presented = top?.presentedViewController {
            top = presented
        }
        return top
    }
}

// 집중 세션 Live Activity 속성 — ⚠️ ios/Widget/WidgetLiveActivity.swift 정의와
// 반드시 동일하게 유지할 것(타입명·필드 인코딩으로 매칭됨).
struct GromoFocusAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        // 타이머 기준 시각 — 위젯의 Text(timerInterval:)가 OS에서 자체 갱신
        var startedAt: Date
    }

    // 세션 과목명
    var subjectName: String
}

// FamilyActivityPicker를 감싸는 SwiftUI 뷰
// 상단에 "취소 / 완료" 버튼을 달아 시트로 표시. title로 용도(측정 대상/허용앱) 구분.
@available(iOS 16.0, *)
struct GoalAppPickerView: View {
    @State private var selection = FamilyActivitySelection()
    var title: String = "측정 대상 선택"
    let onDone: (FamilyActivitySelection) -> Void
    let onCancel: () -> Void

    var body: some View {
        NavigationView {
            FamilyActivityPicker(selection: $selection)
                .navigationTitle(title)
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("취소") { onCancel() }
                    }
                    ToolbarItem(placement: .confirmationAction) {
                        Button("완료") { onDone(selection) }
                    }
                }
        }
    }
}
