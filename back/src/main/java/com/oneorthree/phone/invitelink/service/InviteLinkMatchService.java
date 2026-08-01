package com.oneorthree.phone.invitelink.service;

import com.oneorthree.phone.invitelink.domain.GroupInviteLink;
import com.oneorthree.phone.invitelink.domain.InviteLinkClick;
import com.oneorthree.phone.invitelink.dto.InviteMatchRequest;
import com.oneorthree.phone.invitelink.dto.InviteMatchResponse;
import com.oneorthree.phone.invitelink.exception.InviteLinkErrorCode;
import com.oneorthree.phone.invitelink.exception.InviteLinkException;
import com.oneorthree.phone.invitelink.repository.GroupInviteLinkRepository;
import com.oneorthree.phone.invitelink.repository.InviteLinkClickRepository;
import com.oneorthree.phone.invitelink.support.InviteLinkGa4Events;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Optional;
import java.util.UUID;

/**
 * deferred 매치 — "설치 직후 첫 실행"에서 클릭을 되찾아 초대 맥락을 복원한다. claim 도 함께 소유한다.
 *
 * <p>퍼널 전체에서 <b>유일한 확률 구간</b>이다(IP해시 + OS + 시간창 fingerprint). Apple 은 개별
 * 단위 deferred deep link 채널을 의도적으로 제공하지 않으므로 업계(Branch 등)와 같은 방식을 쓴다.
 * 오매칭은 구조적으로 0 이 될 수 없어서, 결과로 <b>자동 가입시키지 않는 것</b>이 안전장치다 —
 * 앱은 반드시 초대 시트 확인을 거치므로 최악의 피해가 "엉뚱한 초대장이 한 번 보임"에 그친다.
 *
 * <p>매치는 클릭을 <b>소진</b>한다(matched=true). 앱 쪽 1회성 플래그는 재설치하면 사라지지만
 * 서버측 소진은 남으므로, 같은 클릭이 재설치로 다시 매치되는 일은 없다.
 */
@Service
@Slf4j
public class InviteLinkMatchService {

    private final InviteLinkClickRepository clickRepository;
    private final GroupInviteLinkRepository inviteLinkRepository;
    private final InviteLinkGa4Events ga4Events;
    private final int matchWindowHours;

    public InviteLinkMatchService(
            InviteLinkClickRepository clickRepository,
            GroupInviteLinkRepository inviteLinkRepository,
            InviteLinkGa4Events ga4Events,
            @Value("${link.match-window-hours}") int matchWindowHours) {
        this.clickRepository = clickRepository;
        this.inviteLinkRepository = inviteLinkRepository;
        this.ga4Events = ga4Events;
        this.matchWindowHours = matchWindowHours;
    }

    /**
     * 후보 클릭 1건을 원자적으로 소진하고 slug·groupId 를 복원한다.
     *
     * <p>조회는 {@code PESSIMISTIC_WRITE} + {@code SKIP LOCKED} 다. 잠그지 않으면 동시에 들어온 두
     * 요청이 같은 클릭을 읽고 둘 다 소진해, 한 번의 클릭이 두 기기에 매치된다. SKIP LOCKED 를 함께
     * 쓰는 이유는 공유 Wi-Fi(같은 fingerprint)에서 후보가 여러 건 쌓였을 때다 — 그냥 기다리면
     * 잠긴 행이 풀린 뒤 조건에서 탈락해 "다음 후보가 남아 있는데도 매치 실패"가 된다.
     */
    @Transactional
    public InviteMatchResponse match(String ipHash, InviteMatchRequest request) {
        Instant cutoff = Instant.now().minus(matchWindowHours, ChronoUnit.HOURS);
        Optional<InviteLinkClick> candidate = clickRepository
                .findFirstByIpHashAndOsAndMatchedFalseAndClickedAtAfterOrderByClickedAtDesc(
                        ipHash, request.os(), cutoff);

        Optional<GroupInviteLink> link = candidate.flatMap(click -> {
            Optional<GroupInviteLink> found = inviteLinkRepository.findById(click.getLinkId());
            if (found.isEmpty()) {
                // FK 가 보장하므로 도달하지 않는다. 그래도 클릭을 소진하지 않고 빠져나가 다음 기회를 남긴다.
                log.warn("매치 후보의 링크를 찾을 수 없음 — clickId={}", click.getId());
                return Optional.empty();
            }
            click.markMatched(request.deviceId(), request.appInstanceId());
            return found;
        });

        // 실패도 발행한다 — 클릭 대비 매치율이 퍼널의 핵심 지표라 분모가 필요하다.
        ga4Events.matchResolved(request, link.orElse(null));

        return link.map(matched -> InviteMatchResponse.matched(matched.getSlug(), matched.getGroupId()))
                .orElseGet(InviteMatchResponse::notMatched);
    }

    /**
     * 가입/로그인한 유저를 초대 클릭에 붙인다 (계약 ④).
     *
     * <p>결정론 결합이 가능한 <b>가장 이른 시점</b>이라 여기서 붙인다 — "가입만 하고 그룹 참여는 안 한"
     * 유저도 초대자와 이어져 추후 초대 보상의 기반이 된다(보상 트리거 자체는 이번 범위 밖).
     *
     * <p>멱등이다. 이미 claim 됐거나, 초대자 본인이거나, 붙일 클릭이 없어도 조용히 200 이다 —
     * 앱이 재시도해도 안전해야 하고, 실패로 내리면 로그인 직후 흐름에 불필요한 에러가 얹힌다.
     */
    @Transactional
    public void claim(String slug, UUID userId) {
        GroupInviteLink link = inviteLinkRepository.findBySlug(slug)
                .orElseThrow(() -> new InviteLinkException(InviteLinkErrorCode.SLUG_NOT_FOUND));

        Optional<InviteLinkClick> click = clickRepository
                .findFirstByLinkIdAndMatchedTrueAndClaimedUserIdIsNullOrderByMatchedAtDesc(link.getId());
        if (click.isEmpty()) {
            // 링크 직행(Universal Link)으로 들어온 유저는 클릭 행이 없을 수 있다 — 붙일 곳이 없을 뿐 오류가 아니다.
            log.debug("claim 대상 클릭 없음 — slug={}", slug);
            return;
        }

        if (!click.get().claim(userId, link.getInviterId())) {
            log.debug("claim no-op — slug={} userId={} (셀프 초대이거나 이미 claim 됨)", slug, userId);
        }
    }
}
