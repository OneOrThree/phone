package com.oneorthree.phone.user.service;

import com.oneorthree.phone.friend.repository.FriendshipRepository;
import com.oneorthree.phone.item.dto.CharacterEquipmentResponse;
import com.oneorthree.phone.item.repository.CharacterEquipmentRepository;
import com.oneorthree.phone.league.domain.LeagueArenaStatus;
import com.oneorthree.phone.league.domain.LeagueArenaUser;
import com.oneorthree.phone.league.repository.LeagueArenaUserRepository;
import com.oneorthree.phone.stats.dto.HeatmapCellResponse;
import com.oneorthree.phone.stats.dto.StreakResponse;
import com.oneorthree.phone.stats.dto.TodayStatsResponse;
import com.oneorthree.phone.stats.service.StatsService;
import com.oneorthree.phone.user.domain.User;
import com.oneorthree.phone.user.dto.PublicProfileResponse;
import com.oneorthree.phone.user.dto.UserStatsResponse;
import com.oneorthree.phone.user.exception.UserErrorCode;
import com.oneorthree.phone.user.exception.UserException;
import com.oneorthree.phone.user.repository.UserRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * 타 유저 공개 프로필 조회 서비스 (GROMO-520).
 * 유저·캐릭터·친구·리그 도메인을 READ-only로 집계한다.
 * LeagueService 수정 없이 LeagueArenaUserRepository 를 직접 사용한다.
 */
@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class ProfileService {

    private final UserRepository userRepository;
    private final CharacterEquipmentRepository characterEquipmentRepository;
    private final FriendshipRepository friendshipRepository;
    private final LeagueArenaUserRepository leagueArenaUserRepository;
    private final StatsService statsService;

    /**
     * 대상 유저의 공개 프로필을 조회한다.
     *
     * @param userId 조회 대상 유저 ID
     * @return 공개 프로필 응답
     * @throws UserException 유저가 없거나 탈퇴(소프트딜리트)된 경우 NOT_FOUND
     */
    public PublicProfileResponse getPublicProfile(UUID userId) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new UserException(UserErrorCode.NOT_FOUND));

        // 소프트딜리트된 유저(탈퇴) → 404
        if (user.getDeletedAt() != null) {
            throw new UserException(UserErrorCode.NOT_FOUND);
        }

        // 캐릭터 장착 목록
        List<CharacterEquipmentResponse> equipments = characterEquipmentRepository.findByUser(user)
                .stream()
                .map(CharacterEquipmentResponse::from)
                .toList();

        // 친구 수 (ACCEPTED, 미삭제, 양방향)
        long friendCount = friendshipRepository.countAcceptedByUser(user);

        // ACTIVE 리그 멤버십 조회
        Optional<LeagueArenaUser> membershipOpt =
                leagueArenaUserRepository.findByUserAndArenaStatus(userId, LeagueArenaStatus.ACTIVE);

        Integer currentTier;
        Integer rank;

        if (membershipOpt.isPresent()) {
            LeagueArenaUser member = membershipOpt.get();
            // 리그 멤버십 tierLevel 우선 (LeagueService#getMyTier 와 동일 원천)
            currentTier = member.getTierLevel();
            // 랭킹 산출: 정렬 리스트에서 본인 인덱스+1 (LeagueService#getMyRank 와 동일 순회 로직).
            // LeagueService#getMyRank 는 ACTIVE 멤버가 findRankedByArena 결과에 없으면 IllegalStateException 을 던지지만,
            // 공개 프로필 API 에서는 데이터 정합성 오류 시 500 을 내리는 대신 rank=null 을 반환하는 방어적 처리를 의도적으로 선택한다.
            List<LeagueArenaUser> ranked =
                    leagueArenaUserRepository.findRankedByArena(member.getLeagueArena());
            rank = null;
            for (int i = 0; i < ranked.size(); i++) {
                if (ranked.get(i).getUser().getId().equals(userId)) {
                    rank = i + 1;
                    break;
                }
            }
        } else {
            // 리그 미소속 → User.currentTier fallback (미설정 시 null)
            currentTier = user.getCurrentTier();
            rank = null;
        }

        return new PublicProfileResponse(userId, user.getNickname(), equipments, friendCount, currentTier, rank);
    }

    /**
     * 타 유저 통계를 친구 여부에 따라 분기 조회한다 (GROMO-521).
     * 본인 조회(callerId == targetUserId)는 친구 판정 없이 세부 통계를 반환한다.
     * 이때 응답의 isFriend 는 false — isFriend=false 여도 본인 조회면 today/heatmap 이 채워진다.
     * 친구X(PENDING 포함): streak 만 반환. 친구O: today·streak·heatmap 전체 반환.
     *
     * @param callerId     호출자 유저 ID
     * @param targetUserId 조회 대상 유저 ID
     * @return 유저 통계 응답
     * @throws UserException 대상 유저가 없거나 탈퇴된 경우 NOT_FOUND
     */
    public UserStatsResponse getUserStats(UUID callerId, UUID targetUserId) {
        User target = userRepository.findById(targetUserId)
                .orElseThrow(() -> new UserException(UserErrorCode.NOT_FOUND));

        // 소프트딜리트된 유저(탈퇴) → 404
        if (target.getDeletedAt() != null) {
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

        // 스트릭은 친구 여부와 무관하게 항상 반환
        StreakResponse streak = statsService.getStreak(targetUserId);

        if (isOwn || isFriend) {
            // 세부 통계: today + streak + 최근 7일 heatmap
            TodayStatsResponse today = statsService.getTodayStats(targetUserId);
            LocalDate to = LocalDate.now(ZoneOffset.UTC);
            LocalDate from = to.minusDays(6);
            List<HeatmapCellResponse> heatmap = statsService.getHeatmap(targetUserId, from, to);
            return new UserStatsResponse(isFriend, streak, today, heatmap);
        }

        // 간단 통계: streak 만 반환, today/heatmap null
        return new UserStatsResponse(false, streak, null, null);
    }
}
