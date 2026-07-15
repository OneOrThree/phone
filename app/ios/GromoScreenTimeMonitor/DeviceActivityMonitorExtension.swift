import Foundation
import DeviceActivity

class DeviceActivityMonitorExtension: DeviceActivityMonitor {

    private let sharedDefaults = UserDefaults(suiteName: "group.com.oneorthree.gromo")

    private var todayString: String {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        return f.string(from: Date())
    }

    // 새 날(00:00) 시작 시 활동별 당일 상태 초기화
    override func intervalDidStart(for activity: DeviceActivityName) {
        super.intervalDidStart(for: activity)
        switch activity.rawValue {
        case "gromo.daily":
            // 보상 판정용 초과 플래그 리셋
            sharedDefaults?.set(false, forKey: "gromo:screentime:goalExceededToday")
        case "gromo.usage.buckets":
            // 리셋 전에 직전 날 최종 눈금을 전일 키로 보존(GROMO-633) — intervalDidEnd를 놓친 경우 대비.
            // 메인 앱의 '어제분 마감 업로드'가 마지막 포그라운드 이후 늘어난 사용분까지 읽을 수 있게 한다.
            let prevDate = sharedDefaults?.string(forKey: "gromo:screentime:usageBucketDate")
            let prevMins = sharedDefaults?.integer(forKey: "gromo:screentime:usageBucketMinutes") ?? 0
            if let prevDate, prevDate != todayString, prevMins > 0 {
                sharedDefaults?.set(prevMins, forKey: "gromo:screentime:prevBucketMinutes")
                sharedDefaults?.set(prevDate, forKey: "gromo:screentime:prevBucketDate")
            }
            // 30분 버킷 사용량 리셋 (오늘 기준으로 새로 카운트)
            sharedDefaults?.set(0, forKey: "gromo:screentime:usageBucketMinutes")
            sharedDefaults?.set(todayString, forKey: "gromo:screentime:usageBucketDate")
        default:
            break
        }
    }

    // 하루가 끝날 때(자정) 활동별 마감 처리
    //  · gromo.daily         → 보상 판정 결과 기록(메인 앱이 getYesterdayResult()로 읽음)
    //  · gromo.usage.buckets → 최종 사용량 눈금을 전일 키로 보존(GROMO-633)
    override func intervalDidEnd(for activity: DeviceActivityName) {
        super.intervalDidEnd(for: activity)
        switch activity.rawValue {
        case "gromo.daily":
            // 오늘 사용량이 목표시간을 넘겼는지 판정
            // (선택한 앱 누적 사용시간이 threshold 도달 시 eventDidReachThreshold가 플래그를 세움)
            let exceeded = sharedDefaults?.bool(forKey: "gromo:screentime:goalExceededToday") ?? false

            // 넘겼으면 "fail"(달성 실패), 안 넘겼으면 "success"(달성)
            sharedDefaults?.set(exceeded ? "fail" : "success", forKey: "gromo:screentime:lastResult")
            sharedDefaults?.set(todayString, forKey: "gromo:screentime:lastResultDate")
            sharedDefaults?.set(false, forKey: "gromo:screentime:goalExceededToday")
        case "gromo.usage.buckets":
            // 하루 종료(23:59) 시점의 todayString = 방금 끝난 날짜 — 최종 눈금을 전일 키로 보존.
            let mins = sharedDefaults?.integer(forKey: "gromo:screentime:usageBucketMinutes") ?? 0
            if mins > 0 {
                sharedDefaults?.set(mins, forKey: "gromo:screentime:prevBucketMinutes")
                sharedDefaults?.set(todayString, forKey: "gromo:screentime:prevBucketDate")
            }
        default:
            break
        }
    }

    // threshold 도달 콜백 — 이벤트 이름으로 분기
    //  · gromo.goal.threshold        → 보상 판정 초과 플래그
    //  · gromo.usage.bucket.<분>      → 사용량 버킷(도달 최고 눈금) 갱신
    override func eventDidReachThreshold(_ event: DeviceActivityEvent.Name, activity: DeviceActivityName) {
        super.eventDidReachThreshold(event, activity: activity)
        let name = event.rawValue

        if name == "gromo.goal.threshold" {
            sharedDefaults?.set(true, forKey: "gromo:screentime:goalExceededToday")
            return
        }

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
            }
            // 도달한 눈금이 (오늘 기준) 기존 최고값보다 크면 갱신 (버킷은 순차 발화지만 방어적으로 max 비교)
            if mins > current {
                sharedDefaults?.set(mins, forKey: "gromo:screentime:usageBucketMinutes")
            }
            sharedDefaults?.set(todayString, forKey: "gromo:screentime:usageBucketDate")
        }
    }
}
