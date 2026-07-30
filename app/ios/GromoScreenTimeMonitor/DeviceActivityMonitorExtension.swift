import DeviceActivity
import FamilyControls
import Foundation

class DeviceActivityMonitorExtension: DeviceActivityMonitor {

    private let sharedDefaults = UserDefaults(suiteName: "group.com.oneorthree.gromo")

    private var todayString: String {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        return f.string(from: Date())
    }

    // 버킷 디버그 이벤트 로그(개발 확인용, GROMO-931) — 콜백이 언제 무엇을 기록/스킵했는지
    // App Group에 최근 50줄만 남긴다. dev 패널이 표시하며 판정 로직에는 쓰지 않는다.
    // Release에선 no-op — 패널이 dev 빌드 전용이라 볼 수 없고, 메모리 제약(6MB)이 빡빡한
    // 익스텐션에 이벤트마다 배열 읽기·쓰기 비용만 얹기 때문(코드리뷰 반영).
    private func appendDebugLog(_ line: String) {
        #if DEBUG
        let f = DateFormatter()
        f.dateFormat = "MM-dd HH:mm:ss"
        var log = sharedDefaults?.stringArray(forKey: "gromo:screentime:debugEventLog") ?? []
        log.append("\(f.string(from: Date())) \(line)")
        if log.count > 50 { log.removeFirst(log.count - 50) }
        sharedDefaults?.set(log, forKey: "gromo:screentime:debugEventLog")
        #endif
    }

    // A안(GROMO-942) — 측정 대상 변경 '다음날 적용'. picker는 pending에만 저장하고, 실제 활성
    // 승격 + 버킷 모니터 재등록을 자정 intervalDidStart(앱 없이 돎)에서 수행해 0시에 칼같이
    // 전환한다(당일 혼합 제거). "익스텐션 콜백 안 startMonitoring 재등록"은 스파이크로 실기기
    // 검증 완료 — 03-screentime 11절.
    //  · 승격 조건: pending 존재 + 적용일(applyDate) 도래(없으면 다음 자정이 곧 적용일이라 통과)
    //  · 목표 달성 판정은 버킷 사용시간으로 일원화(GROMO-942, gromo.daily 폐지)라 여기서 버킷만
    //    새 선택으로 재등록하면 판정도 자연히 새 대상 기준이 된다.
    private func promotePendingSelectionIfDue() {
        guard let pendingData = sharedDefaults?.data(forKey: "gromo:goal:selectionPending") else {
            return
        }
        let applyDate = sharedDefaults?.string(forKey: "gromo:goal:selectionApplyDate")
        if let applyDate, applyDate > todayString { return } // 아직 적용일 전

        guard let selection = try? JSONDecoder().decode(
                FamilyActivitySelection.self, from: pendingData),
              !(selection.applicationTokens.isEmpty
                && selection.categoryTokens.isEmpty
                && selection.webDomainTokens.isEmpty)
        else {
            // 빈/손상 pending은 정리만
            sharedDefaults?.removeObject(forKey: "gromo:goal:selectionPending")
            sharedDefaults?.removeObject(forKey: "gromo:goal:selectionApplyDate")
            appendDebugLog("A안 승격 스킵 — pending 비었음/손상")
            return
        }

        // 승격: 활성 = pending, pending·적용일(App Group) 제거. JS쪽 selectionApplyDate 마커는
        // 앱이 목표 모니터 재등록·정리를 처리하도록 그대로 둔다.
        sharedDefaults?.set(pendingData, forKey: "gromo:goal:selection")
        sharedDefaults?.removeObject(forKey: "gromo:goal:selectionPending")
        sharedDefaults?.removeObject(forKey: "gromo:goal:selectionApplyDate")

        // 버킷 모니터를 새 선택으로 재등록 — 자정이라 base=0, 등록시각=now(오발화 가드 기준점).
        var start = DateComponents()
        start.hour = 0
        start.minute = 0
        var end = DateComponents()
        end.hour = 23
        end.minute = 59
        let schedule = DeviceActivitySchedule(intervalStart: start, intervalEnd: end, repeats: true)
        let bucketWebDomains = selection.categoryTokens.isEmpty ? selection.webDomainTokens : []
        var events: [DeviceActivityEvent.Name: DeviceActivityEvent] = [:]
        var m = 15
        while m <= 900 {
            var threshold = DateComponents()
            threshold.hour = m / 60
            threshold.minute = m % 60
            events[DeviceActivityEvent.Name("gromo.usage.bucket.\(m)")] = DeviceActivityEvent(
                applications: selection.applicationTokens,
                categories: selection.categoryTokens,
                webDomains: bucketWebDomains,
                threshold: threshold
            )
            m += 15
        }
        sharedDefaults?.set(
            Date().timeIntervalSince1970, forKey: "gromo:screentime:bucketRegisteredAt")
        sharedDefaults?.set(0, forKey: "gromo:screentime:bucketBaseMinutes")
        sharedDefaults?.set(todayString, forKey: "gromo:screentime:bucketBaseDate")
        let center = DeviceActivityCenter()
        center.stopMonitoring([DeviceActivityName("gromo.usage.buckets")])
        do {
            try center.startMonitoring(
                DeviceActivityName("gromo.usage.buckets"), during: schedule, events: events)
            appendDebugLog("A안 자정 승격 — 새 선택으로 버킷 재등록(목표는 앱이 재등록)")
        } catch {
            appendDebugLog("A안 자정 승격 버킷 재등록 실패: \(error.localizedDescription)")
        }
    }

    // 새 날(00:00) 시작 시 활동별 당일 상태 초기화.
    // (GROMO-942) gromo.daily 목표 판정 모니터는 폐지 — 달성은 앱이 버킷 사용시간으로 판정한다.
    override func intervalDidStart(for activity: DeviceActivityName) {
        super.intervalDidStart(for: activity)
        switch activity.rawValue {
        case "gromo.usage.buckets":
            // 이 콜백도 자정만이 아니라 재등록의 startMonitoring으로 한낮에 불릴 수 있다
            // (GROMO-931, intervalDidEnd와 동일 원인). 저장 날짜가 이미 오늘이면 새 날이 아니라
            // 스퓨리어스 호출 — 아래 리셋이 오늘 눈금·재등록 베이스를 지워버리므로 아무것도 안 한다.
            // 진짜 자정 호출은 저장 날짜가 어제(또는 없음)라 기존과 동일하게 리셋 경로를 탄다.
            let prevDate = sharedDefaults?.string(forKey: "gromo:screentime:usageBucketDate")
            let prevMins = sharedDefaults?.integer(forKey: "gromo:screentime:usageBucketMinutes") ?? 0
            if prevDate == todayString {
                appendDebugLog("intervalDidStart 스킵 — 당일 한낮 호출(재등록)")
                break
            }
            // 리셋 전에 직전 날 최종 눈금을 전일 키로 보존(GROMO-633) — intervalDidEnd를 놓친 경우 대비.
            // 메인 앱의 '어제분 마감 업로드'가 마지막 포그라운드 이후 늘어난 사용분까지 읽을 수 있게 한다.
            if let prevDate, prevMins > 0 {
                sharedDefaults?.set(prevMins, forKey: "gromo:screentime:prevBucketMinutes")
                sharedDefaults?.set(prevDate, forKey: "gromo:screentime:prevBucketDate")
            }
            // 사용량 버킷 리셋 (오늘 기준으로 새로 카운트 — 눈금은 메인 앱 등록이 정함)
            sharedDefaults?.set(0, forKey: "gromo:screentime:usageBucketMinutes")
            sharedDefaults?.set(todayString, forKey: "gromo:screentime:usageBucketDate")
            // 재등록 베이스라인도 새 날 기준으로 리셋(GROMO-871 코드리뷰 P2) — 베이스는 '등록한
            // 날'의 등록 전 기록이므로 날이 바뀌면 무효다(아래 합산부의 날짜 검사와 이중 방어).
            sharedDefaults?.set(0, forKey: "gromo:screentime:bucketBaseMinutes")
            sharedDefaults?.set(todayString, forKey: "gromo:screentime:bucketBaseDate")
            appendDebugLog("intervalDidStart 자정 리셋 — 직전 \(prevMins)분(\(prevDate ?? "-")) 보존")
            // A안 — 자정 리셋 직후, 대기 중인 측정 대상 변경이 있으면 새 선택으로 승격·재등록.
            // (한낮 스퓨리어스 호출은 위에서 이미 break 했으므로 여기는 진짜 자정만 도달.)
            promotePendingSelectionIfDue()
        default:
            break
        }
    }

    // 하루가 끝날 때(자정) 활동별 마감 처리 — gromo.usage.buckets 최종 눈금을 전일 키로 보존(GROMO-633).
    // (GROMO-942) gromo.daily 목표 판정 마감은 폐지 — 달성은 앱이 버킷 사용시간으로 판정한다.
    override func intervalDidEnd(for activity: DeviceActivityName) {
        super.intervalDidEnd(for: activity)
        switch activity.rawValue {
        case "gromo.usage.buckets":
            // 최종 눈금을 '눈금이 기록된 날짜' 키로 보존. 이 콜백은 자정(23:59)만이 아니라
            // 재등록의 stopMonitoring으로도 한낮에 불린다(GROMO-931 실기기 확인). 호출 시점의
            // 현재 날짜로 찍으면 묵은 값이 오늘 값으로 둔갑해 다음날 마감이 어제 최종치로
            // 오인한다(어제 통계 누락·부풀림). 진짜 자정 호출은 기록 날짜 == 현재 날짜라 동작 동일.
            let mins = sharedDefaults?.integer(forKey: "gromo:screentime:usageBucketMinutes") ?? 0
            let minsDate = sharedDefaults?.string(forKey: "gromo:screentime:usageBucketDate")
            if mins > 0, let minsDate {
                sharedDefaults?.set(mins, forKey: "gromo:screentime:prevBucketMinutes")
                sharedDefaults?.set(minsDate, forKey: "gromo:screentime:prevBucketDate")
                appendDebugLog("intervalDidEnd 보존 — \(mins)분@\(minsDate)")
            } else {
                appendDebugLog("intervalDidEnd 스킵 — 기록 없음")
            }
        default:
            break
        }
    }

    // threshold 눈금(분)이 물리적으로 가능한 값인지 검사(GROMO-871).
    // 모니터 (재)등록 직후 iOS가 등록된 threshold 이벤트 전부를 즉시 연쇄 오발화하는 버그가 있어
    // (측정 대상 재저장 → 재등록 → 버킷이 한 방에 상한 720분까지 래칫 → 통계에 12시간),
    // "선택 앱을 N분 쓰려면 실제 N분이 흘러야 한다" 불변식으로 거른다:
    //  · 자정 기준 — 오늘 0시 이후 경과 시간보다 큰 사용량은 불가능(누적은 하루 단위 리셋)
    //  · 등록 기준 — (재)등록이 당일 누적 카운트를 리셋하므로 등록 후 경과 시간보다 커도 불가능.
    //    등록 시각은 메인 앱이 등록 성공 시 App Group에 기록. 기록이 없으면(구버전 등록) 자정 기준만.
    // slack 5분 — 눈금 경계 직전 발화·시계 오차로 정상 이벤트가 잘리지 않게.
    private func isPlausibleUsage(minutes: Double, registeredAtKey: String) -> Bool {
        let now = Date()
        let slack = 5.0
        let sinceMidnight = now.timeIntervalSince(Calendar.current.startOfDay(for: now)) / 60
        if minutes > sinceMidnight + slack { return false }
        let registeredAt = sharedDefaults?.double(forKey: registeredAtKey) ?? 0
        if registeredAt > 0 {
            let sinceRegistration = (now.timeIntervalSince1970 - registeredAt) / 60
            if minutes > sinceRegistration + slack { return false }
        }
        return true
    }

    // threshold 도달 콜백 — gromo.usage.bucket.<분> → 사용량 버킷(도달 최고 눈금) 갱신.
    // (GROMO-942) gromo.goal.threshold(목표 초과 플래그)는 폐지 — 달성은 앱이 버킷으로 판정한다.
    override func eventDidReachThreshold(_ event: DeviceActivityEvent.Name, activity: DeviceActivityName) {
        super.eventDidReachThreshold(event, activity: activity)
        let name = event.rawValue

        let bucketPrefix = "gromo.usage.bucket."
        if name.hasPrefix(bucketPrefix), let mins = Int(name.dropFirst(bucketPrefix.count)) {
            // 저장된 날짜가 오늘이 아니면(=지난 날 잔여값) intervalDidStart(자정 리셋 콜백)를 놓친
            // 상태다. 이때 그대로 두면 아래 max 비교라 값이 절대 안 내려가고 상한(720)까지 한 방향으로
            // 래칫돼 매일 720이 찍힌다(GROMO-844). 새 날 첫 이벤트에서 스스로 리셋한다 —
            // 지난 날 최종 눈금은 전일 키로 보존해 '어제분 마감'이 읽을 수 있게 한다.
            let storedDate = sharedDefaults?.string(forKey: "gromo:screentime:usageBucketDate")
            var current = sharedDefaults?.integer(forKey: "gromo:screentime:usageBucketMinutes") ?? 0
            if storedDate != todayString {
                if let storedDate, current > 0 {
                    sharedDefaults?.set(current, forKey: "gromo:screentime:prevBucketMinutes")
                    sharedDefaults?.set(storedDate, forKey: "gromo:screentime:prevBucketDate")
                }
                current = 0 // 오늘 기준으로 새로 카운트
                // 리셋을 즉시 저장으로 확정(GROMO-871) — 아래 오발화 가드가 이번 이벤트를 버려도
                // 지난 날 잔여값이 오늘 날짜로 남지 않게 한다(남으면 다음 max 비교에서 다시 래칫).
                sharedDefaults?.set(0, forKey: "gromo:screentime:usageBucketMinutes")
                sharedDefaults?.set(todayString, forKey: "gromo:screentime:usageBucketDate")
            }
            // 오발화 가드(GROMO-871) — 물리적으로 도달 불가능한 눈금이면 기록하지 않는다.
            guard isPlausibleUsage(
                minutes: Double(mins),
                registeredAtKey: "gromo:screentime:bucketRegisteredAt"
            ) else {
                appendDebugLog("눈금 \(mins) 무시 — 오발화 가드")
                return
            }
            // 베이스 합산(GROMO-871 코드리뷰 P2) — 재등록 후 눈금(mins)은 '등록 이후' 사용량이라
            // 등록 시점까지의 오늘 기록(베이스)에 더해 하루 누적으로 환산한다. 이게 없으면 재등록
            // 전 최고 눈금에 가려(max 비교) 이후 측정이 하루 종일 무시된다. 베이스 날짜가 오늘이
            // 아니면 0 취급, 합산은 등록 상한과 동일하게 900으로 클램프.
            let baseDate = sharedDefaults?.string(forKey: "gromo:screentime:bucketBaseDate")
            let base =
                baseDate == todayString
                ? (sharedDefaults?.integer(forKey: "gromo:screentime:bucketBaseMinutes") ?? 0) : 0
            let total = min(base + mins, 900)
            // 합산값이 (오늘 기준) 기존 최고값보다 크면 갱신 (버킷은 순차 발화지만 방어적으로 max 비교)
            if total > current {
                sharedDefaults?.set(total, forKey: "gromo:screentime:usageBucketMinutes")
                appendDebugLog("눈금 \(mins) 발화 → 오늘 \(total)분 기록(베이스 \(base))")
            } else {
                appendDebugLog("눈금 \(mins) 발화 — 기존 \(current)분 유지")
            }
            sharedDefaults?.set(todayString, forKey: "gromo:screentime:usageBucketDate")
        }
    }
}
