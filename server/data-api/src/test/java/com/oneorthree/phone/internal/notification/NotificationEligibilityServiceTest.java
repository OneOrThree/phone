package com.oneorthree.phone.internal.notification;


import com.oneorthree.phone.friend.repository.FriendshipRepository;
import com.oneorthree.phone.friend.repository.domain.FriendshipStatus;
import com.oneorthree.phone.internal.notification.dto.NotificationEligibilityRequest;
import com.oneorthree.phone.internal.notification.dto.NotificationEligibilityResponse;
import com.oneorthree.phone.internal.notification.service.NotificationEligibilityService;
import com.oneorthree.phone.magazine.repository.MagazineIssueRepository;
import com.oneorthree.phone.magazine.repository.domain.MagazineIssue;
import com.oneorthree.phone.user.repository.UserQueryService;
import com.oneorthree.phone.user.repository.domain.User;
import com.oneorthree.phone.user.service.UserBlockService;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.when;

/**
 * 발송 직전 상태 재확인 — <b>fail-closed</b> 와 <b>일시 오류를 삼키지 않는다</b>가 전부다.
 *
 * <p>구 경로는 발송 직전에 코어를 다시 읽어 거짓 알림을 막았다(삭제된 챌린지의 개설 알림, 이미
 * 처리된 친구 요청, 스캔 이후 참가한 유저의 모집 알림). 그 재조회가 이 엔드포인트로 옮겨 왔으므로,
 * 여기가 느슨해지면 <b>탭해도 아무것도 없는 알림</b>이 그대로 나간다.
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class NotificationEligibilityServiceTest {

    private static final UUID USER = UUID.randomUUID();
    private static final UUID SUBJECT = UUID.randomUUID();
    private static final Instant NOW = Instant.parse("2026-09-11T03:00:00Z");

    @Mock
    UserQueryService userQueryService;
    @Mock
    FriendshipRepository friendshipRepository;
    @Mock
    UserBlockService userBlockService;
    @Mock
    MagazineIssueRepository magazineIssueRepository;

    private NotificationEligibilityService service() {
        return new NotificationEligibilityService(userQueryService, friendshipRepository,
                Clock.fixed(NOW, ZoneOffset.UTC), userBlockService, magazineIssueRepository);
    }

    @Test
    void magazinePublishedIsAllowedOnlyWhileItsIssueIsTheCurrentOne() {
        UUID issueId = UUID.randomUUID();
        userIsActive();
        // NOW = 2026-09-11 12:00 KST. 오늘 호는 내일 07:00 KST 까지, 어제 호는 오늘 07:00 KST 에 이미 지났다.
        when(magazineIssueRepository.findById(issueId)).thenReturn(Optional.of(new MagazineIssue(
                java.time.LocalDate.of(2026, 9, 11), 5, NOW, null, 0)));
        assertThat(service().evaluate(request("MAGAZINE_PUBLISHED", issueId)).eligible()).isTrue();

        when(magazineIssueRepository.findById(issueId)).thenReturn(Optional.of(new MagazineIssue(
                java.time.LocalDate.of(2026, 9, 10), 4, NOW, null, 0)));
        NotificationEligibilityResponse past = service().evaluate(request("MAGAZINE_PUBLISHED", issueId));
        assertThat(past.eligible()).isFalse();
        assertThat(past.reason()).isEqualTo("ISSUE_NOT_CURRENT");

        when(magazineIssueRepository.findById(issueId)).thenReturn(Optional.empty());
        assertThat(service().evaluate(request("MAGAZINE_PUBLISHED", issueId)).reason()).isEqualTo("SUBJECT_GONE");
    }

    /** 어제 호(9/10)의 현재 호 창은 오늘(9/11) 07:00:00 KST 에 닫힌다 — 정각은 이미 지난 호다. */
    @Test
    void magazineIssueBecomesPastExactlyAtSevenKst() {
        UUID issueId = UUID.randomUUID();
        userIsActive();
        when(magazineIssueRepository.findById(issueId)).thenReturn(Optional.of(new MagazineIssue(
                java.time.LocalDate.of(2026, 9, 10), 4, NOW, null, 0)));
        Instant seven = Instant.parse("2026-09-10T22:00:00Z"); // 2026-09-11 07:00:00 KST

        NotificationEligibilityResponse atSeven = serviceAt(seven).evaluate(request("MAGAZINE_PUBLISHED", issueId));
        assertThat(atSeven.eligible()).isFalse();
        assertThat(atSeven.reason()).isEqualTo("ISSUE_NOT_CURRENT");
        assertThat(serviceAt(seven.minusSeconds(1)).evaluate(request("MAGAZINE_PUBLISHED", issueId)).eligible())
                .isTrue();
    }

    private NotificationEligibilityService serviceAt(Instant at) {
        return new NotificationEligibilityService(userQueryService, friendshipRepository,
                Clock.fixed(at, ZoneOffset.UTC), userBlockService, magazineIssueRepository);
    }

    private void userIsActive() {
        when(userQueryService.findActive(USER)).thenReturn(Optional.of(User.builder().id(USER).build()));
    }

    private static NotificationEligibilityRequest request(String kind, UUID subjectId) {
        return new NotificationEligibilityRequest(USER, kind, subjectId, Map.of("dedupAt", NOW.toString()));
    }

    @Test
    @DisplayName("모르는 종류는 거절한다 — 「모르면 일단 보낸다」는 새 kind 마다 재확인을 조용히 건너뛴다")
    void unknownKindIsDenied() {
        NotificationEligibilityResponse response = service().evaluate(request("SOMETHING_NEW", SUBJECT));

        assertThat(response.eligible()).isFalse();
        assertThat(response.reason()).isEqualTo("UNKNOWN_KIND");
    }

    @Test
    @DisplayName("폐기된 RANK_OVERTAKE 도 모르는 종류다 — 신 카탈로그에 없으면 보내지 않는다")
    void retiredKindIsAlsoDenied() {
        assertThat(service().evaluate(request("RANK_OVERTAKE", SUBJECT)).reason()).isEqualTo("UNKNOWN_KIND");
    }

    @Test
    @DisplayName("탈퇴자에게는 어떤 종류도 보내지 않는다 — 종류별 분기보다 먼저 걸린다")
    void withdrawnUserIsDeniedBeforeKindBranching() {
        when(userQueryService.findActive(USER)).thenReturn(Optional.empty());

        assertThat(service().evaluate(request("FRIEND_ACCEPTED", SUBJECT)).reason())
                .isEqualTo("USER_INACTIVE");
    }

    @Test
    @DisplayName("대상이 필요한 종류인데 대상이 비면 거절한다 — 통과시키면 어느 회차인지 모른 채 보낸다")
    void missingSubjectIsDenied() {
        userIsActive();

        assertThat(service().evaluate(request("FRIEND_ACCEPTED", null)).reason()).isEqualTo("SUBJECT_REQUIRED");
    }

    @Test
    @DisplayName("nullable params는 null을 보존하면서 원본 변경과 외부 수정을 막는다")
    void nullableParamsAreAnImmutableSnapshot() {
        Map<String, Object> params = new LinkedHashMap<>();
        params.put("voidReason", null);
        NotificationEligibilityRequest request = new NotificationEligibilityRequest(USER, "FRIEND_ACCEPTED", SUBJECT,
                params);
        params.put("voidReason", "CHANGED");

        assertThat(request.params()).containsEntry("voidReason", null);
        assertThatThrownBy(() -> request.params().put("voidReason", "CHANGED"))
                .isInstanceOf(UnsupportedOperationException.class);
    }

    @Test
    @DisplayName("친구 요청 판정은 params.requestId 로 한다 — 없으면 거절, 이미 처리됐으면 거절")
    void friendRequestJudgedByRequestId() {
        userIsActive();
        UUID requestId = UUID.randomUUID();

        // requestId 가 없으면 «아직 대기 중인가» 를 물을 수가 없다. 통과시키면 이미 수락된 요청의
        // 알림이 그대로 나간다.
        assertThat(service().evaluate(request("FRIEND_REQUEST", SUBJECT)).reason())
                .isEqualTo("SUBJECT_REQUIRED");

        when(friendshipRepository.findStatusByIdAndDeletedAtIsNull(requestId))
                .thenReturn(Optional.of(FriendshipStatus.ACCEPTED));
        assertThat(service().evaluate(new NotificationEligibilityRequest(USER, "FRIEND_REQUEST", SUBJECT,
                Map.of("requestId", requestId.toString()))).reason()).isEqualTo("REQUEST_RESOLVED");

        when(friendshipRepository.findStatusByIdAndDeletedAtIsNull(requestId))
                .thenReturn(Optional.of(FriendshipStatus.PENDING));
        assertThat(service().evaluate(new NotificationEligibilityRequest(USER, "FRIEND_REQUEST", SUBJECT,
                Map.of("requestId", requestId.toString()))).eligible()).isTrue();
    }

    @Test
    @DisplayName("차단된 사이의 친구 요청·수락 알림은 발송 직전에 BLOCKED 로 거절한다 — 적재 뒤 차단도 거른다")
    void friendNotificationsAreDeniedWhenBlocked() {
        userIsActive();
        UUID requestId = UUID.randomUUID();
        when(userQueryService.findActive(SUBJECT)).thenReturn(Optional.of(User.builder().id(SUBJECT).build()));
        when(friendshipRepository.findStatusByIdAndDeletedAtIsNull(requestId))
                .thenReturn(Optional.of(FriendshipStatus.PENDING));
        when(userBlockService.isBlockedEither(USER, SUBJECT)).thenReturn(true);

        assertThat(service().evaluate(new NotificationEligibilityRequest(USER, "FRIEND_REQUEST", SUBJECT,
                Map.of("requestId", requestId.toString()))).reason()).isEqualTo("BLOCKED");
        assertThat(service().evaluate(request("FRIEND_ACCEPTED", SUBJECT)).reason()).isEqualTo("BLOCKED");

        // 사유 우선순위 — 이미 처리된 요청은 차단보다 먼저 REQUEST_RESOLVED 다(운영 집계의 사유 분포 고정).
        when(friendshipRepository.findStatusByIdAndDeletedAtIsNull(requestId))
                .thenReturn(Optional.of(FriendshipStatus.ACCEPTED));
        assertThat(service().evaluate(new NotificationEligibilityRequest(USER, "FRIEND_REQUEST", SUBJECT,
                Map.of("requestId", requestId.toString()))).reason()).isEqualTo("REQUEST_RESOLVED");
        // 상대 id 가 비면 차단 조회까지 가지 않는다 — 공통 SUBJECT_REQUIRED 가 먼저 막는다.
        assertThat(service().evaluate(request("FRIEND_ACCEPTED", null)).reason()).isEqualTo("SUBJECT_REQUIRED");

        when(userBlockService.isBlockedEither(USER, SUBJECT)).thenReturn(false);
        assertThat(service().evaluate(request("FRIEND_ACCEPTED", SUBJECT)).eligible()).isTrue();
    }

    @Test
    @DisplayName("일시 오류를 eligible=false 로 삼키지 않는다 — 장애가 「정책상 안 보냄」으로 둔갑하면 그 동안의 알림이 사라진다")
    void transientFailurePropagates() {
        when(userQueryService.findActive(USER))
                .thenThrow(new org.springframework.dao.QueryTimeoutException("조회 타임아웃"));

        assertThatThrownBy(() -> service().evaluate(request("FRIEND_ACCEPTED", SUBJECT)))
                .isInstanceOf(org.springframework.dao.QueryTimeoutException.class);
    }

    @Test
    void currentMainIslandFactAndAdminTestTimeAreChecked() {
        userIsActive();
        assertThat(service().evaluate(request("MAIN_ISLAND_TRANSFERRED", SUBJECT)).eligible()).isTrue();
        assertThat(service().evaluate(request("ISLAND_KICKED", SUBJECT)).eligible()).isTrue();
        assertThat(service().evaluate(new NotificationEligibilityRequest(USER, "MAIN_ISLAND_TRANSFERRED",
                SUBJECT, Map.of(), NOW.plusSeconds(1))).reason()).isEqualTo("EVENT_TIME_INVALID");
        assertThat(service().evaluate(new NotificationEligibilityRequest(USER, "MAIN_ISLAND_TRANSFERRED",
                SUBJECT, Map.of(), NOW.minusSeconds(900))).reason()).isEqualTo("EVENT_EXPIRED");
        assertThat(service().evaluate(new NotificationEligibilityRequest(USER, "MAIN_ISLAND_TRANSFERRED",
                SUBJECT, Map.of(), NOW.minusSeconds(899))).eligible()).isTrue();
    }

    @Test
    void everyRetiredFamilyIsDenied() {
        for (String kind : java.util.List.of("BET_RESULT", "CHALLENGE_CREATED", "LEAGUE_WEEKLY_RESULT",
                "STREAK_AT_RISK", "MISSED_FOCUS_TODAY", "RANK_OVERTAKE")) {
            assertThat(service().evaluate(request(kind, SUBJECT)).reason()).isEqualTo("UNKNOWN_KIND");
        }
    }
}
