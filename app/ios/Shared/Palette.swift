// ⚠️ 자동 생성 파일 — 직접 수정 금지 (GROMO-641 팔레트 코드젠)
// 단일 소스: app/src/constants/theme.ts 의 T 객체
// 재생성:    app/ 에서 `npm run gen:palette`
// CI 검증:   `npm run gen:palette:check` (불일치 시 실패)

import SwiftUI

private func rgb(_ hex: UInt32) -> Color {
  Color(
    red: Double((hex >> 16) & 0xFF) / 255,
    green: Double((hex >> 8) & 0xFF) / 255,
    blue: Double(hex & 0xFF) / 255
  )
}

// theme.ts의 T와 같은 경로로 참조한다 — 예: T.night.bottom → Palette.night.bottom
enum Palette {
  /// #F4F5F8 — 가장 바깥(페이지) 배경 — 쿨 뉴트럴
  static let bg = rgb(0xF4F5F8)
  /// #FFFFFF — 화면 기본 배경(카드·표면)
  static let paper = rgb(0xFFFFFF)
  /// #FFFFFF — 밝은 카드/표면
  static let paperLight = rgb(0xFFFFFF)
  /// #F5F6F9 — 보조 표면(카드 테두리로도 사용)
  static let paperAlt = rgb(0xF5F6F9)
  /// #EEF0FB — 세그먼트 트랙·아이콘 배경(인디고 틴트)
  static let sandLight = rgb(0xEEF0FB)
  /// #EEF0FB — 아이콘 박스·진행 트랙(인디고 틴트)
  static let caramel = rgb(0xEEF0FB)
  /// #F1F2F8 — 칩·스텝퍼 버튼 배경
  static let chipBg = rgb(0xF1F2F8)
  /// #E3E5EE — 칩 테두리
  static let chipBorder = rgb(0xE3E5EE)
  /// #F1F2F6 — 진행 트랙·중립 행 배경(회색 계열)
  static let track = rgb(0xF1F2F6)
  /// #1C1E22 — 진한 텍스트(제목)
  static let ink = rgb(0x1C1E22)
  /// #667085 — 보조 텍스트
  static let inkSub = rgb(0x667085)
  /// #9AA0A8 — 흐린 텍스트/캡션(팔레트 sub)
  static let inkMuted = rgb(0x9AA0A8)
  /// #AEB4BF — 가장 옅은 텍스트(카드 제목 영문 병기 등)
  static let inkFaint = rgb(0xAEB4BF)
  /// #5E6AD2 — 링크/밑줄
  static let link = rgb(0x5E6AD2)
  /// #EAEBEE — 카드 테두리(팔레트 line)
  static let border = rgb(0xEAEBEE)
  /// #D8DAE2 — 진한 테두리(점선 추가 버튼 등)
  static let borderDark = rgb(0xD8DAE2)
  /// #F1F2F5 — 카드 내부 구분선
  static let divider = rgb(0xF1F2F5)
  /// #1E2340 — 그림자(쿨 인디고-잉크)
  static let shadow = rgb(0x1E2340)
  /// #5E6AD2 — 메인 포인트(인디고)
  static let accent = rgb(0x5E6AD2)
  /// #AFB5E9 — 포인트 그라데이션 밝은 쪽(FAB·팔레트 accent2)
  static let accentLight = rgb(0xAFB5E9)
  /// #C2705A — 보조 포인트(레드·경고·로그아웃)
  static let accentAlt = rgb(0xC2705A)
  /// #4A53B8 — 더 진한 인디고(아이콘·강조 수치)
  static let accentDeep = rgb(0x4A53B8)
  /// #5EA269 — 성공/허용 표시(체크·점)
  static let green = rgb(0x5EA269)
  /// #4E9B5C — 진한 초록(집중 지표 아이콘·차트)
  static let greenDeep = rgb(0x4E9B5C)
  /// #DDE0F3 — 밝은 인디고(아이콘 배경 등)
  static let sand = rgb(0xDDE0F3)
  /// #4C5DE6 — 순위 배지(밝은 인디고)
  static let blue = rgb(0x4C5DE6)
  /// #ECEEFD — 순위 배지 배경
  static let blueBg = rgb(0xECEEFD)
  /// #EEF0FB — 인디고 지표 아이콘 배경
  static let accentBg = rgb(0xEEF0FB)
  /// #FBEEEB — 레드 아이콘 배경(로그아웃 등)
  static let accentAltBg = rgb(0xFBEEEB)
  /// #ECF5EE — 초록 지표 아이콘 배경
  static let greenBg = rgb(0xECF5EE)
  /// #4A7A54 — 긍정 수치 텍스트
  static let successInk = rgb(0x4A7A54)
  /// #F0F7F1 — 긍정 카드 배경
  static let successBg = rgb(0xF0F7F1)
  /// #D6E9DA
  static let successBorder = rgb(0xD6E9DA)
  /// #C25F52 — 경고 텍스트
  static let dangerInk = rgb(0xC25F52)
  /// #B04C41 — 작은 오류 동작 텍스트 — paperAlt에서도 WCAG AA 대비 확보
  static let dangerInkStrong = rgb(0xB04C41)
  /// #FBEFEC — 경고 카드 배경
  static let dangerBg = rgb(0xFBEFEC)
  /// #F3D9D4
  static let dangerBorder = rgb(0xF3D9D4)
  /// #E8452C — 스트릭 불꽃 아이콘(연속 공부, GROMO-630)
  static let flame = rgb(0xE8452C)
  /// #EEF0FB — 안내(인포) 박스 배경(인디고 틴트)
  static let noteBg = rgb(0xEEF0FB)
  /// #DDE0F3
  static let noteBorder = rgb(0xDDE0F3)
  /// #5E6AD2 · #C2705A · #6FA15A · #5E9C8D · #6C86B3 · #9A7FAE
  static let subjectPalette: [Color] = [rgb(0x5E6AD2), rgb(0xC2705A), rgb(0x6FA15A), rgb(0x5E9C8D), rgb(0x6C86B3), rgb(0x9A7FAE)]
  enum medal {
    /// #E0A83F
    static let gold = rgb(0xE0A83F)
    /// #B8B0A3
    static let silver = rgb(0xB8B0A3)
    /// #C58F5A
    static let bronze = rgb(0xC58F5A)
  }
  enum medalGrad {
    /// #F7D97E · #D9962A
    static let gold: [Color] = [rgb(0xF7D97E), rgb(0xD9962A)]
    /// #DCD6CC · #A69D90
    static let silver: [Color] = [rgb(0xDCD6CC), rgb(0xA69D90)]
    /// #E2AE7E · #B37845
    static let bronze: [Color] = [rgb(0xE2AE7E), rgb(0xB37845)]
  }
  enum compare {
    /// #9A6FB0
    static let theirs = rgb(0x9A6FB0)
    /// #B08FC4
    static let theirsPhone = rgb(0xB08FC4)
    /// #C4C8D4
    static let avg = rgb(0xC4C8D4)
  }
  /// #EEF0FB · #D9DDF5 · #B4BAEC · #8A93E0 · #5E6AD2
  static let calendarRamp: [Color] = [rgb(0xEEF0FB), rgb(0xD9DDF5), rgb(0xB4BAEC), rgb(0x8A93E0), rgb(0x5E6AD2)]
  /// #5E6AD2 · #9A6FB0 · #5B8A6A · #7A8AA0 · #6A9AA0 · #B0607A
  static let avatarPalette: [Color] = [rgb(0x5E6AD2), rgb(0x9A6FB0), rgb(0x5B8A6A), rgb(0x7A8AA0), rgb(0x6A9AA0), rgb(0xB0607A)]
  /// #7FA06A · #6E8FB0 · #5E6AD2 · #9C7BB0
  static let appPalette: [Color] = [rgb(0x7FA06A), rgb(0x6E8FB0), rgb(0x5E6AD2), rgb(0x9C7BB0)]
  /// #FEE500
  static let kakao = rgb(0xFEE500)
  /// #3C1E1E
  static let kakaoInk = rgb(0x3C1E1E)
  /// #3C3C3C — 흰 버튼 위 텍스트(구글·메타)
  static let grayInk = rgb(0x3C3C3C)
  enum night {
    /// #2A2E45 — 배경 그라데이션 위
    static let top = rgb(0x2A2E45)
    /// #1A1D2E — 배경 그라데이션 아래·베이스
    static let bottom = rgb(0x1A1D2E)
    /// #D9DCF0 — 크림 텍스트(과목명) — 쿨 라이트
    static let cream = rgb(0xD9DCF0)
    /// #8B90A8 — 보조 텍스트
    static let muted = rgb(0x8B90A8)
    /// #B7BCF0 — 포인트(도트·세트 배지) — 라이트 인디고
    static let gold = rgb(0xB7BCF0)
    /// #7FCB8E — 친구 집중중 표시(의미색 유지)
    static let green = rgb(0x7FCB8E)
    /// #9FE0AC — 배너 텍스트
    static let greenSoft = rgb(0x9FE0AC)
    /// #2E3250 — 별사탕 아바타 얼굴
    static let face = rgb(0x2E3250)
  }
  /// #FFFFFF
  static let white = rgb(0xFFFFFF)
  /// #000000
  static let black = rgb(0x000000)
  /// #171826 — 베젤/강조 어두운 면(쿨)
  static let dark = rgb(0x171826)
}
