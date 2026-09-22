import UIKit
import SwiftUI
import DeviceActivity
import FamilyControls

// 리포트 수치는 확장 안에서만 표시한다. 퀘스트 판정은 Monitor 버킷을 사용한다.
final class ScreenTimeReportUIView: UIView {
    private let appGroupID = "group.com.oneorthree.focuscat"
    private var hostingController: UIHostingController<AnyView>?
    private var refreshTimer: Timer?
    private var refreshScheduled = false

    @objc var reportContext: String = "Compact Activity" { didSet { scheduleRefresh() } }
    @objc var dayOffset: Double = 0 { didSet { scheduleRefresh() } }
    // -1은 목표 미설정이다. 0도 유효한 목표이므로 별도로 보존한다.
    @objc var goalSeconds: Double = -1 { didSet { scheduleRefresh() } }

    override init(frame: CGRect) {
        super.init(frame: frame)
        NotificationCenter.default.addObserver(self, selector: #selector(scheduleRefresh),
            name: UIApplication.didBecomeActiveNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(scheduleRefresh),
            name: UIApplication.significantTimeChangeNotification, object: nil)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    deinit {
        refreshTimer?.invalidate()
        NotificationCenter.default.removeObserver(self)
    }

    override func didMoveToWindow() {
        super.didMoveToWindow()
        refreshTimer?.invalidate()
        refreshTimer = nil
        guard window != nil else {
            removeHostingController()
            return
        }
        scheduleRefresh()
        // 오늘 필터의 끝 시각과 자정 이후 날짜, 활성 측정 대상 변경을 반영한다.
        refreshTimer = Timer.scheduledTimer(withTimeInterval: 60, repeats: true) { [weak self] _ in
            guard UIApplication.shared.applicationState == .active else { return }
            self?.scheduleRefresh()
        }
    }

    @objc private func scheduleRefresh() {
        guard !refreshScheduled else { return }
        refreshScheduled = true
        // 같은 RN 업데이트의 props가 모두 도착한 뒤 한 번만 다시 그린다.
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            self.refreshScheduled = false
            self.refreshReport()
        }
    }

    private func refreshReport() {
        guard window != nil, let parent = containerViewController else { return }
        let defaults = UserDefaults(suiteName: appGroupID)
        defaults?.synchronize()
        let selection = defaults?.data(forKey: "gromo:goal:selection")
            .flatMap { try? JSONDecoder().decode(FamilyActivitySelection.self, from: $0) }
        let hasSelection = selection.map {
            !$0.applicationTokens.isEmpty || !$0.categoryTokens.isEmpty || !$0.webDomainTokens.isEmpty
        } ?? false

        let content: AnyView
        if AuthorizationCenter.shared.authorizationStatus != .approved {
            content = message("스크린타임 연결이 꺼져 있어요")
        } else if !hasSelection {
            content = message("측정할 앱을 선택해야 해요")
        } else if let selection = selection {
            let calendar = Calendar.current
            let now = Date()
            let offset = dayOffset.isFinite ? Int(max(-365, min(0, dayOffset))) : 0
            let target = calendar.date(byAdding: .day, value: offset, to: now) ?? now
            let start = calendar.startOfDay(for: target)
            let end = offset == 0 ? now : calendar.date(byAdding: .day, value: 1, to: start)!
            let filter = DeviceActivityFilter(
                segment: .daily(during: DateInterval(start: start, end: end)),
                users: .all, devices: .init([.iPhone]),
                applications: selection.applicationTokens,
                categories: selection.categoryTokens,
                webDomains: selection.categoryTokens.isEmpty ? selection.webDomainTokens : []
            )
            // 목표를 표시하는 context만 공유 목표를 갱신한다. Compact가 지우지 않도록 한다.
            if reportContext == "Remaining Activity" || reportContext == "Home Usage" {
                if goalSeconds.isFinite && goalSeconds >= 0 {
                    defaults?.set(goalSeconds, forKey: "gromo:user:goalSeconds")
                } else {
                    defaults?.removeObject(forKey: "gromo:user:goalSeconds")
                }
                defaults?.synchronize()
            }
            content = AnyView(DeviceActivityReport(.init(reportContext), filter: filter).id(UUID()))
        } else {
            content = message("사용 시간을 확인할 수 없어요")
        }
        if let host = hostingController, host.parent === parent {
            host.rootView = content
            return
        }
        removeHostingController()
        let host = UIHostingController(rootView: content)
        parent.addChild(host)
        host.view.backgroundColor = .clear
        host.view.translatesAutoresizingMaskIntoConstraints = false
        addSubview(host.view)
        NSLayoutConstraint.activate([
            host.view.topAnchor.constraint(equalTo: topAnchor),
            host.view.bottomAnchor.constraint(equalTo: bottomAnchor),
            host.view.leadingAnchor.constraint(equalTo: leadingAnchor),
            host.view.trailingAnchor.constraint(equalTo: trailingAnchor),
        ])
        host.didMove(toParent: parent)
        hostingController = host
    }

    private func message(_ text: String) -> AnyView {
        AnyView(Text(text).font(.caption).foregroundColor(Palette.inkMuted))
    }

    private func removeHostingController() {
        hostingController?.willMove(toParent: nil)
        hostingController?.view.removeFromSuperview()
        hostingController?.removeFromParent()
        hostingController = nil
    }

    private var containerViewController: UIViewController? {
        var responder: UIResponder? = next
        while let current = responder {
            if let controller = current as? UIViewController { return controller }
            responder = current.next
        }
        return nil
    }
}
