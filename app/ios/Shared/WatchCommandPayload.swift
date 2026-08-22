// WatchCommandPayload.swift
// gromo 메인 앱 + (페이즈 1) 워치 타겟 공용 — ios/Shared는 동기화 그룹이라 양쪽에서 컴파일된다.
//
// 워치→폰 명령의 wire 스키마 v1 (docs/prd/apple-watch/prd.md §4.3).
// 이 티켓(GROMO-1600)에서는 **인박스 스켈레톤**만 세운다: 수신·킬스위치 평가·영속화까지가
// 범위이고, 명령을 실제로 실행하는 라우팅은 페이즈 1에서 붙는다.
//
// 스키마를 지금 고정해 두는 이유: 폰 JS는 OTA로 갱신되지만 워치 바이너리는 아니라
// 구 워치 × 새 폰 조합이 실제로 생긴다(R16 전제). protocolVersion을 **양방향**으로 검사해
// 미지원 명령은 실행하지 않고 「버전 불일치」로 재수렴시킨다.

import Foundation

/// 이 바이너리가 이해하는 wire 버전. 워치가 더 높은 버전을 보내면 실행하지 않는다.
public let kWatchProtocolVersion = 1

/// App Group(UserDefaults) 키 — 네이티브가 쓰고 JS가 드레인한다.
/// 사용량 버킷 파이프라인(DeviceActivityMonitorExtension)과 같은 「네이티브 append → JS drain」 전례.
public enum WatchInboxKeys {
    public static let suiteName = "group.com.oneorthree.gromo"
    /// 수신 명령 대기열(JSON 문자열 배열) — 아직 JS에 배달되지 않은 것
    public static let inbox = "gromo:watch:inbox:v1"
    /// 배달했으나 JS가 처리를 확인(ack)하지 않은 것 — 확인 전에 지우면 브릿지 무효화·프로세스
    /// 종료 창에서 명령이 영구 유실된다(워치는 이미 accepted ACK를 받고 아웃박스를 비웠다).
    /// commandId 멱등성이 있으므로 재배달은 안전하다.
    public static let claimed = "gromo:watch:inbox:claimed:v1"
    /// 킬스위치 — 정본은 이 네이티브 영속 플래그다(policy D13 2차 개정).
    /// OTA는 이 값을 **갱신하는 전달 수단**일 뿐이라, 구 번들로 부팅해도 차단을 우회할 수 없다.
    public static let killSwitch = "gromo:watch:killSwitch"
}

/// 워치→폰 명령. `start`만 focusSessionId가 비는데, 그 시점엔 세션이 아직 없기 때문이다(§4.3).
public struct WatchCommandPayload: Codable {
    public let commandId: String // 멱등 키 — 재전송이 겹쳐도 폰 엔진이 한 번만 실행한다
    public let type: String // "start" | "pause" | "resume" | "end"
    public let protocolVersion: Int
    public let issuedAt: String // ISO8601 — 지연 도착 시 소급 정산의 기준(§4.3)
    public let expiresAt: String? // 만료 폐기 대상은 start·pause·resume. end는 만료 없이 영속 재생
    public let focusSessionId: String? // 폰 엔진이 발급한 로컬 세션 ID(start에는 없다)
    public let accountId: String? // start 전용 — 계정 전환 뒤 남의 세션을 켜지 않도록(§4.3)
    public let subjectId: String? // start 전용
    public let subjectsRevision: Int? // start 전용 — 낡은 과목 목록 발 시작 거절(R5)
    /// pause/resume 전용 — 다른 조작과의 충돌 감지(§4.3). end는 stale revision을 이유로
    /// 거절하지 않으므로(유일한 정확한 종료가 무기한 재생만 하게 된다) 요구하지 않는다.
    public let expectedRevision: Int?

    public init(
        commandId: String,
        type: String,
        protocolVersion: Int,
        issuedAt: String,
        expiresAt: String? = nil,
        focusSessionId: String? = nil,
        accountId: String? = nil,
        subjectId: String? = nil,
        subjectsRevision: Int? = nil,
        expectedRevision: Int? = nil
    ) {
        self.commandId = commandId
        self.type = type
        self.protocolVersion = protocolVersion
        self.issuedAt = issuedAt
        self.expiresAt = expiresAt
        self.focusSessionId = focusSessionId
        self.accountId = accountId
        self.subjectId = subjectId
        self.subjectsRevision = subjectsRevision
        self.expectedRevision = expectedRevision
    }
}

/// 인박스가 명령을 받아들일 때의 판정 — 워치에는 이 결과가 ACK로 돌아간다.
public enum WatchCommandVerdict: String {
    case accepted // 인박스에 적재됨(JS 엔진이 드레인해 실행)
    case killSwitched // 킬스위치로 신규 시작만 차단(R16 3차 개정 — end/pause/resume은 통과)
    case unsupportedVersion // protocolVersion 미지원 — 워치는 「앱 업데이트 필요」로 재수렴
    case malformed // 스키마 위반 — 명령별 필수 필드가 빠졌다(아래 requiredFields 참고)
    /// 대기열이 가득 차 적재하지 못함. **accepted를 주면 안 된다** — 워치가 아웃박스를 비워
    /// 영속 `end`가 사라진다. 워치는 이 판정을 받으면 명령을 보관했다가 재전송한다.
    case queueFull
}

/// 명령별 필수 필드 검증(§4.3). `start`만 focusSessionId를 생략할 수 있고 — 그 시점엔 세션이
/// 없다 — **생략되는 건 그 필드 하나뿐**이다. 여기서 거르지 않으면 워치는 accepted ACK를 받고
/// 아웃박스를 비우는데 엔진은 실행에 필요한 값이 없어 요청이 통째로 유실된다.
public enum WatchCommandSchema {
    public static func isValid(_ raw: [String: Any]) -> Bool {
        // 시각은 **파싱 가능한 ISO 8601**이어야 한다 — 비어 있지만 않으면 통과시키면
        // `not-a-date` 같은 값이 적재되고, JS의 만료 검사는 파싱 실패를 「만료 아님」으로
        // 보므로 그 명령이 사실상 무기한 유효해진다(늦은 start가 세션·실드를 켠다).
        guard
            let type = raw["type"] as? String,
            isISO8601(raw["issuedAt"])
        else { return false }
        switch type {
        case "start":
            // 아래 expiresAt들도 같은 이유로 파싱 가능성까지 본다.
            // 만료가 필수다 — JS 콜드 스타트가 늦으면 워치가 이미 실패로 표시한 뒤 폰이 세션을
            // 켜는 「유령 시작」이 생긴다(§4.3). accountId·과목 목록 revision도 §4.3의 요구:
            // 없으면 라우터가 계정 전환·낡은 목록 발 시작을 판별할 입력 자체가 없다(R5).
            return isISO8601(raw["expiresAt"])
                && nonEmpty(raw["subjectId"])
                && nonEmpty(raw["accountId"])
                && raw["subjectsRevision"] is Int
        case "pause", "resume":
            // 만료 폐기 대상 — expectedRevision은 명령의 나이를 제한하지 못하므로 **둘 다** 필요하다:
            // expiresAt은 나이를, expectedRevision은 다른 조작과의 충돌을 본다(§4.3).
            return isISO8601(raw["expiresAt"])
                && nonEmpty(raw["focusSessionId"])
                && raw["expectedRevision"] is Int
        case "end":
            // 종결 명령은 만료 없이 영속 재생된다 — expiresAt을 요구하지 않는다.
            return nonEmpty(raw["focusSessionId"])
        default:
            return false
        }
    }

    private static func nonEmpty(_ value: Any?) -> Bool {
        guard let s = value as? String else { return false }
        return !s.isEmpty
    }

    /// ISO 8601로 실제 파싱되는지 — 소수 초 유무 둘 다 받는다.
    public static func isISO8601(_ value: Any?) -> Bool {
        guard let s = value as? String, !s.isEmpty else { return false }
        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if withFraction.date(from: s) != nil { return true }
        return ISO8601DateFormatter().date(from: s) != nil
    }
}
