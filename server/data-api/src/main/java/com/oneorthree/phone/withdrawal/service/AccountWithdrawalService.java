package com.oneorthree.phone.withdrawal.service;

import com.oneorthree.phone.appearance.service.AppearanceService;
import com.oneorthree.phone.auth.service.AuthSessionService;
import com.oneorthree.phone.character.service.CharacterGenerationService;
import com.oneorthree.phone.focus.repository.FocusSessionDetailRepository;
import com.oneorthree.phone.focus.repository.FocusSessionIntervalRepository;
import com.oneorthree.phone.focus.service.FocusService;
import com.oneorthree.phone.friend.service.FriendService;
import com.oneorthree.phone.group.exception.GroupException;
import com.oneorthree.phone.group.service.GroupMemberService;
import com.oneorthree.phone.invitelink.service.InviteLinkMatchService;
import com.oneorthree.phone.item.service.EquipmentService;
import com.oneorthree.phone.league.service.LeagueService;
import com.oneorthree.phone.notification.service.RankOvertakeNotificationService;
import com.oneorthree.phone.outbox.service.PublicCommandService;
import com.oneorthree.phone.quest.service.IslandQuestService;
import com.oneorthree.phone.screentime.service.ScreenTimeService;
import com.oneorthree.phone.stats.service.StatsService;
import com.oneorthree.phone.user.exception.UserException;
import com.oneorthree.phone.user.repository.UserQueryService;
import com.oneorthree.phone.user.dto.DeviceTokenDeletionRequest;
import com.oneorthree.phone.user.repository.domain.User;
import com.oneorthree.phone.user.service.UserSatelliteCommandService;
import com.oneorthree.phone.user.service.UserService;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.UUID;

/**
 * 회원 탈퇴 오케스트레이션 — 도메인별 정리·파기를 <b>정해진 순서로</b> 부른다 (GROMO-1656 · 파기 확장 GROMO-1801).
 *
 * <p><b>이 클래스가 존재하는 이유.</b> 탈퇴는 계정·그룹·집중·통계·스크린타임·친구를 모두 정리하는
 * 일인데, 종전엔 그 전부가 {@code UserService.withdraw} 한 메서드(90줄) 안에 펼쳐져 있었다.
 * 그래서 <b>가장 아래 도메인인 user 가 자기 위의 다섯 도메인을 참조</b>했고(역행 11건), 그 다섯이
 * 다시 user 를 참조하므로 순환이 다섯 생겼다. 정리하는 방법은 각 도메인이 알고, <b>정리하는
 * 순서는 그 위에서 정한다</b>.
 *
 * <p><b>왜 이벤트가 아닌가.</b> 이 절차는 「단계 순서가 곧 정합성」이다 — 아래 순서 제약 셋이
 * 깨지면 돈이 소각되거나 변경이 조용히 유실된다. 이벤트로 뒤집으면 그 순서가 <b>리스너 등록
 * 순서</b>에 숨어, 리스너 하나가 추가되는 것만으로 순서가 바뀌고 컴파일도 테스트도 잡아 주지
 * 못한다. 순서가 계약인 절차는 순서가 보이는 곳에 둔다.
 *
 * <p><b>깨지면 안 되는 순서 제약 셋</b> (각 도메인 메서드의 주석에도 같은 내용이 적혀 있다):
 * <ol>
 *   <li>그룹 정리(내기 해제 환불) → <b>지갑 삭제</b>. 뒤집으면 환불이 {@code NOT_FOUND} 로 터진다</li>
 *   <li>그룹 정리(판정 근거 박제) → <b>집중·통계 익명화</b>. 뒤집으면 박제할 근거가 이미 사라졌다</li>
 *   <li><b>개인정보 파기·소셜 삭제는 맨 끝</b>. 소셜 벌크 DELETE 가 영속성 컨텍스트를 비우므로
 *       그 뒤의 엔티티 변경은 전부 조용히 유실된다</li>
 * </ol>
 *
 * <p>친구 정리가 늦은 자리에 있는 것은 정합성이 아니라 <b>락 보유 구간</b> 때문이다 —
 * {@code friendships} N 행에 배타 락을 걸므로 관계와 무관한 정리를 먼저 끝낸다. 대상 테이블이
 * 겹치지 않아 결과 자체는 순서와 무관하지만, 종전 동작을 그대로 두려고 자리를 지켰다.
 *
 * <p>전 단계가 <b>한 트랜잭션</b>이다. 중간에 {@code HOST_WITHDRAW} 가 던져지면 앞선 그룹 자동
 * 종료까지 통째로 롤백된다 — 「탈퇴는 실패했는데 그룹만 닫힌」 반쪽 상태가 생기지 않는다.
 */
@Service
@RequiredArgsConstructor
public class AccountWithdrawalService {

    private final UserQueryService userQueryService;
    private final GroupMemberService groupMemberService;
    private final FocusService focusService;
    private final FocusSessionDetailRepository focusSessionDetailRepository;
    private final FocusSessionIntervalRepository focusSessionIntervalRepository;
    private final StatsService statsService;
    private final ScreenTimeService screenTimeService;
    private final UserService userService;
    private final FriendService friendService;
    private final AuthSessionService authSessionService;
    private final UserSatelliteCommandService userSatelliteCommandService;
    private final WithdrawalSatelliteCommandService withdrawalSatelliteCommandService;
    private final InviteLinkMatchService inviteLinkMatchService;
    private final RankOvertakeNotificationService rankOvertakeNotificationService;
    private final LeagueService leagueService;
    private final CharacterGenerationService characterGenerationService;
    private final EquipmentService equipmentService;
    private final PublicCommandService publicCommandService;
    private final AppearanceService appearanceService;
    private final IslandQuestService islandQuestService;

    /**
     * 회원 탈퇴 — 행을 지우지 않고 PII 를 파기한 뒤 비활성 표시를 한다.
     *
     * <p>혼자 있는 소유 그룹은 자동 종료되지만, 다른 멤버가 남은 그룹의 방장이면 위임 전까지
     * 탈퇴할 수 없다.
     *
     * @param userId 탈퇴할 본인. 이미 탈퇴했거나 없으면 404
     * @throws UserException  대상이 없거나 이미 탈퇴한 경우 {@code NOT_FOUND}
     * @throws GroupException 위임하지 않은 방장 그룹이 남아 있을 때 {@code HOST_WITHDRAW}
     */
    @Transactional
    public void withdraw(UUID userId) {
        // 배타 락으로 로드 (GROMO-801) — 아래 소셜 관계 정리와 새 관계 생성(친구 요청·핀)을 직렬화한다.
        // 락이 없으면 READ COMMITTED 에서 정리 스캔 이후·커밋 이전에 낀 요청이 정리를 빠져나가 유령으로 남는다.
        User user = userQueryService.getCallerForUpdate(userId);
        // 챌린지 생성은 그룹을 잠근 채 커밋 전 수신자 USER outbox를 적는다. 그 반대 순서를
        // 만들지 않도록 세션 폐기·USER 버전 발급 전에 모든 관련 그룹을 UUID 순서로 선점한다.
        groupMemberService.lockGroupsForAccountWithdrawal(user);
        // 정산은 회차 행 → (BEFORE_COMMIT) 참가자 USER 순서로 잠근다. 아래 세션 폐기가 USER(탈퇴자)를 쥔 뒤
        // 내기 해제에서야 회차 행을 기다리면 정산과 AB-BA 로 교착한다 — 그룹과 같이 USER 보다 먼저 잠근다(GROMO-893).
        groupMemberService.lockOpenBetSessionsForAccountWithdrawal(user);

        // ── 위성 경계 정리 (A22 ⓐ · ㊼ · ㊹ · ㊲) ──────────────────────────────
        // 여기가 «같은 트랜잭션»이어야 하는 이유: tombstone·세션 폐기·토큰 삭제가 커밋과 갈라지면,
        // 그 사이 도착한 지연 등록·지연 claim 이 이미 탈퇴한 계정에 들러붙는다(최대 AT 수명 3600초).
        //
        // 세대는 «탈퇴·전 기기 로그아웃»에만 오른다(㊼). 탈퇴는 그 둘 중 하나다.
        long authGeneration = user.bumpAuthGeneration();
        // 전 세션 폐기 — 개별 로그아웃과 달리 여기서는 유저의 모든 세션이 끝난다(㋞).
        authSessionService.revokeAll(userId, "WITHDRAW");
        // 올라간 세대는 삭제 명령과 «별개 사건»으로 전달한다(㊹) — 삭제 봉투에는 증가 전 세대만
        // 담기므로, 그것만 보내면 지연 등록이 「같은 세대」로 수락돼 토큰이 되살아난다.
        authSessionService.publishGenerationBumped(userId, authGeneration, "WITHDRAW");
        // 기기 토큰 삭제는 «지금» 적는다 — 아래 erasePersonalData 가 토큰을 지우고 나면 어떤 토큰을
        // 지워야 하는지 알 수 없어 계약대로 된 명령을 만들 수 없다(㊨ · ㊪).
        userSatelliteCommandService.recordDeviceTokenDeletion(
                userId,
                new DeviceTokenDeletionRequest(user.getDeviceToken(), null, authGeneration),
                "withdraw:" + userId);
        // 폐기 사건을 적은 «뒤»에 세션 RT·bootstrap 해시와 로그인 시도 digest·서명 재료를 지운다(LLD §4).
        authSessionService.eraseWithdrawnCredentials(userId);
        // 이미 박힌 초대 귀속을 끊는다(ⓐ) — tombstone 은 이후 쓰기만 막고, claim 은 최초 1회만
        // 기록되므로 여기서 끊지 않으면 되돌릴 길이 없다. 본인 발급 링크의 발급자 연결도 같이 끊는다(LLD §4).
        // LLD §4 순서표는 이 단계를 지갑 삭제 뒤에 두지만, 기존 ⓐ 자리를 지킨다 — 아래 단계 어느 것도
        // 초대 링크·클릭 행을 읽거나 쓰지 않아(링크 폐기 사건은 멤버십의 user 로 축을 잡는다) 결과가 같다.
        inviteLinkMatchService.eraseWithdrawnUser(userId);
        // 위성이 자기 원장을 정리할 수 있게 탈퇴 사건을 적는다 — 알림은 Kafka, 링크는 HTTP.
        withdrawalSatelliteCommandService.recordWithdrawn(userId, authGeneration);

        // 그룹: 소유 그룹 정리 → HOST_WITHDRAW 판정 → OPEN 내기 해제(환불) → 판정 근거 박제 → 멤버십 이탈.
        // 제약 ①②의 왼쪽이 여기다 — 환불은 지갑 삭제보다, 박제는 익명화보다 앞서야 한다.
        groupMemberService.detachWithdrawnUser(user);
        // 환불·증거 동결·이탈이 끝난 뒤에 멤버십 개인 설정·열람 lease·창형 원본·공지·댓글 작성자·직접 초대를 파기한다.
        // 직접 초대(group_invites)는 LLD §4 순서표에서 친구·차단과 같은 뒤쪽 묶음이지만 그룹 도메인 행이라 여기서
        // 같이 지운다 — 아래 단계 어느 것도 group_invites 를 읽거나 쓰지 않아 결과가 같다.
        groupMemberService.eraseWithdrawnUserRecords(user);

        // 이력 익명화 — 행을 남기고 user_id 만 끊는다(다른 사람의 판정·랭킹 근거이므로).
        focusService.anonymizeWithdrawnUser(userId);
        // 세션 → 태그 → 사용자 역추적 경로와 스트릭을 파기한다(LLD §4). 증거 동결은 위 그룹 단계에서 끝났다.
        focusService.eraseWithdrawnUserRecords(userId);
        // v0.3 집중 세션(GROMO-1764)은 레거시와 달리 «상세·구간»이라는 자기 행을 따로 갖는다 —
        // user_id 뿐 아니라 자유 입력 subject 까지 남고, 진행 중이면 열린 구간도 남는다. 시작 게이트가
        // 닫혀 있어 지금은 행이 생기지 않지만, 게이트 뒤에 알려진 구멍을 남겨 두면 여는 날 그대로 샌다.
        // 순서 고정: 구간 닫기 → 상세 종결 → user_id 끊기. 마지막이 앞서면 뒤의 둘이 대상을 못 찾는다.
        Instant anonymizedAt = Instant.now();
        focusSessionIntervalRepository.closeOpenIntervalsOfUser(userId, anonymizedAt);
        focusSessionDetailRepository.abandonProgressingOfUser(userId, anonymizedAt);
        focusSessionDetailRepository.anonymizeWithdrawnUser(userId);
        statsService.anonymizeWithdrawnUser(userId);
        screenTimeService.anonymizeWithdrawnUser(userId);

        // 파생 개인 이력 파기(LLD §4 중앙 TX 순서) — 알림 발송 이력 → 리그 → 캐릭터 생성·장착.
        rankOvertakeNotificationService.eraseWithdrawnUserLogs(userId);
        leagueService.eraseWithdrawnUser(userId);
        characterGenerationService.eraseWithdrawnUser(userId);
        equipmentService.eraseWithdrawnUser(userId);
        // 섬 개인 외양·개인 보유품 삭제, 퀘스트 cohort 삭제·정산 수령자 연결 해제(GROMO-1950).
        // 섬 소유 보유품·정산 행은 섬 자산·원장 근거라 남는다. 섬 잠금은 위 그룹 선점에서 이미 쥐었다.
        appearanceService.eraseWithdrawnUser(userId);
        islandQuestService.eraseWithdrawnUser(userId);

        // 제약 ①의 오른쪽 — 위 내기 해제 환불이 이미 입금된 뒤여야 한다.
        userService.deleteWalletAndSettings(userId);

        // friendships 행 잠금 구간. 관계와 무관한 정리를 끝낸 뒤에 잡는다.
        friendService.detachWithdrawnUser(userId);
        // 멱등 기록을 전부 지운다 — 공개 receipt 속 개인 응답(이름 등)과 legacy 행 속 기기 토큰(GROMO-1946).
        publicCommandService.forgetReceiptsOf(userId);

        // 제약 ③ — 반드시 맨 끝. 소셜 벌크 DELETE 가 컨텍스트를 비우므로 뒤에 아무것도 올 수 없다.
        userService.erasePersonalData(user);
    }
}
