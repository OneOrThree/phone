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
    /// 수신 명령 대기열(JSON 문자열 배열)
    public static let inbox = "gromo:watch:inbox:v1"
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
    public let subjectId: String? // start 전용
    public let subjectsRevision: Int? // start 전용 — 낡은 과목 목록 발 시작 거절(R5)

    public init(
        commandId: String,
        type: String,
        protocolVersion: Int,
        issuedAt: String,
        expiresAt: String? = nil,
        focusSessionId: String? = nil,
        subjectId: String? = nil,
        subjectsRevision: Int? = nil
    ) {
        self.commandId = commandId
        self.type = type
        self.protocolVersion = protocolVersion
        self.issuedAt = issuedAt
        self.expiresAt = expiresAt
        self.focusSessionId = focusSessionId
        self.subjectId = subjectId
        self.subjectsRevision = subjectsRevision
    }
}

/// 인박스가 명령을 받아들일 때의 판정 — 워치에는 이 결과가 ACK로 돌아간다.
public enum WatchCommandVerdict: String {
    case accepted // 인박스에 적재됨(JS 엔진이 드레인해 실행)
    case killSwitched // 킬스위치로 신규 시작만 차단(R16 3차 개정 — end/pause/resume은 통과)
    case unsupportedVersion // protocolVersion 미지원 — 워치는 「앱 업데이트 필요」로 재수렴
    case malformed // 스키마 위반
}
