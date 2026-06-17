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
import FamilyControls  // 스크린 타임 권한 요청에 필요한 Apple 프레임워크
import DeviceActivity  // DeviceActivityCenter, DeviceActivitySchedule, DeviceActivityEvent
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

// FamilyActivityPicker를 감싸는 SwiftUI 뷰
// 상단에 "취소 / 완료" 버튼을 달아 시트로 표시
@available(iOS 16.0, *)
struct GoalAppPickerView: View {
    @State private var selection = FamilyActivitySelection()
    let onDone: (FamilyActivitySelection) -> Void
    let onCancel: () -> Void

    var body: some View {
        NavigationView {
            FamilyActivityPicker(selection: $selection)
                .navigationTitle("측정 대상 선택")
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
