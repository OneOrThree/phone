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

        setupHostingController()
    }

    private func setupHostingController() {
        let calendar = Calendar.current
        let now = Date()
        let startOfDay = calendar.startOfDay(for: now)

        let filter = DeviceActivityFilter(
            segment: .daily(during: DateInterval(start: startOfDay, end: now)),
            users: .all,
            devices: .init([.iPhone])
        )

        let reportView = DeviceActivityReport(.init("Total Activity"), filter: filter)
        let hostingVC = UIHostingController(rootView: AnyView(reportView))

        hostingVC.view.translatesAutoresizingMaskIntoConstraints = false
        hostingVC.view.backgroundColor = .clear
        addSubview(hostingVC.view)

        NSLayoutConstraint.activate([
            hostingVC.view.topAnchor.constraint(equalTo: topAnchor),
            hostingVC.view.leadingAnchor.constraint(equalTo: leadingAnchor),
            hostingVC.view.trailingAnchor.constraint(equalTo: trailingAnchor),
            hostingVC.view.bottomAnchor.constraint(equalTo: bottomAnchor),
        ])

        self.hostingController = hostingVC
    }
}
