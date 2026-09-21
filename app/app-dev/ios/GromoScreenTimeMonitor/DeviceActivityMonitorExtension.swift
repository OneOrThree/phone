import DeviceActivity
import FamilyControls
import Foundation

final class DeviceActivityMonitorExtension: DeviceActivityMonitor {
    private let defaults = UserDefaults(suiteName: "group.com.oneorthree.focuscat")

    private var today: String { Self.dayString(Date()) }

    @discardableResult
    private func promotePendingSelectionIfDue() -> Bool {
        guard let pendingData = defaults?.data(forKey: "gromo:goal:selectionPending") else {
            return false
        }
        if let applyDate = defaults?.string(forKey: "gromo:goal:selectionApplyDate"),
           applyDate > today { return false }
        guard let selection = try? JSONDecoder().decode(
            FamilyActivitySelection.self,
            from: pendingData
        ), !Self.isEmpty(selection) else {
            defaults?.removeObject(forKey: "gromo:goal:selectionPending")
            defaults?.removeObject(forKey: "gromo:goal:selectionApplyDate")
            return false
        }

        let registeredSelectionKey = "gromo:screentime:registeredSelection"
        let registeredMaxMinutesKey = "gromo:screentime:registeredMaxMinutes"
        let previousSelectionData = defaults?.data(forKey: registeredSelectionKey)
            ?? defaults?.data(forKey: "gromo:goal:selection")
        let previousSelection = previousSelectionData
            .flatMap { try? JSONDecoder().decode(FamilyActivitySelection.self, from: $0) }
        let previousMaxMinutes = (
            defaults?.object(forKey: registeredMaxMinutesKey) as? NSNumber
        )?.intValue ?? 900
        let previousRegisteredAt = defaults?.object(
            forKey: "gromo:screentime:bucketRegisteredAt"
        ) as? NSNumber
        let center = DeviceActivityCenter()
        defaults?.set(Date().timeIntervalSince1970, forKey: "gromo:screentime:bucketRegisteredAt")
        center.stopMonitoring([DeviceActivityName("gromo.usage.buckets")])
        do {
            try center.startMonitoring(
                DeviceActivityName("gromo.usage.buckets"),
                during: Self.schedule,
                events: Self.events(for: selection, maxMinutes: previousMaxMinutes)
            )
            defaults?.set(0, forKey: "gromo:screentime:bucketBaseMinutes")
            defaults?.set(today, forKey: "gromo:screentime:bucketBaseDate")
            defaults?.set(pendingData, forKey: "gromo:goal:selection")
            defaults?.set(pendingData, forKey: registeredSelectionKey)
            defaults?.set(previousMaxMinutes, forKey: registeredMaxMinutesKey)
            defaults?.removeObject(forKey: "gromo:goal:selectionPending")
            defaults?.removeObject(forKey: "gromo:goal:selectionApplyDate")
            defaults?.set(today, forKey: "gromo:goal:selectionPromotedOkDate")
            return true
        } catch {
            var restored = false
            if let previousSelection, !Self.isEmpty(previousSelection) {
                defaults?.set(
                    Date().timeIntervalSince1970,
                    forKey: "gromo:screentime:bucketRegisteredAt"
                )
                do {
                    try center.startMonitoring(
                        DeviceActivityName("gromo.usage.buckets"),
                        during: Self.schedule,
                        events: Self.events(
                            for: previousSelection,
                            maxMinutes: previousMaxMinutes
                        )
                    )
                    restored = true
                } catch {}
            }
            if !restored {
                if let previousRegisteredAt {
                    defaults?.set(
                        previousRegisteredAt.doubleValue,
                        forKey: "gromo:screentime:bucketRegisteredAt"
                    )
                } else {
                    defaults?.removeObject(forKey: "gromo:screentime:bucketRegisteredAt")
                }
            }
            defaults?.removeObject(forKey: "gromo:goal:selectionPromotedOkDate")
            return false
        }
    }

    override func intervalDidStart(for activity: DeviceActivityName) {
        super.intervalDidStart(for: activity)
        guard activity.rawValue == "gromo.usage.buckets" else { return }
        let previousDate = defaults?.string(forKey: "gromo:screentime:usageBucketDate")
        guard previousDate != today else { return }
        let previousMinutes = defaults?.integer(forKey: "gromo:screentime:usageBucketMinutes") ?? 0
        if let previousDate, previousMinutes > 0 {
            defaults?.set(previousDate, forKey: "gromo:screentime:prevBucketDate")
            defaults?.set(previousMinutes, forKey: "gromo:screentime:prevBucketMinutes")
        }
        defaults?.set(0, forKey: "gromo:screentime:usageBucketMinutes")
        defaults?.set(today, forKey: "gromo:screentime:usageBucketDate")
        defaults?.set(0, forKey: "gromo:screentime:bucketBaseMinutes")
        defaults?.set(today, forKey: "gromo:screentime:bucketBaseDate")
        promotePendingSelectionIfDue()
    }

    override func intervalDidEnd(for activity: DeviceActivityName) {
        super.intervalDidEnd(for: activity)
        guard activity.rawValue == "gromo.usage.buckets" else { return }
        let minutes = defaults?.integer(forKey: "gromo:screentime:usageBucketMinutes") ?? 0
        guard minutes > 0,
              let date = defaults?.string(forKey: "gromo:screentime:usageBucketDate") else { return }
        defaults?.set(date, forKey: "gromo:screentime:prevBucketDate")
        defaults?.set(minutes, forKey: "gromo:screentime:prevBucketMinutes")
    }

    override func eventDidReachThreshold(
        _ event: DeviceActivityEvent.Name,
        activity: DeviceActivityName
    ) {
        super.eventDidReachThreshold(event, activity: activity)
        let prefix = "gromo.usage.bucket."
        guard activity.rawValue == "gromo.usage.buckets",
              event.rawValue.hasPrefix(prefix),
              let minutes = Int(event.rawValue.dropFirst(prefix.count)) else { return }

        var current = defaults?.integer(forKey: "gromo:screentime:usageBucketMinutes") ?? 0
        let storedDate = defaults?.string(forKey: "gromo:screentime:usageBucketDate")
        if storedDate != today {
            if let storedDate, current > 0 {
                defaults?.set(storedDate, forKey: "gromo:screentime:prevBucketDate")
                defaults?.set(current, forKey: "gromo:screentime:prevBucketMinutes")
            }
            current = 0
            defaults?.set(0, forKey: "gromo:screentime:usageBucketMinutes")
            defaults?.set(today, forKey: "gromo:screentime:usageBucketDate")
            defaults?.set(0, forKey: "gromo:screentime:bucketBaseMinutes")
            defaults?.set(today, forKey: "gromo:screentime:bucketBaseDate")
            if promotePendingSelectionIfDue() { return }
        }

        guard isPlausible(minutes) else { return }
        let baseDate = defaults?.string(forKey: "gromo:screentime:bucketBaseDate")
        let base = baseDate == today
            ? (defaults?.integer(forKey: "gromo:screentime:bucketBaseMinutes") ?? 0) : 0
        let total = min(base + minutes, 900)
        if total > current {
            defaults?.set(total, forKey: "gromo:screentime:usageBucketMinutes")
        }
        defaults?.set(today, forKey: "gromo:screentime:usageBucketDate")
    }

    private func isPlausible(_ minutes: Int) -> Bool {
        let now = Date()
        let slack = 5.0
        let elapsedToday = now.timeIntervalSince(Calendar.current.startOfDay(for: now)) / 60
        guard Double(minutes) <= elapsedToday + slack else { return false }
        let registeredAt = defaults?.double(forKey: "gromo:screentime:bucketRegisteredAt") ?? 0
        guard registeredAt > 0 else { return true }
        return Double(minutes) <= (now.timeIntervalSince1970 - registeredAt) / 60 + slack
    }

    private static func dayString(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: date)
    }

    private static func isEmpty(_ selection: FamilyActivitySelection) -> Bool {
        selection.applicationTokens.isEmpty
            && selection.categoryTokens.isEmpty
            && selection.webDomainTokens.isEmpty
    }

    private static let schedule = DeviceActivitySchedule(
        intervalStart: DateComponents(hour: 0, minute: 0),
        intervalEnd: DateComponents(hour: 23, minute: 59),
        repeats: true
    )

    private static func events(
        for selection: FamilyActivitySelection,
        maxMinutes: Int = 900
    ) -> [DeviceActivityEvent.Name: DeviceActivityEvent] {
        let webDomains = selection.categoryTokens.isEmpty ? selection.webDomainTokens : []
        var events: [DeviceActivityEvent.Name: DeviceActivityEvent] = [:]
        for minute in stride(from: 15, through: min(max(maxMinutes, 15), 900), by: 15) {
            events[DeviceActivityEvent.Name("gromo.usage.bucket.\(minute)")] = DeviceActivityEvent(
                applications: selection.applicationTokens,
                categories: selection.categoryTokens,
                webDomains: webDomains,
                threshold: DateComponents(hour: minute / 60, minute: minute % 60)
            )
        }
        return events
    }
}
