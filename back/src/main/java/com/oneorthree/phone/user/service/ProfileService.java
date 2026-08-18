package com.oneorthree.phone.user.service;

import com.oneorthree.phone.friend.repository.FriendshipRepository;
import com.oneorthree.phone.item.dto.CharacterEquipmentResponse;
import com.oneorthree.phone.item.repository.CharacterEquipmentRepository;
import com.oneorthree.phone.league.repository.LeagueRankingQueryRepository;
import com.oneorthree.phone.league.service.LeagueWeek;
import com.oneorthree.phone.stats.dto.HeatmapCellResponse;
import com.oneorthree.phone.stats.dto.StreakResponse;
import com.oneorthree.phone.stats.dto.TodayStatsResponse;
import com.oneorthree.phone.stats.service.StatsService;
import com.oneorthree.phone.user.domain.StatVisibility;
import com.oneorthree.phone.user.domain.User;
import com.oneorthree.phone.user.dto.PublicProfileResponse;
import com.oneorthree.phone.user.dto.UserStatsResponse;
import com.oneorthree.phone.user.exception.UserErrorCode;
import com.oneorthree.phone.user.exception.UserException;
import com.oneorthree.phone.user.repository.UserRepository;
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
 */
@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class ProfileService {

    private final UserRepository userRepository;
    private final CharacterEquipmentRepository characterEquipmentRepository;
    private final FriendshipRepository friendshipRepository;
    private final LeagueRankingQueryRepository leagueRankingQueryRepository;
    private final LeagueWeek leagueWeek;
    private final StatsService statsService;

    /**
     * 대상 유저의 공개 프로필을 조회한다.
     *
     * @param userId 조회 대상 유저 ID
     * @return 공개 프로필 응답
     * @throws UserException 유저가 없거나 탈퇴(소프트딜리트)된 경우 NOT_FOUND
     */
    public PublicProfileResponse getPublicProfile(UUID userId) {
        return getPublicProfile(userId, Instant.now());
    }

    PublicProfileResponse getPublicProfile(UUID userId, Instant now) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new UserException(UserErrorCode.NOT_FOUND));

        // 소프트딜리트된 유저(탈퇴) → 404
        if (user.isDeleted()) {
            throw new UserException(UserErrorCode.NOT_FOUND);
        }

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

        return new PublicProfileResponse(
                userId, user.getNickname(), occupation, equipments, friendCount, currentTier, rank);
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
     * @return 유저 통계 응답
     * @throws UserException 대상 유저가 없거나 탈퇴된 경우 NOT_FOUND
     */
    public UserStatsResponse getUserStats(UUID callerId, UUID targetUserId, LocalDate date) {
        User target = userRepository.findById(targetUserId)
                .orElseThrow(() -> new UserException(UserErrorCode.NOT_FOUND));

        // 소프트딜리트된 유저(탈퇴) → 404
        if (target.isDeleted()) {
            throw new UserException(UserErrorCode.NOT_FOUND);
        }

        // 본인 조회(callerId == targetUserId) → 세부 취급, 친구 판정 생략
        boolean isOwn = callerId.equals(targetUserId);
        boolean isFriend = false;

        if (!isOwn) {
            User caller = userRepository.findById(callerId)
                    .orElseThrow(() -> new UserException(UserErrorCode.NOT_FOUND));
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
