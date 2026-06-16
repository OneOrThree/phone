import Foundation
import DeviceActivity

class DeviceActivityMonitorExtension: DeviceActivityMonitor {

    private let sharedDefaults = UserDefaults(suiteName: "group.com.oneorthree.gromo")

    private var todayString: String {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        return f.string(from: Date())
    }

    // 새 날(00:00) 시작 시 당일 초과 플래그 초기화
    override func intervalDidStart(for activity: DeviceActivityName) {
        super.intervalDidStart(for: activity)
        sharedDefaults?.set(false, forKey: "gromo:screentime:goalExceededToday")
    }

    // 하루가 끝날 때(자정) 달성 여부를 App Group에 기록
    // 메인 앱에서 getYesterdayResult()로 읽어 보상 지급 여부 결정
    override func intervalDidEnd(for activity: DeviceActivityName) {
        super.intervalDidEnd(for: activity)
        let exceeded = sharedDefaults?.bool(forKey: "gromo:screentime:goalExceededToday") ?? false
        sharedDefaults?.set(exceeded ? "fail" : "success", forKey: "gromo:screentime:lastResult")
        sharedDefaults?.set(todayString, forKey: "gromo:screentime:lastResultDate")
        sharedDefaults?.set(false, forKey: "gromo:screentime:goalExceededToday")
    }

    // 사용 시간이 goalSeconds 임계값을 넘으면 달성 실패 플래그 설정
    override func eventDidReachThreshold(_ event: DeviceActivityEvent.Name, activity: DeviceActivityName) {
        super.eventDidReachThreshold(event, activity: activity)
        sharedDefaults?.set(true, forKey: "gromo:screentime:goalExceededToday")
    }
}
