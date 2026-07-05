// ScreenTimeReportUIView.swift
// gromo 메인 앱 타겟
//
// 역할: Apple의 SwiftUI DeviceActivityReport 뷰를
//       React Native가 다룰 수 있는 UIKit UIView로 감싸는 컨테이너
//
// 왜 이 파일이 필요한가?
//   React Native는 UIKit 기반 UIView를 렌더링할 수 있음
//   하지만 DeviceActivityReport는 SwiftUI 뷰임
//   → UIHostingController를 사용해 SwiftUI 뷰를 UIView 안에 임베드해야 함
//
// 동작 흐름:
//   1. React Native가 이 UIView를 생성
//   2. setupHostingController()가 DeviceActivityReport SwiftUI 뷰를 내부에 삽입
//   3. 화면에 dayOffset이 가리키는 날(기본 오늘, -1=어제)의 스크린 타임 데이터가 표시됨

import UIKit
import SwiftUI
import DeviceActivity  // DeviceActivityReport, DeviceActivityFilter 사용
import FamilyControls  // FamilyActivitySelection (측정 대상 토큰)
import ManagedSettings // ApplicationToken (허용앱 목록 Label 렌더)

@available(iOS 16.0, *)
class ScreenTimeReportUIView: UIView {

    private var hostingController: UIHostingController<AnyView>?

    // RN에서 prop으로 전달하는 DeviceActivityReport.Context 이름
    // 예: "Total Activity"(기본, ScreenTimeScreen), "Compact Activity"(HomeScreen "사용" StatBox)
    @objc var reportContext: String = "Total Activity"

    // 표시할 날짜 오프셋(일): 0=오늘(00:00~현재), -1=어제(하루 전체).
    // 온보딩 '어제 스크린타임' 비교 화면이 -1을 넘겨 어제 하루치를 보여준다.
    @objc var dayOffset: Double = 0

    // "남은" 칸 전용: 앱 실행 시 App Group에 오늘 목표를 기록
    // 목표 변경은 다음날부터 적용 → 오늘 "남은"은 실시간 업데이트 없음
    @objc var goalSeconds: Double = 0 {
        didSet {
            guard goalSeconds > 0 else { return }
            let defaults = UserDefaults(suiteName: "group.com.oneorthree.gromo")
            defaults?.set(goalSeconds, forKey: "gromo:user:goalSeconds")
            defaults?.synchronize()
        }
    }

    // init에서는 아직 window/부모 VC가 없으므로 설정하지 않음
    override init(frame: CGRect) {
        super.init(frame: frame)
    }

    required init?(coder: NSCoder) {
        super.init(coder: coder)
    }

    // 뷰가 실제 윈도우에 붙은 시점에 설정
    override func didMoveToWindow() {
        super.didMoveToWindow()

        guard window != nil else { return }
        guard hostingController == nil else { return }

        // UIHostingController에 parent VC가 없으면
        // DeviceActivityReportService가 scene을 hosting할 곳을 못 찾고
        // 즉시 invalidate해버림 (parent scene invalidated)
        guard let parentVC = containerViewController else { return }

        setupHostingController(parentVC: parentVC)
    }

    private func setupHostingController(parentVC: UIViewController) {
        let calendar = Calendar.current
        let now = Date()
        // dayOffset만큼 이동한 날의 하루 구간. 오늘은 00:00~현재(부분), 과거일은 하루 전체(00:00~다음날 00:00).
        let targetDay = calendar.date(byAdding: .day, value: Int(dayOffset), to: now) ?? now
        let startOfDay = calendar.startOfDay(for: targetDay)
        let end: Date
        if calendar.isDateInToday(targetDay) {
            end = now
        } else {
            end = calendar.date(byAdding: .day, value: 1, to: startOfDay) ?? now
        }
        let interval = DateInterval(start: startOfDay, end: end)

        // App Group에 저장된 활성 측정 대상(picker로 고른 앱/카테고리)을 읽어
        // 그 토큰들만 집계하도록 필터에 적용 → 판정(threshold)과 동일 기준
        let defaults = UserDefaults(suiteName: "group.com.oneorthree.gromo")
        var selection: FamilyActivitySelection?
        if let data = defaults?.data(forKey: "gromo:goal:selection") {
            selection = try? JSONDecoder().decode(FamilyActivitySelection.self, from: data)
        }

        let filter: DeviceActivityFilter
        if let sel = selection,
           !(sel.applicationTokens.isEmpty
                && sel.categoryTokens.isEmpty
                && sel.webDomainTokens.isEmpty) {
            // 선택한 앱/카테고리만 집계
            filter = DeviceActivityFilter(
                segment: .daily(during: interval),
                users: .all,
                devices: .init([.iPhone]),
                applications: sel.applicationTokens,
                categories: sel.categoryTokens,
                webDomains: sel.webDomainTokens
            )
        } else {
            // 측정 대상 미설정 → 전체 앱 (기존 동작)
            filter = DeviceActivityFilter(
                segment: .daily(during: interval),
                users: .all,
                devices: .init([.iPhone])
            )
        }

        let reportView = DeviceActivityReport(.init(reportContext), filter: filter)
        let hostingVC = UIHostingController(rootView: AnyView(reportView))

        // addSubview 전에 addChild로 VC 계층에 먼저 편입
        parentVC.addChild(hostingVC)

        hostingVC.view.translatesAutoresizingMaskIntoConstraints = false
        hostingVC.view.backgroundColor = .clear
        addSubview(hostingVC.view)

        NSLayoutConstraint.activate([
            hostingVC.view.topAnchor.constraint(equalTo: topAnchor),
            hostingVC.view.leadingAnchor.constraint(equalTo: leadingAnchor),
            hostingVC.view.trailingAnchor.constraint(equalTo: trailingAnchor),
            hostingVC.view.bottomAnchor.constraint(equalTo: bottomAnchor),
        ])

        hostingVC.didMove(toParent: parentVC)
        self.hostingController = hostingVC
    }

    // 이 뷰를 실제로 그리고 있는 UIViewController를 responder chain에서 탐색
    // (React Navigation의 RNSScreenViewController처럼, 이 뷰가 속한
    //  "진짜" 화면 VC를 찾아야 VC 계층/scene hosting이 모두 정상 동작함.
    //  window.rootViewController는 RN 최상위 VC라서 실제 화면 VC와
    //  계층이 안 맞아 addChild 시 NSException이 발생했음)
    private var containerViewController: UIViewController? {
        var responder: UIResponder? = self
        while let r = responder {
            if let vc = r as? UIViewController {
                return vc
            }
            responder = r.next
        }
        return nil
    }
}

// ── 집중 세션 허용앱 목록 (드로어 인라인 표시) ──
// 허용앱 토큰은 opaque라 JS에서 아이콘/이름을 못 그린다 → Label(token)으로 네이티브 렌더.
// App Group의 gromo:focus:allowedSelection을 읽어 개별 앱 토큰만 나열한다.

@available(iOS 16.0, *)
struct AllowedAppsListSwiftUIView: View {
    let tokens: [ApplicationToken]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                ForEach(tokens, id: \.self) { token in
                    Label(token)
                        .labelStyle(.titleAndIcon)
                        .font(.subheadline)
                        .lineLimit(1)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.vertical, 2)
        }
    }
}

@available(iOS 16.0, *)
class AllowedAppsListUIView: UIView {

    private var hostingController: UIHostingController<AnyView>?

    override init(frame: CGRect) {
        super.init(frame: frame)
    }

    required init?(coder: NSCoder) {
        super.init(coder: coder)
    }

    override func didMoveToWindow() {
        super.didMoveToWindow()
        guard window != nil, hostingController == nil else { return }
        guard let parentVC = containerViewController else { return }

        // 저장된 허용앱(개별 앱 토큰) 로드
        let defaults = UserDefaults(suiteName: "group.com.oneorthree.gromo")
        var tokens: [ApplicationToken] = []
        if let data = defaults?.data(forKey: "gromo:focus:allowedSelection"),
           let sel = try? JSONDecoder().decode(FamilyActivitySelection.self, from: data) {
            tokens = Array(sel.applicationTokens)
        }

        let hostingVC = UIHostingController(
            rootView: AnyView(AllowedAppsListSwiftUIView(tokens: tokens))
        )
        parentVC.addChild(hostingVC)
        hostingVC.view.translatesAutoresizingMaskIntoConstraints = false
        hostingVC.view.backgroundColor = .clear
        addSubview(hostingVC.view)
        NSLayoutConstraint.activate([
            hostingVC.view.topAnchor.constraint(equalTo: topAnchor),
            hostingVC.view.leadingAnchor.constraint(equalTo: leadingAnchor),
            hostingVC.view.trailingAnchor.constraint(equalTo: trailingAnchor),
            hostingVC.view.bottomAnchor.constraint(equalTo: bottomAnchor),
        ])
        hostingVC.didMove(toParent: parentVC)
        self.hostingController = hostingVC
    }

    private var containerViewController: UIViewController? {
        var responder: UIResponder? = self
        while let r = responder {
            if let vc = r as? UIViewController {
                return vc
            }
            responder = r.next
        }
        return nil
    }
}
