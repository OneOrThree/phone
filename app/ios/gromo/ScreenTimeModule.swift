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
import WidgetKit       // 캐릭터 스냅샷 변경 시 홈 위젯 타임라인 새로고침

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
            } catch FamilyControlsError.authorizationCanceled {
                // 사용자가 권한 시트에서 '허용 안함'(취소)을 누른 경우 — 에러가 아니라 '거부'로 처리.
                // resolve(false): JS가 실패 알림 없이 권한 거부 분기 화면으로 넘어간다.
                resolve(false)
            } catch {
                // 엔타이틀먼트/프로파일 등 실제 오류만 reject로 노출(진단용).
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
        case .approvedWithDataAccess:
            // iOS 26+ 신규 케이스 — 데이터 접근까지 승인된 상태. JS 계약(3종)상 "approved"로 매핑
            resolve("approved")
        case .denied:
            resolve("denied")
        case .notDetermined:
            resolve("notDetermined")
        @unknown default:
            resolve("notDetermined")
        }
    }

    // 기기(시스템) 다크모드 설정 조회 — "dark" | "light" 반환 (GROMO-934)
    // 앱은 Info.plist UIUserInterfaceStyle=Light로 라이트 고정이라 RN Appearance가 항상 light지만,
    // 시스템이 띄우는 스크린타임 권한창은 기기 설정을 따른다. 권한창 복제본(리허설 안내)의
    // 외형을 실제 창과 맞추기 위해 앱 오버라이드의 영향을 받지 않는 UIScreen 트레이트에서 읽는다.
    @objc func getSystemColorScheme(
        _ resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        DispatchQueue.main.async {
            let style = UIScreen.main.traitCollection.userInterfaceStyle
            resolve(style == .dark ? "dark" : "light")
        }
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

    // (GROMO-942) 목표 달성 판정을 버킷 사용시간으로 일원화 — 별도 목표 모니터(gromo.daily)를
    // 폐지한다. 기존 설치에 남아있는 gromo.daily 등록을 한 번 정리하는 용도(앱이 마이그레이션으로
    // 1회 호출). 새 등록은 하지 않는다.
    @objc func stopGoalMonitoring(
        _ resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        guard #available(iOS 16.0, *) else {
            resolve(true)
            return
        }
        DeviceActivityCenter().stopMonitoring([DeviceActivityName("gromo.daily")])
        resolve(true)
    }

    // 버킷 디버그 이벤트 로그(개발 확인용, GROMO-931) — Monitor 익스텐션과 같은 App Group 키에
    // 최근 50줄만 유지. 등록/실패 시점을 남겨 익스텐션 콜백 순서와 대조할 수 있게 한다.
    // Release에선 no-op — 패널이 dev 빌드 전용이라 볼 수 없는 순수 비용이기 때문(코드리뷰 반영).
    private func appendDebugLog(_ line: String) {
        #if DEBUG
        let defaults = UserDefaults(suiteName: "group.com.oneorthree.gromo")
        let f = DateFormatter()
        f.dateFormat = "MM-dd HH:mm:ss"
        var log = defaults?.stringArray(forKey: "gromo:screentime:debugEventLog") ?? []
        log.append("\(f.string(from: Date())) \(line)")
        if log.count > 50 { log.removeFirst(log.count - 50) }
        defaults?.set(log, forKey: "gromo:screentime:debugEventLog")
        #endif
    }

    // 15분 버킷 사용량 모니터링 시작 — 보상 판정(gromo.daily)과 분리된 별도 스케줄.
    // 하루 스케줄(00:00~23:59)에 15·30·45…분 threshold 이벤트를 촘촘히 박아,
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

        // 기존 모니터를 먼저 중지 — 선택을 비운 경우에도 옛 대상 측정이 계속 남지 않게
        // guard보다 앞에서 수행한다(GROMO-633 리뷰 반영).
        center.stopMonitoring([activityName])

        // 측정 대상(picker selection) 로드 — 토큰이 있어야 threshold가 발화함.
        let defaults = UserDefaults(suiteName: "group.com.oneorthree.gromo")
        guard
            let data = defaults?.data(forKey: "gromo:goal:selection"),
            let selection = try? JSONDecoder().decode(FamilyActivitySelection.self, from: data),
            !(selection.applicationTokens.isEmpty
                && selection.categoryTokens.isEmpty
                && selection.webDomainTokens.isEmpty)
        else {
            appendDebugLog("버킷 재등록 실패 — 측정 대상 없음")
            resolve(false)
            return
        }

        // 15분 간격 눈금(15,30,…) — 서버 전송 버킷 세분화(GROMO-931, 30분→15분).
        // 이벤트 과다(Monitor 익스텐션 RAM 6MB)·경계 뭉갬 방지로 900분(15h·60개)로 상한.
        // 웹 도메인 시간은 브라우저 앱 시간에 이미 포함 — 브라우저를 덮는 선택과 함께 걸면 같은
        // 시간이 두 번 세져 버킷이 실사용량(설정 스크린타임)보다 크게 잡힌다. 목표 threshold와
        // 동일하게 카테고리 선택이 있으면 도메인을 제외하고, 개별 앱만 고른 선택은 도메인을
        // 유지한다(혼합 선택 보존, PR 리뷰 반영).
        let bucketWebDomains = selection.categoryTokens.isEmpty ? selection.webDomainTokens : []
        let step = 15
        let maxMinutes = min(max(Int(maxMinutesValue), step), 900)
        var events: [DeviceActivityEvent.Name: DeviceActivityEvent] = [:]
        var m = step
        while m <= maxMinutes {
            var threshold = DateComponents()
            threshold.hour = m / 60
            threshold.minute = m % 60
            events[DeviceActivityEvent.Name("gromo.usage.bucket.\(m)")] = DeviceActivityEvent(
                applications: selection.applicationTokens,
                categories: selection.categoryTokens,
                webDomains: bucketWebDomains,
                threshold: threshold
            )
            m += step
        }

        // 등록 시각 기록(GROMO-871) — Monitor 익스텐션 오발화 가드의 기준점(goal 등록과 동일 목적).
        // startMonitoring 호출 즉시 콜백이 올 수 있으므로 반드시 호출 '전'에 기록한다(코드리뷰 P1).
        defaults?.set(Date().timeIntervalSince1970, forKey: "gromo:screentime:bucketRegisteredAt")

        // 재등록 베이스라인(GROMO-871 코드리뷰 P2) — 재등록은 iOS 누적 카운트를 리셋하므로 이후
        // 이벤트 눈금은 '등록 이후' 사용량이다. 오늘 이미 기록된 최고 눈금을 베이스로 보관해
        // 익스텐션이 '베이스+눈금'으로 하루 누적을 복원하게 한다(전/후 구간이 겹치지 않아 이중
        // 계산 없음). 이 값도 등록 직후 콜백이 읽으므로 startMonitoring 호출 '전'에 기록한다.
        let dayFormatter = DateFormatter()
        dayFormatter.dateFormat = "yyyy-MM-dd"
        let todayString = dayFormatter.string(from: Date())
        let storedBucketDate = defaults?.string(forKey: "gromo:screentime:usageBucketDate")
        let baseMinutes =
            storedBucketDate == todayString
            ? (defaults?.integer(forKey: "gromo:screentime:usageBucketMinutes") ?? 0) : 0
        defaults?.set(baseMinutes, forKey: "gromo:screentime:bucketBaseMinutes")
        defaults?.set(todayString, forKey: "gromo:screentime:bucketBaseDate")

        do {
            try center.startMonitoring(activityName, during: schedule, events: events)
            appendDebugLog("버킷 모니터 등록 — 눈금 \(step)분·베이스 \(baseMinutes)분")
            resolve(true)
        } catch {
            appendDebugLog("버킷 모니터 등록 실패: \(error.localizedDescription)")
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

    // 어제의 최종 사용량 버킷(분) 조회 — Monitor가 하루 경계에 보존한 전일 눈금(GROMO-633).
    // 메인 앱의 '어제분 마감 업로드'가 마지막 포그라운드 이후 늘어난 사용분까지 반영하는 데 쓴다.
    // 보존 날짜가 어제와 다르면(이틀 이상 미기록 등) 0으로 취급.
    @objc func getYesterdayUsageBucketMinutes(
        _ resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        let defaults = UserDefaults(suiteName: "group.com.oneorthree.gromo")
        guard let yesterday = Calendar.current.date(byAdding: .day, value: -1, to: Date()) else {
            resolve(0)
            return
        }
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        let yesterdayStr = formatter.string(from: yesterday)

        // 보존된 전일 눈금(정상: intervalDidStart/End가 롤오버한 값).
        let prevMins = defaults?.integer(forKey: "gromo:screentime:prevBucketMinutes") ?? 0
        let prevDate = defaults?.string(forKey: "gromo:screentime:prevBucketDate")
        var result = (prevDate == yesterdayStr) ? prevMins : 0

        // 자정 롤오버 콜백(intervalDidStart/End)을 놓쳐 prevBucket으로 아직 안 넘어간 경우 —
        // 오늘 버킷의 날짜가 어제면 그 값이 곧 어제 최종 눈금이다(GROMO-844). 어제분 마감이
        // threshold 콜백의 지연 복구보다 먼저 실행돼도 올바른 값을 읽게 한다.
        let curMins = defaults?.integer(forKey: "gromo:screentime:usageBucketMinutes") ?? 0
        let curDate = defaults?.string(forKey: "gromo:screentime:usageBucketDate")
        if curDate == yesterdayStr {
            result = max(result, curMins)
        }

        resolve(result)
    }

    // 버킷 발화 타임라인 조회 — Monitor 익스텐션이 threshold 발화마다 App Group 키
    // "usageBucketEvents:{yyyy-MM-dd}"(기기 로컬 날짜)에 기록한 [{bucket, firedAt}] 배열을 반환.
    // bucket = 발화 시점의 하루 누적 환산분(단조 증가), firedAt = epoch 초. 기록이 없으면 빈 배열.
    // JS(A4)가 창 경계(A~B시)의 버킷 차로 창 내 사용분을 계산하는 데 쓴다(±15분 눈금 오차).
    // 익스텐션이 오늘+어제 2일만 보존하므로 그 밖의 dayKey는 자연히 빈 배열이 된다.
    @objc func getUsageBucketEvents(
        _ dayKey: String,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        let defaults = UserDefaults(suiteName: "group.com.oneorthree.gromo")
        let events = defaults?.array(forKey: "usageBucketEvents:\(dayKey)") as? [[String: Any]]
        resolve(events ?? [])
    }

    // 사용량 버킷 측정 상태 디버그 조회(개발용, GROMO-931) — App Group 기록 원본을 그대로 반환.
    // 전체 탭 dev 패널이 15분 눈금 동작을 실기기에서 확인하는 용도이며 판정 로직에는 쓰지 않는다.
    @objc func getUsageBucketDebugInfo(
        _ resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        let defaults = UserDefaults(suiteName: "group.com.oneorthree.gromo")
        resolve([
            "bucketMinutes": defaults?.integer(forKey: "gromo:screentime:usageBucketMinutes") ?? 0,
            "bucketDate": defaults?.string(forKey: "gromo:screentime:usageBucketDate") ?? "",
            "baseMinutes": defaults?.integer(forKey: "gromo:screentime:bucketBaseMinutes") ?? 0,
            "baseDate": defaults?.string(forKey: "gromo:screentime:bucketBaseDate") ?? "",
            "registeredAt": defaults?.double(forKey: "gromo:screentime:bucketRegisteredAt") ?? 0,
            "prevBucketMinutes": defaults?.integer(forKey: "gromo:screentime:prevBucketMinutes")
                ?? 0,
            "prevBucketDate": defaults?.string(forKey: "gromo:screentime:prevBucketDate") ?? "",
            // 익스텐션이 자정에 승격+버킷 등록에 성공한 날짜 — 앱 백업 경로의 재등록 스킵 판단용.
            "promotedOkDate": defaults?.string(forKey: "gromo:goal:selectionPromotedOkDate") ?? "",
            "log": defaults?.stringArray(forKey: "gromo:screentime:debugEventLog") ?? [],
        ] as [String: Any])
    }

    // A안(GROMO-942) — 측정 대상 변경을 '다음날 적용'으로 예약. 설정 화면에서 이미 측정 대상이
    // 설정된 상태로 변경 시 호출한다. picker가 저장한 pending 선택은 그대로 두고, 적용 예정일만
    // App Group에 기록해 익스텐션 자정 콜백(promotePendingSelectionIfDue)이 승격 여부를 판단하게
    // 한다. dateString은 'YYYY-MM-DD'(로컬) — 보통 내일. 빈 문자열이면 예약 취소(키 제거).
    @objc func setPendingSelectionApplyDate(
        _ dateString: NSString,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        let defaults = UserDefaults(suiteName: "group.com.oneorthree.gromo")
        let value = dateString as String
        if value.isEmpty {
            defaults?.removeObject(forKey: "gromo:goal:selectionApplyDate")
        } else {
            defaults?.set(value, forKey: "gromo:goal:selectionApplyDate")
        }
        resolve(true)
    }

    // (GROMO-942) getYesterdayResult(어제 목표 달성 네이티브 판정)는 폐지 — 달성은 앱이 버킷
    // 사용시간으로 판정한다.

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

            // 저장된 측정 대상 선택을 미리 불러와 피커에 채운다(재선택 시 기존 체크 유지, GROMO-865).
            // 아직 승격 전인 대기(pending) 선택이 있으면 그게 최신 선택이므로 활성분보다 우선한다.
            let defaults = UserDefaults(suiteName: "group.com.oneorthree.gromo")
            var initialSelection = FamilyActivitySelection()
            if let data = defaults?.data(forKey: "gromo:goal:selectionPending")
                ?? defaults?.data(forKey: "gromo:goal:selection"),
               let saved = try? JSONDecoder().decode(FamilyActivitySelection.self, from: data) {
                initialSelection = saved
            }

            let pickerView = GoalAppPickerView(
                initialSelection: initialSelection,
                onDone: { selection in
                    // 선택 결과를 App Group "대기(pending)" 키에 저장 (FamilyActivitySelection은 Codable)
                    // 활성 적용은 promoteSelection()에서 다음날 승격 시 처리
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
    // 카테고리 통째 선택도 includeEntireCategory:true로 하위 앱 토큰이 채워져 개수·허용 예외에 반영된다(GROMO-664).
    // (단, 선택 시점 '설치된' 멤버 앱 스냅샷 — 이후 새로 깐 앱은 자동 포함 안 됨.)
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

            // 저장된 허용앱 선택을 미리 불러와 피커에 채운다(재선택 시 기존 선택 유지)
            // includeEntireCategory: true — 카테고리 통째 선택 시 하위 개별 앱 토큰까지 selection에
            // 채워져, 개수 카운트(40)와 허용 예외(.all(except:))가 카테고리에도 적용된다 (GROMO-664).
            // includeEntireCategory는 let이라 저장본(옛 false 값)을 그대로 쓰면 플래그가 꺼지므로,
            // 플래그 true 컨테이너에 토큰만 옮겨 담아 항상 보장한다.
            let defaults = UserDefaults(suiteName: "group.com.oneorthree.gromo")
            var initialSelection = FamilyActivitySelection(includeEntireCategory: true)
            if let data = defaults?.data(forKey: "gromo:focus:allowedSelection"),
               let saved = try? JSONDecoder().decode(FamilyActivitySelection.self, from: data) {
                initialSelection.applicationTokens = saved.applicationTokens
                initialSelection.categoryTokens = saved.categoryTokens
                initialSelection.webDomainTokens = saved.webDomainTokens
            }

            let pickerView = GoalAppPickerView(
                title: "집중 중 허용 앱",
                initialSelection: initialSelection,
                maxApplications: 40,
                onDone: { selection in
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

    // 허용앱 관리 화면 — 현재 허용앱 목록(아이콘+이름)을 보여주고, "앱 추가/삭제"로 피커를 띄운다.
    // 완료 시 gromo:focus:allowedSelection에 저장하고 선택 개수를 반환. 취소(스와이프)는 막는다.
    @objc func presentAllowedAppManager(
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

            // 저장된 허용앱 선택을 미리 불러와 목록·피커에 채운다
            // includeEntireCategory: true — 카테고리 통째 선택 시 하위 앱 토큰까지 채워 목록·개수·허용에 반영(GROMO-664).
            // let 필드라 저장본(옛 false)은 토큰만 옮겨 담아 플래그를 보장한다.
            let defaults = UserDefaults(suiteName: "group.com.oneorthree.gromo")
            var initialSelection = FamilyActivitySelection(includeEntireCategory: true)
            if let data = defaults?.data(forKey: "gromo:focus:allowedSelection"),
               let saved = try? JSONDecoder().decode(FamilyActivitySelection.self, from: data) {
                initialSelection.applicationTokens = saved.applicationTokens
                initialSelection.categoryTokens = saved.categoryTokens
                initialSelection.webDomainTokens = saved.webDomainTokens
            }

            let managerView = AllowedAppManagerView(
                initialSelection: initialSelection,
                maxApplications: 40,
                onClose: { selection in
                    if let data = try? JSONEncoder().encode(selection) {
                        defaults?.set(data, forKey: "gromo:focus:allowedSelection")
                    }
                    // ⚠️ dismiss **완료 뒤에** resolve한다. 즉시 풀면 JS가 아직 떠 있는 네이티브 모달
                    //    아래에서 토스트 등장과 2200ms 노출 타이머를 시작해, 사용자는 모달이 사라진 뒤
                    //    토스트가 갑자기 나타나는 데다 실제 노출 시간도 짧아진다(codex 리뷰).
                    top.dismiss(animated: true) {
                        resolve([
                            "applications": selection.applicationTokens.count,
                            "categories": selection.categoryTokens.count,
                            "webDomains": selection.webDomainTokens.count
                        ])
                    }
                }
            )

            let host = UIHostingController(rootView: managerView)
            host.isModalInPresentation = true // 스와이프로 닫으면 promise가 안 풀리므로 완료만 허용
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
        // Apple이 .all() 실드에서 시스템 앱(사파리·메시지·전화·지도 등)을 제외해 사파리가
        // 뚫린다(GROMO-866). 허용앱 토큰이 불투명해 "사파리를 허용앱으로 골랐는지"를 식별할
        // 수 없으므로, 차단 여부는 별도 '사파리·웹 허용' 토글로 유저가 직접 정한다.
        // 전화·메시지 등 나머지 시스템 앱 예외는 안전상 그대로 둔다.
        let allowSafariWeb = defaults?.bool(forKey: "gromo:focus:allowSafariWeb") ?? false
        ScreenTimeModule.applySafariWebBlock(
            to: store,
            allowSafariWeb: allowSafariWeb,
            allowedWebDomains: allowedWebDomains
        )
        resolve(true)
    }

    // 웹 차단 3종(도메인 카테고리 실드·사파리 blockedApplications·웹 콘텐츠 필터)을 토글
    // 값에 맞춰 함께 적용/해제한다 (GROMO-866).
    // 끔(기본) = 차단: 실드와 달리 번들 ID로 직접 지정 가능한 blockedApplications로 사파리를
    // 숨기고, 웹 콘텐츠 필터로 사파리·타 브라우저·인앱 웹뷰의 웹페이지를 시스템 '제한됨'
    // 화면으로 차단한다. 유저 지정 허용 웹도메인은 WebDomain(token:)으로 감싸 콘텐츠 필터
    // 예외(.all(except:), 최대 50개)에도 반영한다 — 필터를 .all()로 걸면 도메인 실드의 예외가
    // 무의미해져 허용 도메인이 실제로는 하나도 안 열린다(PR 282 Codex 리뷰 반영).
    // 단 사파리 앱 자체는 blockedApplications로 숨기므로 허용 도메인은 타 브라우저·웹뷰에서 열린다.
    // 켬 = 허용: 셋 다 풀어야 실제로 웹이 열린다 — webDomainCategories 실드가 남아 있으면
    // 사파리만 보이고 웹페이지는 여전히 가려진다(PR 282 리뷰 반영).
    // 해제는 stopFocusShield의 clearAllSettings()도 커버한다.
    @available(iOS 16.0, *)
    private static func applySafariWebBlock(
        to store: ManagedSettingsStore,
        allowSafariWeb: Bool,
        allowedWebDomains: Set<WebDomainToken>
    ) {
        if allowSafariWeb {
            store.shield.webDomainCategories = nil
            store.application.blockedApplications = nil
            store.webContent.blockedByFilter = nil
        } else {
            store.shield.webDomainCategories = .all(except: allowedWebDomains)
            store.application.blockedApplications = [
                Application(bundleIdentifier: "com.apple.mobilesafari")
            ]
            // 콘텐츠 필터 예외는 Apple 한도 50개 — 초과분을 그대로 넘기면 필터 정책이 무효화될 수
            // 있어 50개까지만 반영한다(PR 291 리뷰 반영). 피커가 도메인 수를 제한하지 않아 방어가
            // 필요하다(Set이라 초과 시 어느 50개가 남는지는 비결정 — 50개 초과 선택 자체가 예외적).
            let filterExceptions = Set(allowedWebDomains.prefix(50).map { WebDomain(token: $0) })
            store.webContent.blockedByFilter = .all(except: filterExceptions)
        }
    }

    // 집중 중 사파리·웹 허용 여부 저장 — 허용앱 화면 토글(GROMO-866).
    // 실드가 걸려 있으면(집중 세션 중) 즉시 반영한다. 세션 밖에선 차단을 걸면 안 되므로
    // 세션 시작 시에만 설정되는 shield.applicationCategories 유무로 판별한다.
    @objc func setFocusAllowSafariWeb(
        _ allowed: Bool,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        let defaults = UserDefaults(suiteName: "group.com.oneorthree.gromo")
        defaults?.set(allowed, forKey: "gromo:focus:allowSafariWeb")
        if #available(iOS 16.0, *) {
            let store = ManagedSettingsStore(named: ManagedSettingsStore.Name("gromoFocus"))
            if store.shield.applicationCategories != nil {
                // 라이브 반영에도 도메인 카테고리 실드의 예외(허용 웹도메인)가 필요 —
                // startFocusShield와 동일한 소스(gromo:focus:allowedSelection)에서 로드한다.
                var allowedWebDomains = Set<WebDomainToken>()
                if let data = defaults?.data(forKey: "gromo:focus:allowedSelection"),
                   let selection = try? JSONDecoder().decode(FamilyActivitySelection.self, from: data) {
                    allowedWebDomains = selection.webDomainTokens
                }
                ScreenTimeModule.applySafariWebBlock(
                    to: store,
                    allowSafariWeb: allowed,
                    allowedWebDomains: allowedWebDomains
                )
            }
        }
        resolve(nil)
    }

    // 저장된 사파리·웹 허용 여부 조회 (미설정 = false = 차단이 기본).
    @objc func getFocusAllowSafariWeb(
        _ resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        let defaults = UserDefaults(suiteName: "group.com.oneorthree.gromo")
        resolve(defaults?.bool(forKey: "gromo:focus:allowSafariWeb") ?? false)
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
        // 캐릭터 스냅샷도 제거 — 남겨두면 다음 세션 시작 후 새 스냅샷 저장 전(~2초)까지
        // 가림막에 직전 세션의 캐릭터가 노출된다. 파일이 없으면 가림막은 아이콘 없이 뜬다.
        if let container = FileManager.default.containerURL(
            forSecurityApplicationGroupIdentifier: "group.com.oneorthree.gromo"
        ) {
            try? FileManager.default.removeItem(
                at: container.appendingPathComponent("focusCharacter.png")
            )
        }
        resolve(nil)
    }

    // MARK: - 집중 세션 Live Activity (GROMO-553)

    // Live Activity 시작/종료 직렬화 체인 — 연속 호출(빠른 과목 재전환 등)이 '기존 종료 await'
    // 지점에서 겹치면 Activity가 두 개 생기므로, 항상 앞 작업이 끝난 뒤 실행한다.
    // 읽기/쓰기는 RN 모듈의 직렬 메서드 큐에서만 일어나 동시 접근이 없다.
    private static var liveActivityChain: Task<Void, Never>?

    // 캐릭터 스냅샷(base64 PNG)을 App Group 컨테이너에 저장.
    // Live Activity(Widget)와 가림막(ShieldConfiguration)이 이 파일을 읽어 표시한다.
    // 익스텐션 메모리 예산이 빡빡하므로 저장 전에 최대 256px로 다운스케일한다.
    //
    // GROMO-1199: 다운스케일 전에 투명 여백을 잘라 실제 비율로 정규화한다.
    // 캡처 원본은 정사각 박스(CharacterImage: size×size + contain)라 비정사각 캐릭터
    // (누끼는 물론 309×340인 기본 마스코트도)는 여백이 같이 구워진다. 가림막은 아이콘을
    // 후처리 없이 그대로 OS에 넘기므로, 여백이 남으면 아이콘 자리를 여백이 차지해
    // 캐릭터만 작게 보였다. 원천에서 잘라 두면 가림막·Live Activity가 모두 해결되고,
    // 256px 예산도 여백이 아니라 캐릭터에 쓰여 더 선명해진다.
    @objc func saveCharacterSnapshot(
        _ base64: String,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        guard
            let data = Data(base64Encoded: base64),
            let image = UIImage(data: data),
            let container = FileManager.default.containerURL(
                forSecurityApplicationGroupIdentifier: "group.com.oneorthree.gromo"
            )
        else {
            resolve(false)
            return
        }

        let trimmed = trimmingTransparentEdges(image)

        // 긴 변 256px 초과 시 축소(스케일 1로 렌더해 @3x 부풀림 방지)
        let maxSide: CGFloat = 256
        let longest = max(trimmed.size.width, trimmed.size.height)
        var output = trimmed
        if longest > maxSide, longest > 0 {
            let ratio = maxSide / longest
            let newSize = CGSize(
                width: trimmed.size.width * ratio,
                height: trimmed.size.height * ratio
            )
            let format = UIGraphicsImageRendererFormat()
            format.scale = 1
            output = UIGraphicsImageRenderer(size: newSize, format: format).image { _ in
                trimmed.draw(in: CGRect(origin: .zero, size: newSize))
            }
        }

        guard let png = output.pngData() else {
            resolve(false)
            return
        }
        do {
            try png.write(to: container.appendingPathComponent("focusCharacter.png"))
            // 스냅샷 파일이 바뀌었으니 홈 위젯 타임라인을 새로고침해 새 캐릭터를 즉시 반영한다.
            // Live Activity·가림막(실드)은 다음 표시 때 파일을 다시 읽으므로 추가 호출이 필요 없다.
            WidgetCenter.shared.reloadAllTimelines()
            resolve(true)
        } catch {
            resolve(false)
        }
    }

    // 집중 Live Activity 시작 — 타이머는 위젯의 Text(timerInterval:)가 자체 갱신하므로
    // 시작 시각만 넘기면 업데이트가 필요 없다. 실패해도 세션 진행엔 영향 없음(false 반환).
    // otherSubjectsJson: [{"name","seconds","color"}] — 잠금화면의 다른 과목 집중 시간 표시용.
    @objc func startFocusActivity(
        _ subjectName: String,
        otherSubjectsJson: String,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        guard #available(iOS 16.2, *) else {
            reject("OLD_OS", "iOS 16.2 이상에서만 Live Activity를 쓸 수 있어요.", nil)
            return
        }
        var others: [GromoFocusAttributes.OtherSubject] = []
        if let data = otherSubjectsJson.data(using: .utf8),
           let parsed = try? JSONDecoder().decode([GromoFocusAttributes.OtherSubject].self, from: data) {
            others = parsed
        }
        let prior = ScreenTimeModule.liveActivityChain
        ScreenTimeModule.liveActivityChain = Task { @MainActor in
            await prior?.value // 앞선 시작/종료 완료 대기 — await 교차로 인한 중복 생성 방지
            // 잔여 액티비티 정리 후 시작(중복 방지)
            for activity in Activity<GromoFocusAttributes>.activities {
                await activity.end(nil, dismissalPolicy: .immediate)
            }
            guard ActivityAuthorizationInfo().areActivitiesEnabled else {
                reject(
                    "ACTIVITIES_DISABLED",
                    "실시간 활동이 꺼져 있어요. 설정 > gromo > 실시간 활동을 켜주세요.",
                    nil
                )
                return
            }
            do {
                _ = try Activity.request(
                    attributes: GromoFocusAttributes(subjectName: subjectName, otherSubjects: others),
                    content: .init(
                        state: GromoFocusAttributes.ContentState(startedAt: Date()),
                        staleDate: nil
                    )
                )
                resolve(true)
            } catch {
                reject("REQUEST_FAILED", "Live Activity 시작 실패: \(error.localizedDescription)", error)
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
        let prior = ScreenTimeModule.liveActivityChain
        ScreenTimeModule.liveActivityChain = Task { @MainActor in
            await prior?.value // 진행 중인 시작 완료 대기 — 시작 전에 종료가 스치면 Activity가 남는다
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

    // 다른 과목의 누적 집중 시간(잠금화면 표시용) — 세션 중엔 현재 과목만 증가하므로
    // 시작 시점 스냅샷으로 고정해도 항상 정확하다.
    struct OtherSubject: Codable, Hashable {
        var name: String
        var seconds: Int
        var color: String // hex 문자열(#RRGGBB)
    }

    // 세션 과목명
    var subjectName: String
    // 현재 과목을 제외한 나머지 과목들의 누적 집중 시간
    var otherSubjects: [OtherSubject]
}

// FamilyActivityPicker를 감싸는 SwiftUI 뷰
// 상단에 "취소 / 완료" 버튼을 달아 시트로 표시. title로 용도(측정 대상/허용앱) 구분.
@available(iOS 16.0, *)
struct GoalAppPickerView: View {
    @State private var selection: FamilyActivitySelection
    @State private var showLimitAlert = false
    @State private var lastAppCount: Int
    private let title: String
    private let maxApplications: Int?  // nil = 개수 제한 없음(측정 대상 선택). 허용앱은 40.
    private let onDone: (FamilyActivitySelection) -> Void
    private let onCancel: () -> Void

    // initialSelection으로 기존 선택을 미리 채운다(허용앱 재선택 시 유지). 기본값은 빈 선택.
    init(
        title: String = "측정 대상 선택",
        initialSelection: FamilyActivitySelection = FamilyActivitySelection(),
        maxApplications: Int? = nil,
        onDone: @escaping (FamilyActivitySelection) -> Void,
        onCancel: @escaping () -> Void
    ) {
        self.title = title
        self.maxApplications = maxApplications
        self._selection = State(initialValue: initialSelection)
        self._lastAppCount = State(initialValue: initialSelection.applicationTokens.count)
        self.onDone = onDone
        self.onCancel = onCancel
    }

    private var appCount: Int { selection.applicationTokens.count }

    // 초과 판정 — includeEntireCategory:true 덕분에 카테고리 선택 시 하위 앱이 applicationTokens에
    // 채워지므로, 개별 앱이든 카테고리 확장분이든 applicationTokens 개수만으로 40 초과를 판정한다 (GROMO-664).
    private var isOverLimit: Bool {
        guard let max = maxApplications else { return false }
        return appCount > max
    }

    var body: some View {
        NavigationView {
            FamilyActivityPicker(selection: $selection)
                .navigationTitle(maxApplications == nil ? title : "")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("취소") { onCancel() }
                    }
                    // 제한이 있는 허용앱 피커만 제목 아래 n/40 카운터 표시(초과 시 빨강)
                    if let max = maxApplications {
                        ToolbarItem(placement: .principal) {
                            VStack(spacing: 1) {
                                Text(title).font(.headline)
                                Text("\(appCount)/\(max)")
                                    .font(.caption)
                                    .foregroundColor(appCount > max ? .red : .secondary)
                            }
                        }
                    }
                    ToolbarItem(placement: .confirmationAction) {
                        Button("완료") {
                            if isOverLimit { showLimitAlert = true } else { onDone(selection) }
                        }
                    }
                }
                // 앱(개별+카테고리 확장분)이 늘어나 40을 넘는 순간 경고(줄이는 중엔 안 띄움).
                // 카테고리 선택도 includeEntireCategory:true로 applicationTokens에 반영되므로 여기서 함께 처리된다.
                .onChange(of: selection.applicationTokens) { apps in
                    if let max = maxApplications, apps.count > max, apps.count > lastAppCount {
                        showLimitAlert = true
                    }
                    lastAppCount = apps.count
                }
                .alert("\(maxApplications ?? 40)개까지만 고를 수 있어요", isPresented: $showLimitAlert) {
                    Button("확인", role: .cancel) {}
                } message: {
                    Text("허용앱은 최대 \(maxApplications ?? 40)개까지예요. 카테고리를 고르면 그 안의 앱들도 개수에 포함돼요. 조금 줄여주세요.")
                }
        }
    }
}

// 허용앱 관리 화면 — 현재 허용앱을 아이콘+이름으로 나열하고(Label(token), opaque 토큰이라
// 네이티브로만 그릴 수 있음), "앱 추가/삭제"로 캡 피커(GoalAppPickerView)를 시트로 띄운다.
// 완료 시 최종 선택을 onClose로 넘긴다(추가/삭제 모두 피커에서 처리).
@available(iOS 16.0, *)
struct AllowedAppManagerView: View {
    @State private var selection: FamilyActivitySelection
    @State private var showPicker = false
    private let maxApplications: Int
    private let onClose: (FamilyActivitySelection) -> Void

    init(
        initialSelection: FamilyActivitySelection,
        maxApplications: Int = 40,
        onClose: @escaping (FamilyActivitySelection) -> Void
    ) {
        self._selection = State(initialValue: initialSelection)
        self.maxApplications = maxApplications
        self.onClose = onClose
    }

    private var apps: [ApplicationToken] { Array(selection.applicationTokens) }

    var body: some View {
        NavigationView {
            List {
                Section {
                    if apps.isEmpty {
                        Text("아직 허용한 앱이 없어요. 오른쪽 위 + 버튼으로 추가하세요.")
                            .foregroundColor(.secondary)
                    } else {
                        // Label(token) — OS가 아이콘+이름을 프라이버시 보호 형태로 렌더(값은 못 읽음)
                        ForEach(apps, id: \.self) { token in
                            Label(token)
                        }
                    }
                } header: {
                    Text("허용앱 \(selection.applicationTokens.count)/\(maxApplications)")
                } footer: {
                    Text("집중 중에도 이 앱들은 쓸 수 있어요. 최대 \(maxApplications)개까지 추가할 수 있어요.")
                }
            }
            .navigationTitle("집중 중 허용 앱")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("완료") { onClose(selection) }
                }
                // 우상단 + — 앱 추가/삭제 피커 열기
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button {
                        showPicker = true
                    } label: {
                        Image(systemName: "plus")
                    }
                }
            }
            .sheet(isPresented: $showPicker) {
                GoalAppPickerView(
                    title: "허용앱 추가/삭제",
                    initialSelection: selection,
                    maxApplications: maxApplications,
                    onDone: { newSel in
                        selection = newSel
                        showPicker = false
                    },
                    onCancel: { showPicker = false }
                )
            }
        }
    }
}
