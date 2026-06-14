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
//   3. 화면에 오늘의 스크린 타임 데이터가 표시됨

import UIKit
import SwiftUI
import DeviceActivity  // DeviceActivityReport, DeviceActivityFilter 사용

@available(iOS 16.0, *)
class ScreenTimeReportUIView: UIView {

    private var hostingController: UIHostingController<AnyView>?

    // RN에서 prop으로 전달하는 DeviceActivityReport.Context 이름
    // 예: "Total Activity"(기본, ScreenTimeScreen), "Compact Activity"(HomeScreen "사용" StatBox)
    @objc var reportContext: String = "Total Activity"

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
        let startOfDay = calendar.startOfDay(for: now)

        let filter = DeviceActivityFilter(
            segment: .daily(during: DateInterval(start: startOfDay, end: now)),
            users: .all,
            devices: .init([.iPhone])
        )

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
