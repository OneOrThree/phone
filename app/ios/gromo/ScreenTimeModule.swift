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

        let totalSeconds = Int(goalSecondsValue)
        var threshold = DateComponents()
        threshold.hour = totalSeconds / 3600
        threshold.minute = (totalSeconds % 3600) / 60
        threshold.second = totalSeconds % 60

        let event = DeviceActivityEvent(
            applications: [],
            categories: [],
            webDomains: [],
            threshold: threshold
        )

        do {
            center.stopMonitoring([activityName])
            try center.startMonitoring(
                activityName,
                during: schedule,
                events: [DeviceActivityEvent.Name("gromo.goal.threshold"): event]
            )
            resolve(nil)
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
}
