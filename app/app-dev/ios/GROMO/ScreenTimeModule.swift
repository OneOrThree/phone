import CryptoKit
import DeviceActivity
import FamilyControls
import Foundation
import ManagedSettings
import React
import SwiftUI
import UIKit

private let appGroupID = "group.com.oneorthree.focuscat"

@objc(ScreenTimeModule)
final class ScreenTimeModule: NSObject {
    @objc static func moduleName() -> String { "ScreenTimeModule" }
    @objc static func requiresMainQueueSetup() -> Bool { false }

    private func signature(_ selection: FamilyActivitySelection) -> String {
        let canonical = [
            "applications:\(canonicalTokens(selection.applicationTokens).joined(separator: ","))",
            "categories:\(canonicalTokens(selection.categoryTokens).joined(separator: ","))",
            "webDomains:\(canonicalTokens(selection.webDomainTokens).joined(separator: ","))",
        ].joined(separator: "|")
        guard let data = canonical.data(using: .utf8) else { return "" }
        return SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }

    private func canonicalTokens<S: Sequence>(_ tokens: S) -> [String] where S.Element: Encodable {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        return tokens.compactMap { try? encoder.encode($0).base64EncodedString() }.sorted()
    }

    private func counts(_ selection: FamilyActivitySelection) -> [String: Any] {
        [
            "applications": selection.applicationTokens.count,
            "categories": selection.categoryTokens.count,
            "webDomains": selection.webDomainTokens.count,
            "selectionSignature": signature(selection),
        ]
    }

    @objc func requestAuthorization(
        _ resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        guard #available(iOS 16.0, *) else {
            reject("UNAVAILABLE", "iOS 16 이상에서만 사용할 수 있어요.", nil)
            return
        }
        Task {
            do {
                try await AuthorizationCenter.shared.requestAuthorization(for: .individual)
                resolve(Self.isAuthorized)
            } catch FamilyControlsError.authorizationCanceled {
                resolve(false)
            } catch {
                reject("AUTH_ERROR", "스크린타임 권한 요청에 실패했어요.", error)
            }
        }
    }

    @objc func getAuthorizationStatus(
        _ resolve: @escaping RCTPromiseResolveBlock,
        rejecter _: @escaping RCTPromiseRejectBlock
    ) {
        guard #available(iOS 16.0, *) else {
            resolve("unavailable")
            return
        }
        switch AuthorizationCenter.shared.authorizationStatus {
        case .approved, .approvedWithDataAccess: resolve("approved")
        case .denied: resolve("denied")
        case .notDetermined: resolve("notDetermined")
        @unknown default: resolve("notDetermined")
        }
    }

    @objc func getMeasurementSelectionCounts(
        _ resolve: @escaping RCTPromiseResolveBlock,
        rejecter _: @escaping RCTPromiseRejectBlock
    ) {
        guard #available(iOS 16.0, *) else {
            resolve(nil)
            return
        }
        let defaults = UserDefaults(suiteName: appGroupID)
        guard let data = defaults?.data(forKey: "gromo:goal:selection"),
              let selection = try? JSONDecoder().decode(FamilyActivitySelection.self, from: data)
        else {
            resolve(nil)
            return
        }
        resolve(counts(selection))
    }

    @objc func presentAppPicker(
        _ resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        guard #available(iOS 16.0, *) else {
            reject("UNAVAILABLE", "iOS 16 이상에서만 사용할 수 있어요.", nil)
            return
        }
        DispatchQueue.main.async {
            guard let top = Self.topViewController() else {
                reject("NO_VIEW_CONTROLLER", "앱 선택 화면을 표시할 수 없어요.", nil)
                return
            }
            let defaults = UserDefaults(suiteName: appGroupID)
            var initial = FamilyActivitySelection()
            if let data = defaults?.data(forKey: "gromo:goal:selectionPending")
                ?? defaults?.data(forKey: "gromo:goal:selection"),
               let saved = try? JSONDecoder().decode(FamilyActivitySelection.self, from: data) {
                initial = saved
            }
            let picker = GromoActivityPicker(
                title: "측정할 앱 선택",
                initialSelection: initial,
                maxApplications: nil,
                maxWebDomains: nil,
                allowsEmpty: false,
                onDone: { selection in
                    guard !Self.isEmpty(selection) else { return }
                    if let data = try? JSONEncoder().encode(selection) {
                        defaults?.set(data, forKey: "gromo:goal:selectionPending")
                    }
                    top.dismiss(animated: true) {
                        var value = self.counts(selection)
                        value["dismissed"] = true
                        resolve(value)
                    }
                },
                onCancel: { top.dismiss(animated: true) { resolve(nil) } }
            )
            let host = UIHostingController(rootView: picker)
            host.isModalInPresentation = true
            top.present(host, animated: true)
        }
    }

    @objc func promoteSelection(
        _ resolve: @escaping RCTPromiseResolveBlock,
        rejecter _: @escaping RCTPromiseRejectBlock
    ) {
        let defaults = UserDefaults(suiteName: appGroupID)
        guard let data = defaults?.data(forKey: "gromo:goal:selectionPending") else {
            resolve(false)
            return
        }
        defaults?.set(data, forKey: "gromo:goal:selection")
        defaults?.removeObject(forKey: "gromo:goal:selectionPending")
        defaults?.removeObject(forKey: "gromo:goal:selectionApplyDate")
        resolve(true)
    }

    @objc func setPendingSelectionApplyDate(
        _ dateString: String,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter _: @escaping RCTPromiseRejectBlock
    ) {
        let defaults = UserDefaults(suiteName: appGroupID)
        if dateString.isEmpty {
            defaults?.removeObject(forKey: "gromo:goal:selectionApplyDate")
        } else {
            defaults?.set(dateString, forKey: "gromo:goal:selectionApplyDate")
        }
        resolve(true)
    }

    @objc func startUsageBucketMonitoring(
        _ maxMinutesValue: Double,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        guard #available(iOS 16.0, *) else {
            resolve(false)
            return
        }
        let defaults = UserDefaults(suiteName: appGroupID)
        guard let data = defaults?.data(forKey: "gromo:goal:selection"),
              let selection = try? JSONDecoder().decode(FamilyActivitySelection.self, from: data),
              !Self.isEmpty(selection)
        else {
            resolve(false)
            return
        }
        do {
            try registerUsageBucketMonitoring(
                selection,
                maxMinutes: Int(maxMinutesValue),
                defaults: defaults
            )
            resolve(true)
        } catch {
            reject("MONITOR_ERROR", "스크린타임 측정을 시작하지 못했어요.", error)
        }
    }

    private func registerUsageBucketMonitoring(
        _ selection: FamilyActivitySelection,
        maxMinutes: Int,
        defaults: UserDefaults?
    ) throws {
        let center = DeviceActivityCenter()
        let activity = DeviceActivityName("gromo.usage.buckets")
        let schedule = DeviceActivitySchedule(
            intervalStart: DateComponents(hour: 0, minute: 0),
            intervalEnd: DateComponents(hour: 23, minute: 59),
            repeats: true
        )
        let today = Self.dayString(Date())
        let storedDate = defaults?.string(forKey: "gromo:screentime:usageBucketDate")
        let base = storedDate == today
            ? (defaults?.integer(forKey: "gromo:screentime:usageBucketMinutes") ?? 0) : 0
        let registeredAtKey = "gromo:screentime:bucketRegisteredAt"
        let baseMinutesKey = "gromo:screentime:bucketBaseMinutes"
        let baseDateKey = "gromo:screentime:bucketBaseDate"
        let registeredSelectionKey = "gromo:screentime:registeredSelection"
        let registeredMaxMinutesKey = "gromo:screentime:registeredMaxMinutes"
        let boundedMaxMinutes = min(max(maxMinutes, 15), 900)
        let previousRegisteredAt = defaults?.object(forKey: registeredAtKey)
        let previousBaseMinutes = defaults?.object(forKey: baseMinutesKey)
        let previousBaseDate = defaults?.object(forKey: baseDateKey)
        let previousSelectionData = defaults?.data(forKey: registeredSelectionKey)
            ?? defaults?.data(forKey: "gromo:goal:selection")
        let previousSelection = previousSelectionData.flatMap {
            try? JSONDecoder().decode(FamilyActivitySelection.self, from: $0)
        }
        let previousMaxMinutes = (
            defaults?.object(forKey: registeredMaxMinutesKey) as? NSNumber
        )?.intValue ?? boundedMaxMinutes
        let prepareRegistration = {
            defaults?.set(Date().timeIntervalSince1970, forKey: registeredAtKey)
            defaults?.set(base, forKey: baseMinutesKey)
            defaults?.set(today, forKey: baseDateKey)
        }

        prepareRegistration()
        center.stopMonitoring([activity])
        do {
            try center.startMonitoring(
                activity,
                during: schedule,
                events: usageBucketEvents(selection, maxMinutes: boundedMaxMinutes)
            )
            if let data = try? JSONEncoder().encode(selection) {
                defaults?.set(data, forKey: registeredSelectionKey)
            }
            defaults?.set(boundedMaxMinutes, forKey: registeredMaxMinutesKey)
        } catch let registrationError {
            var restored = false
            if let previousSelection, !Self.isEmpty(previousSelection) {
                prepareRegistration()
                do {
                    try center.startMonitoring(
                        activity,
                        during: schedule,
                        events: usageBucketEvents(
                            previousSelection,
                            maxMinutes: previousMaxMinutes
                        )
                    )
                    restored = true
                } catch {}
            }
            if !restored {
                restore(previousRegisteredAt, forKey: registeredAtKey, defaults: defaults)
                restore(previousBaseMinutes, forKey: baseMinutesKey, defaults: defaults)
                restore(previousBaseDate, forKey: baseDateKey, defaults: defaults)
            }
            throw registrationError
        }
    }

    private func usageBucketEvents(
        _ selection: FamilyActivitySelection,
        maxMinutes: Int
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

    private func restore(_ value: Any?, forKey key: String, defaults: UserDefaults?) {
        if let value {
            defaults?.set(value, forKey: key)
        } else {
            defaults?.removeObject(forKey: key)
        }
    }

    @objc func getTodayUsageBucketMinutes(
        _ resolve: @escaping RCTPromiseResolveBlock,
        rejecter _: @escaping RCTPromiseRejectBlock
    ) {
        let defaults = UserDefaults(suiteName: appGroupID)
        let date = defaults?.string(forKey: "gromo:screentime:usageBucketDate")
        resolve(date == Self.dayString(Date())
            ? (defaults?.integer(forKey: "gromo:screentime:usageBucketMinutes") ?? 0) : 0)
    }

    @objc func presentAllowedAppManager(
        _ resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        guard #available(iOS 16.0, *) else {
            reject("UNAVAILABLE", "iOS 16 이상에서만 사용할 수 있어요.", nil)
            return
        }
        DispatchQueue.main.async {
            guard let top = Self.topViewController() else {
                reject("NO_VIEW_CONTROLLER", "허용 앱 화면을 표시할 수 없어요.", nil)
                return
            }
            let defaults = UserDefaults(suiteName: appGroupID)
            var initial = FamilyActivitySelection(includeEntireCategory: true)
            if let data = defaults?.data(forKey: "gromo:focus:allowedSelection"),
               let saved = try? JSONDecoder().decode(FamilyActivitySelection.self, from: data) {
                initial.applicationTokens = saved.applicationTokens
                initial.webDomainTokens = saved.webDomainTokens
            }
            let manager = GromoAllowedAppManager(initialSelection: initial) { selection in
                if let data = try? JSONEncoder().encode(selection) {
                    defaults?.set(data, forKey: "gromo:focus:allowedSelection")
                }
                top.dismiss(animated: true) {
                    var value = self.counts(selection)
                    value["dismissed"] = true
                    resolve(value)
                }
            }
            let host = UIHostingController(rootView: manager)
            host.isModalInPresentation = true
            top.present(host, animated: true)
        }
    }

    @objc func getAllowedSelectionCounts(
        _ resolve: @escaping RCTPromiseResolveBlock,
        rejecter _: @escaping RCTPromiseRejectBlock
    ) {
        guard #available(iOS 16.0, *) else {
            resolve(nil)
            return
        }
        let defaults = UserDefaults(suiteName: appGroupID)
        guard let data = defaults?.data(forKey: "gromo:focus:allowedSelection"),
              let selection = try? JSONDecoder().decode(FamilyActivitySelection.self, from: data)
        else {
            resolve(nil)
            return
        }
        resolve(counts(selection))
    }

    @objc func setFocusAllowSafariWeb(
        _ allowed: Bool,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter _: @escaping RCTPromiseRejectBlock
    ) {
        let defaults = UserDefaults(suiteName: appGroupID)
        defaults?.set(allowed, forKey: "gromo:focus:allowSafariWeb")
        applyFocusShieldIfActive(defaults)
        resolve(nil)
    }

    @objc func getFocusAllowSafariWeb(
        _ resolve: @escaping RCTPromiseResolveBlock,
        rejecter _: @escaping RCTPromiseRejectBlock
    ) {
        resolve(UserDefaults(suiteName: appGroupID)?.bool(forKey: "gromo:focus:allowSafariWeb") ?? false)
    }

    @objc func startFocusShield(
        _ subjectName: String,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter _: @escaping RCTPromiseRejectBlock
    ) {
        guard #available(iOS 16.0, *),
              Self.isAuthorized else {
            resolve(false)
            return
        }
        let defaults = UserDefaults(suiteName: appGroupID)
        defaults?.set(subjectName, forKey: "gromo:focus:shieldSubject")
        defaults?.set(true, forKey: "gromo:focus:shieldActive")
        applyFocusShield(defaults)
        resolve(true)
    }

    private func applyFocusShieldIfActive(_ defaults: UserDefaults?) {
        guard defaults?.bool(forKey: "gromo:focus:shieldActive") == true,
              Self.isAuthorized else { return }
        applyFocusShield(defaults)
    }

    private func applyFocusShield(_ defaults: UserDefaults?) {
        var apps = Set<ApplicationToken>()
        var domains = Set<WebDomainToken>()
        if let data = defaults?.data(forKey: "gromo:focus:allowedSelection"),
           let selection = try? JSONDecoder().decode(FamilyActivitySelection.self, from: data) {
            apps = selection.applicationTokens
            domains = selection.webDomainTokens
        }
        let store = ManagedSettingsStore(named: .init("gromoFocus"))
        store.shield.applicationCategories = .all(except: apps)
        if defaults?.bool(forKey: "gromo:focus:allowSafariWeb") == true {
            store.shield.webDomainCategories = nil
            store.application.blockedApplications = nil
            store.webContent.blockedByFilter = nil
        } else {
            store.shield.webDomainCategories = .all(except: domains)
            store.application.blockedApplications = [Application(bundleIdentifier: "com.apple.mobilesafari")]
            let exceptions = Set(domains.prefix(50).map { WebDomain(token: $0) })
            store.webContent.blockedByFilter = .all(except: exceptions)
        }
    }

    @objc func stopFocusShield(
        _ resolve: @escaping RCTPromiseResolveBlock,
        rejecter _: @escaping RCTPromiseRejectBlock
    ) {
        if #available(iOS 16.0, *) {
            ManagedSettingsStore(named: .init("gromoFocus")).clearAllSettings()
        }
        UserDefaults(suiteName: appGroupID)?.set(false, forKey: "gromo:focus:shieldActive")
        resolve(nil)
    }

    private static func isEmpty(_ selection: FamilyActivitySelection) -> Bool {
        selection.applicationTokens.isEmpty
            && selection.categoryTokens.isEmpty
            && selection.webDomainTokens.isEmpty
    }

    private static var isAuthorized: Bool {
        switch AuthorizationCenter.shared.authorizationStatus {
        case .approved, .approvedWithDataAccess: true
        case .denied, .notDetermined: false
        @unknown default: false
        }
    }

    private static func dayString(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: date)
    }

    private static func topViewController() -> UIViewController? {
        let window = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap(\.windows)
            .first(where: \.isKeyWindow)
        var top = window?.rootViewController
        while let presented = top?.presentedViewController { top = presented }
        return top
    }
}

@available(iOS 16.0, *)
private struct GromoActivityPicker: View {
    @State private var selection: FamilyActivitySelection
    @State private var showEmptyAlert = false
    @State private var showLimitAlert = false
    @State private var showWebLimitAlert = false
    private let title: String
    private let maxApplications: Int?
    private let maxWebDomains: Int?
    private let allowsEmpty: Bool
    private let onDone: (FamilyActivitySelection) -> Void
    private let onCancel: () -> Void

    init(
        title: String,
        initialSelection: FamilyActivitySelection,
        maxApplications: Int?,
        maxWebDomains: Int?,
        allowsEmpty: Bool,
        onDone: @escaping (FamilyActivitySelection) -> Void,
        onCancel: @escaping () -> Void
    ) {
        self.title = title
        _selection = State(initialValue: initialSelection)
        self.maxApplications = maxApplications
        self.maxWebDomains = maxWebDomains
        self.allowsEmpty = allowsEmpty
        self.onDone = onDone
        self.onCancel = onCancel
    }

    var body: some View {
        NavigationView {
            FamilyActivityPicker(selection: $selection)
                .navigationTitle(title)
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("취소", action: onCancel)
                    }
                    ToolbarItem(placement: .confirmationAction) {
                        Button("완료") {
                            let empty = selection.applicationTokens.isEmpty
                                && selection.categoryTokens.isEmpty
                                && selection.webDomainTokens.isEmpty
                            if empty && !allowsEmpty { showEmptyAlert = true }
                            else if let maxApplications,
                                    selection.applicationTokens.count > maxApplications {
                                showLimitAlert = true
                            } else if let maxWebDomains,
                                      selection.webDomainTokens.count > maxWebDomains {
                                showWebLimitAlert = true
                            } else { onDone(selection) }
                        }
                    }
                }
                .alert("앱을 하나 이상 골라주세요", isPresented: $showEmptyAlert) {
                    Button("확인", role: .cancel) {}
                }
                .alert("\(maxApplications ?? 40)개까지만 고를 수 있어요", isPresented: $showLimitAlert) {
                    Button("확인", role: .cancel) {}
                } message: {
                    Text("카테고리를 고르면 그 안의 앱도 개수에 포함돼요.")
                }
                .alert("웹사이트는 \(maxWebDomains ?? 50)개까지만 고를 수 있어요", isPresented: $showWebLimitAlert) {
                    Button("확인", role: .cancel) {}
                } message: {
                    Text("일부 웹사이트를 해제한 뒤 다시 완료해 주세요.")
                }
        }
    }
}

@available(iOS 16.0, *)
private struct GromoAllowedAppManager: View {
    @State private var selection: FamilyActivitySelection
    @State private var showPicker = false
    private let onClose: (FamilyActivitySelection) -> Void

    init(
        initialSelection: FamilyActivitySelection,
        onClose: @escaping (FamilyActivitySelection) -> Void
    ) {
        _selection = State(initialValue: initialSelection)
        self.onClose = onClose
    }

    var body: some View {
        NavigationView {
            List {
                Section {
                    if selection.applicationTokens.isEmpty {
                        Text("집중 중 사용할 앱을 추가해 주세요.").foregroundColor(.secondary)
                    } else {
                        ForEach(Array(selection.applicationTokens), id: \.self) { Label($0) }
                    }
                } header: {
                    Text("허용 앱 \(selection.applicationTokens.count)/40")
                } footer: {
                    Text("선택하지 않은 앱과 웹은 집중하는 동안 잠겨요.")
                }
            }
            .navigationTitle("집중 중 허용 앱")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("완료") { onClose(selection) }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button { showPicker = true } label: { Image(systemName: "plus") }
                }
            }
            .sheet(isPresented: $showPicker) {
                GromoActivityPicker(
                    title: "허용 앱 추가·삭제",
                    initialSelection: selection,
                    maxApplications: 40,
                    maxWebDomains: 50,
                    allowsEmpty: true,
                    onDone: { picked in
                        var normalized = FamilyActivitySelection(includeEntireCategory: true)
                        normalized.applicationTokens = picked.applicationTokens
                        normalized.webDomainTokens = picked.webDomainTokens
                        selection = normalized
                        showPicker = false
                    },
                    onCancel: { showPicker = false }
                )
            }
        }
    }
}
