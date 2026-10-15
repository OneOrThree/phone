//
//  ShieldConfigurationExtension.swift
//  ShieldConfiguration
//
//  Created by Taehwa Kown on 6/27/26.
//

import ManagedSettings
import ManagedSettingsUI
import SwiftUI
import UIKit

// 집중 세션 가림막(GROMO-553) — 세션 중 비허용앱을 열면 OS가 이 구성으로 가림막을 띄운다.
// iOS 제약상 자유 UI는 불가하고 배경·아이콘·제목/부제·버튼(라벨/색)만 커스터마이즈 가능.
// 색은 theme.ts에서 자동 생성된 Shared/Palette.swift를 참조한다 (GROMO-641).
// TODO: Claude Design 시안 17번 확정되면 문구·색 보정.

private let appGroupId = "group.com.oneorthree.gromo"

// 세션 화면과 같은 다크 배경
private let shieldBg = UIColor(Palette.night.bottom)
// 제목
private let shieldCream = UIColor(Palette.night.cream)
// 부제
private let shieldMuted = UIColor(Palette.night.muted)
// 버튼
private let shieldAccent = UIColor(Palette.accent)

class ShieldConfigurationExtension: ShieldConfigurationDataSource {

    // 공통 가림막 — 과목명은 세션 시작 시 메인 앱이 App Group에 기록한 값을 읽는다.
    // 아이콘은 캐릭터 스냅샷(세션 시작 시 App Group 컨테이너에 저장) 있으면 사용.
    private func focusShield() -> ShieldConfiguration {
        let defaults = UserDefaults(suiteName: appGroupId)
        let subject = defaults?.string(forKey: "gromo:focus:shieldSubject") ?? "집중"

        var icon: UIImage?
        if let container = FileManager.default.containerURL(
            forSecurityApplicationGroupIdentifier: appGroupId
        ) {
            let path = container.appendingPathComponent("focusCharacter.png").path
            icon = UIImage(contentsOfFile: path)
        }

        return ShieldConfiguration(
            backgroundBlurStyle: .dark,
            backgroundColor: shieldBg,
            icon: icon,
            title: ShieldConfiguration.Label(text: "지금은 집중 시간이에요!", color: shieldCream),
            subtitle: ShieldConfiguration.Label(
                text: "\(subject) 집중이 끝날 때까지\n이 앱은 잠깐 잠갔어요. 얼른 돌아오세요!",
                color: shieldMuted
            ),
            primaryButtonLabel: ShieldConfiguration.Label(text: "닫기", color: .white),
            primaryButtonBackgroundColor: shieldAccent
        )
    }

    override func configuration(shielding application: Application) -> ShieldConfiguration {
        focusShield()
    }

    override func configuration(
        shielding application: Application, in category: ActivityCategory
    ) -> ShieldConfiguration {
        focusShield()
    }

    override func configuration(shielding webDomain: WebDomain) -> ShieldConfiguration {
        focusShield()
    }

    override func configuration(
        shielding webDomain: WebDomain, in category: ActivityCategory
    ) -> ShieldConfiguration {
        focusShield()
    }
}
