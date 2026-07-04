package com.oneorthree.phone.notification.service;

import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.junit.jupiter.MockitoExtension;

/**
 * 리그 알림 트리거 테스트 (GROMO-528 커밋④) — 고정 Instant 주입(412/519 선례).
 */
@ExtendWith(MockitoExtension.class)
class LeagueNotificationServiceTest {

    // TODO GROMO-528 커밋④: @Mock — LeagueArenaRepository, LeagueArenaUserRepository,
    //   UserNotificationSettingsRepository, PushNotificationService / @InjectMocks LeagueNotificationService

    // TODO GROMO-528 커밋④: 케이스 목록 (스펙 테스트 절)
    //   - ① result=PROMOTED 멤버 → 제목 "🎉 우리 승격했어 !" + {상위티어}=tierLevel+1 티어명 + link gromo://league
    //   - ② result=RELEGATED 멤버 → {하위티어}=tierLevel−1 티어명 + link gromo://focus
    //   - STAY/RELEGATE_WARNING/result null 멤버 미발송 (쿼리 인자 검증)
    //   - prevWeekStart 산정: 월 09:00 KST 기준 now → 7일 전 월요일 00:00 KST (repository 인자 ArgumentCaptor)
    //   - ⑥ 아레나 2개(각 N명) → 전원 발송 + 각자 {내순위} = findRankedByArena 순서 index+1
    //   - ⑥ ACTIVE 아레나 없음 → 무발송·정상 종료
    //   - 설정 일괄 로드: findAllById 1회 호출 검증 (유저별 단건 조회 없음)
    //   - 티어명 클램프: 범위 밖 레벨 방어 클램프 동작 (배치 보정상 발생 불가지만 방어)
    // TODO GROMO-528 커밋④ (선택): RepositoryTestBase 기반 findEndedByWeekStartAndResultIn 쿼리 검증
    //   — ENDED+주차 일치+result IN 필터, 다른 주차/ACTIVE 제외 (LeagueBatchServiceTest 선례)
}
