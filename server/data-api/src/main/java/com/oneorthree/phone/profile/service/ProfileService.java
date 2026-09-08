package com.oneorthree.phone.profile.service;

import com.oneorthree.phone.friend.dto.FriendRelation;
import com.oneorthree.phone.friend.repository.FriendshipRepository;
import com.oneorthree.phone.friend.repository.PinnedUserRepository;
import com.oneorthree.phone.friend.service.FriendRelationLookup;
import com.oneorthree.phone.item.dto.CharacterEquipmentResponse;
import com.oneorthree.phone.item.repository.CharacterEquipmentRepository;
import com.oneorthree.phone.league.repository.LeagueRankingQueryRepository;
import com.oneorthree.phone.league.support.LeagueWeek;
import com.oneorthree.phone.stats.dto.HeatmapCellResponse;
import com.oneorthree.phone.stats.dto.StreakResponse;
import com.oneorthree.phone.stats.dto.TodayStatsResponse;
import com.oneorthree.phone.stats.service.StatsService;
import com.oneorthree.phone.user.repository.domain.StatVisibility;
import com.oneorthree.phone.user.repository.domain.User;
import com.oneorthree.phone.profile.dto.PublicProfileResponse;
import com.oneorthree.phone.profile.dto.UserStatsResponse;
import com.oneorthree.phone.user.exception.UserException;
import com.oneorthree.phone.user.repository.UserQueryService;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/**
 * 타 유저 공개 프로필 조회 서비스 (GROMO-520).
 * 유저·캐릭터·친구·리그 도메인을 READ-only로 집계한다.
 * 티어는 User 에서, 랭킹은 DailyFocusStat 기반 전역 주간 read model 에서 조회한다.
 *
 * <p><b>왜 {@code user/} 가 아니라 {@code profile/} 인가</b> (GROMO-1656). 이 클래스가 하는 일은
 * 유저 한 명을 중심으로 <b>다섯 도메인의 조각을 한 화면 응답으로 조립</b>하는 것이다 —
 * item(장착) · friend(친구 수·관계·핀) · league(주간 랭킹) · stats(스트릭·오늘·히트맵), 그리고 user.
 * 이 조립기가 {@code user/} 안에 있는 동안 <b>계정 도메인이 자기 위의 파생 도메인 넷을 참조</b>했고,
 * 그 넷은 다시 user 를 참조하므로 순환이 넷 생겼다. 조립은 조립되는 것들보다 위에 있어야 한다.
 *
 * <p>그래서 {@code profile} 은 <b>영속성이 없는 도메인</b>이다 — 자기 테이블도 리포지토리도 없고
 * 아래 도메인의 조회 결과만 받아 합친다. 이 자리에 새로 무언가를 저장하고 싶어지면 그것은 이 도메인의
 * 것이 아니라 아래 어느 도메인의 것이다.
 *
 * <p><b>여기 남아 있는 정책 하나</b>: {@code getUserStats} 의 히트맵 공개 게이트(GROMO-640)는 순수
 * 조립이 아니라 판정이다. {@code /stats/*} 에도 같은 취지의 정책이 있어(GROMO-623) 규칙이 두 군데
 * 있을 수 있는데, 두 곳을 하나로 합치는 일은 이 티켓의 범위가 아니라 그대로 옮겨 왔다.
 */
@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class ProfileService {

    private final UserQueryService userQueryService;
    private final CharacterEquipmentRepository characterEquipmentRepository;
    private final FriendshipRepository friendshipRepository;
    private final PinnedUserRepository pinnedUserRepository;
    private final FriendRelationLookup friendRelationLookup;
    private final LeagueRankingQueryRepository leagueRankingQueryRepository;
    private final LeagueWeek leagueWeek;
    private final StatsService statsService;

    /**
     * 대상 유저의 공개 프로필을 조회한다.
     * relation(호출자↔대상 친구 관계)·isPinned(호출자의 핀 여부)를 함께 싣는다 (GROMO-1631).
     * 본인 조회(callerId == userId)는 {@code getUserStats} 선례대로 판정 쿼리를 스킵하고
     * relation=NONE·isPinned=false 를 반환한다.
     *
     * @param callerId 호출자 유저 ID
     * @param userId   조회 대상 유저 ID
     * @return 공개 프로필 응답
     * @throws UserException 대상 유저가 없거나 탈퇴(소프트딜리트)된 경우 NOT_FOUND,
     *                       호출자 본인이 없거나 탈퇴한 경우 USER_NOT_FOUND (GROMO-1655)
     */
    public PublicProfileResponse getPublicProfile(UUID callerId, UUID userId) {
        return getPublicProfile(callerId, userId, Instant.now());
    }

    PublicProfileResponse getPublicProfile(UUID callerId, UUID userId, Instant now) {
        // 탈퇴 유저는 조회 계층이 걸러 404 로 떨어진다 (GROMO-1655).
        User user = userQueryService.getTarget(userId);

        // 캐릭터 장착 목록
        List<CharacterEquipmentResponse> equipments = characterEquipmentRepository.findByUser(user)
                .stream()
                .map(CharacterEquipmentResponse::from)
                .toList();

        // 친구 수 (ACCEPTED, 미삭제, 양방향)
        long friendCount = friendshipRepository.countAcceptedByUser(user);

        // 티어는 users.tier_level 단일 원천에서 조회한다. 신규 유저도 아레나 배정 전부터 T1을 가진다.
        Integer currentTier = user.getTierLevel();

        Integer rank = leagueRankingQueryRepository.findRankOf(
                        userId, leagueWeek.currentWeekStartDate(now), leagueWeek.currentDate(now), now)
                .map(position -> position.rank())
                .orElse(null);

        // 준비 시험 코드 — 미설정(가입 직후 등)이면 null (GROMO-747)
        String occupation = user.getOccupation() != null ? user.getOccupation().name() : null;

        // 본인 조회 → 판정 쿼리 스킵, NONE/false (getUserStats 의 본인 분기 선례, GROMO-1631)
        FriendRelation relation = FriendRelation.NONE;
        boolean isPinned = false;
        if (!callerId.equals(userId)) {
            // 호출자는 조회 계층이 활성 검증까지 맡는다 — 탈퇴한 호출자는 USER_NOT_FOUND (GROMO-1655)
            User caller = userQueryService.getCaller(callerId);
            relation = friendRelationLookup.relationOf(caller, userId);
            isPinned = pinnedUserRepository.findPinnedUserIdsByUserId(callerId).contains(userId);
        }

        return new PublicProfileResponse(
                userId, user.getNickname(), occupation, equipments, friendCount, currentTier, rank,
                relation, isPinned);
    }

    /**
     * 타 유저 통계를 친구 여부에 따라 분기 조회한다 (GROMO-521).
     * 본인 조회(callerId == targetUserId)는 친구 판정 없이 세부 통계를 반환한다.
     * 이때 응답의 isFriend 는 false — isFriend=false 여도 본인 조회면 today/heatmap 이 채워진다.
     * 프로필 요약(streak·today)은 친구 여부/공개설정과 무관하게 항상 반환 (GROMO-746 — 비친구+FRIENDS 도 today 채움).
     * 세부 차트(heatmap)만 공개 게이트를 따름: 본인·친구, 또는 대상이 PUBLIC 이면 반환, 그 외 null
     * (PUBLIC 비친구는 isFriend=false 유지, GROMO-640).
     *
     * @param callerId     호출자 유저 ID
     * @param targetUserId 조회 대상 유저 ID
     * @param date         '오늘'로 삼을 날짜(서버 판정 축 KST 고정). 스트릭의 read-time 만료 반영과
     *                     히트맵 구간([date-6일, date])이 이 값에 걸린다
     * @return 유저 통계 응답
     * @throws UserException 대상 유저가 없거나 탈퇴된 경우 NOT_FOUND,
     *                       호출자 본인이 없거나 탈퇴한 경우 USER_NOT_FOUND (GROMO-1655)
     */
    public UserStatsResponse getUserStats(UUID callerId, UUID targetUserId, LocalDate date) {
        // 탈퇴 유저는 조회 계층이 걸러 404 로 떨어진다 (GROMO-1655).
        User target = userQueryService.getTarget(targetUserId);

        // 본인 조회(callerId == targetUserId) → 세부 취급, 친구 판정 생략
        boolean isOwn = callerId.equals(targetUserId);
        boolean isFriend = false;

        if (!isOwn) {
            // 호출자는 조회 계층이 활성 검증까지 맡는다 — 탈퇴한 호출자는 USER_NOT_FOUND (GROMO-1655)
            User caller = userQueryService.getCaller(callerId);
            // ACCEPTED 양방향 단건 조회 — PENDING 은 친구X 취급
            isFriend = friendshipRepository.findAcceptedBetween(caller, target).isPresent();
        }

        // 프로필 요약(streak·today)은 친구 여부/공개설정과 무관하게 항상 반환 (GROMO-746)
        // 스트릭은 read-time 만료 반영을 위해 date(서버 판정 축 KST 고정 기준 오늘) 를 함께 전달한다 (GROMO-847)
        StreakResponse streak = statsService.getStreak(targetUserId, date);
        TodayStatsResponse today = statsService.getTodayStats(targetUserId, date);

        // 세부 차트(heatmap)만 공개 게이트: 본인·친구, 또는 대상이 전체공개(PUBLIC) (GROMO-640 — 623 의 /stats/* 정책과 정합)
        if (isOwn || isFriend || target.getStatVisibility() == StatVisibility.PUBLIC) {
            // 최근 7일 heatmap — GROMO-643·1259: 서버 판정 축(KST 고정) 날짜(date) 기준
            LocalDate to = date;
            LocalDate from = to.minusDays(6);
            List<HeatmapCellResponse> heatmap = statsService.getHeatmap(targetUserId, from, to);
            return new UserStatsResponse(isFriend, streak, today, heatmap);
        }

        // 비친구 + FRIENDS 공개: heatmap 만 잠금(null)
        return new UserStatsResponse(false, streak, today, null);
    }
}
