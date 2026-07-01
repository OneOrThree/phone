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
            // 30분 버킷 사용량 리셋 (오늘 기준으로 새로 카운트)
            sharedDefaults?.set(0, forKey: "gromo:screentime:usageBucketMinutes")
            sharedDefaults?.set(todayString, forKey: "gromo:screentime:usageBucketDate")
        default:
            break
        }
    }

    // 하루가 끝날 때(자정) 보상 판정 결과를 App Group에 기록 (gromo.daily 전용)
    // 메인 앱에서 getYesterdayResult()로 읽어 보상 지급 여부 결정
    override func intervalDidEnd(for activity: DeviceActivityName) {
        super.intervalDidEnd(for: activity)
        guard activity.rawValue == "gromo.daily" else { return }

        // 오늘 사용량이 목표시간을 넘겼는지 판정
        // (선택한 앱 누적 사용시간이 threshold 도달 시 eventDidReachThreshold가 플래그를 세움)
        let exceeded = sharedDefaults?.bool(forKey: "gromo:screentime:goalExceededToday") ?? false

        // 넘겼으면 "fail"(달성 실패), 안 넘겼으면 "success"(달성)
        sharedDefaults?.set(exceeded ? "fail" : "success", forKey: "gromo:screentime:lastResult")
        sharedDefaults?.set(todayString, forKey: "gromo:screentime:lastResultDate")
        sharedDefaults?.set(false, forKey: "gromo:screentime:goalExceededToday")
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
            // 도달한 눈금이 기존 최고값보다 크면 갱신 (버킷은 순차 발화지만 방어적으로 max 비교)
            let current = sharedDefaults?.integer(forKey: "gromo:screentime:usageBucketMinutes") ?? 0
            if mins > current {
                sharedDefaults?.set(mins, forKey: "gromo:screentime:usageBucketMinutes")
            }
            // intervalDidStart를 놓친 경우 대비해 날짜도 최신화
            sharedDefaults?.set(todayString, forKey: "gromo:screentime:usageBucketDate")
        }
    }
}
