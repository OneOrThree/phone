// WatchSessionModule.swift
// gromo 메인 앱 타겟
//
// 역할: 워치 관련 네이티브 기능을 JS에 노출하는 브릿지. **상태는 여기 없다** —
//       WCSession delegate와 명령 인박스는 WatchCommandInbox 싱글턴이 소유하고
//       (docs/prd/apple-watch/ D2-④), 이 모듈은 그 싱글턴에 위임만 한다.
//
//       delegate를 싱글턴으로 옮긴 이유: WCSession.default의 delegate는 앱 전역에서
//       하나뿐인데 RCT 모듈은 브릿지가 JS를 띄우면서 늦게 인스턴스화된다. 종료 상태에서
//       WCSession이 앱을 깨우는 경우 명령이 delegate보다 먼저 도착해 사라진다.
//
// 사용 방법 (JS에서):
//   const { WatchSessionModule } = NativeModules;
//   await WatchSessionModule.getPairingStatus();   // { supported, paired, watchAppInstalled }
//   await WatchSessionModule.drainWatchCommands(); // string[] — 수신 명령 JSON, 읽고 비운다
//   await WatchSessionModule.setWatchKillSwitch(true);

import Foundation

@objc(WatchSessionModule)
class WatchSessionModule: NSObject {

    @objc static func moduleName() -> String {
        return "WatchSessionModule"
    }

    @objc static func requiresMainQueueSetup() -> Bool {
        return false
    }

    /// 워치 페어링 상태(GROMO-1598 보급률 계측).
    @objc func getPairingStatus(
        _ resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        WatchCommandInbox.shared.pairingStatus { payload, error in
            if let payload {
                resolve(payload)
            } else {
                reject("watch_session_unavailable",
                       error?.localizedDescription ?? "WCSession unavailable", error)
            }
        }
    }

    /// 인박스 드레인 — 수신 명령 JSON 문자열 배열을 돌려주고 대기열을 비운다.
    /// 실행(라우팅)은 JS 엔진 몫이고, 여기서는 전달만 한다.
    @objc func drainWatchCommands(
        _ resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        resolve(WatchCommandInbox.shared.drain())
    }

    /// 처리 확인 — JS가 실제로 소비한 명령만 지운다. 확인 전까지는 claim 상태로 남아
    /// 다음 드레인에 재배달된다(브릿지 무효화·프로세스 종료 창의 유실 방지).
    @objc func ackWatchCommands(
        _ commandIds: [String],
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        WatchCommandInbox.shared.ack(commandIds: commandIds)
        resolve(nil)
    }

    /// 킬스위치 조회/설정 — 정본은 App Group의 네이티브 플래그다(policy D13 2차 개정).
    /// OTA는 이 값을 갱신하는 전달 수단일 뿐이라 구 번들 부팅이 차단을 우회하지 못한다.
    @objc func getWatchKillSwitch(
        _ resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        resolve(WatchCommandInbox.shared.killSwitchEnabled)
    }

    @objc func setWatchKillSwitch(
        _ enabled: Bool,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        WatchCommandInbox.shared.killSwitchEnabled = enabled
        resolve(nil)
    }

    /// **디버그 전용** — 워치 앱이 아직 없어 실 WCSession 수신을 태울 수 없으므로,
    /// 인박스 경로(판정·영속화·드레인)를 손으로 검증하는 유일한 수단이다.
    /// 페이즈 1에서 실기기 검증이 붙으면 제거를 재검토한다.
    @objc func debugEnqueueWatchCommand(
        _ json: String,
        resolver resolve: @escaping RCTPromiseResolveBlock,
        rejecter reject: @escaping RCTPromiseRejectBlock
    ) {
        guard
            let data = json.data(using: .utf8),
            let raw = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else {
            reject("watch_command_malformed", "command JSON is not an object", nil)
            return
        }
        resolve(WatchCommandInbox.shared.ingest(raw))
    }
}
