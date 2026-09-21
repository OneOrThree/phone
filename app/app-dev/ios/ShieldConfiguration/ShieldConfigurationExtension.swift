import ManagedSettings
import ManagedSettingsUI
import UIKit

final class ShieldConfigurationExtension: ShieldConfigurationDataSource {
    private func focusShield() -> ShieldConfiguration {
        let subject = UserDefaults(suiteName: "group.com.oneorthree.focuscat")?
            .string(forKey: "gromo:focus:shieldSubject") ?? "집중"
        return ShieldConfiguration(
            backgroundBlurStyle: .dark,
            backgroundColor: UIColor(red: 0.12, green: 0.10, blue: 0.16, alpha: 1),
            icon: UIImage(systemName: "fish.fill"),
            title: .init(text: "지금은 집중 시간이에요!", color: .white),
            subtitle: .init(
                text: "\(subject) 집중이 끝날 때까지 이 앱은 잠깐 잠갔어요.",
                color: UIColor(white: 0.82, alpha: 1)
            ),
            primaryButtonLabel: .init(text: "닫기", color: .white),
            primaryButtonBackgroundColor: UIColor(red: 0.86, green: 0.36, blue: 0.50, alpha: 1)
        )
    }

    override func configuration(shielding application: Application) -> ShieldConfiguration {
        focusShield()
    }

    override func configuration(
        shielding application: Application,
        in category: ActivityCategory
    ) -> ShieldConfiguration { focusShield() }

    override func configuration(shielding webDomain: WebDomain) -> ShieldConfiguration {
        focusShield()
    }

    override func configuration(
        shielding webDomain: WebDomain,
        in category: ActivityCategory
    ) -> ShieldConfiguration { focusShield() }
}
