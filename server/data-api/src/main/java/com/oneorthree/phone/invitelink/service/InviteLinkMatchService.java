package com.oneorthree.phone.invitelink.service;

import com.oneorthree.phone.invitelink.repository.domain.GroupInviteLink;
import com.oneorthree.phone.invitelink.repository.domain.InviteLinkClick;
import com.oneorthree.phone.invitelink.dto.InviteMatchRequest;
import com.oneorthree.phone.invitelink.dto.InviteMatchResponse;
import com.oneorthree.phone.invitelink.exception.InviteLinkErrorCode;
import com.oneorthree.phone.invitelink.exception.InviteLinkException;
import com.oneorthree.phone.invitelink.repository.GroupInviteLinkRepository;
import com.oneorthree.phone.invitelink.repository.InviteLinkQueryService;
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
    private final InviteLinkQueryService inviteLinkQueryService;
    private final InviteLinkService inviteLinkService;
    private final InviteLinkGa4Events ga4Events;
    private final int matchWindowHours;

    /**
     * @param clickRepository 클릭 조회·소진. 소진 경로는 반드시 잠금 조회를 써야 한다
     * @param inviteLinkRepository 슬러그로 링크를 찾는 데 쓴다(id 조회는 아래 계층이 맡는다)
     * @param inviteLinkQueryService 링크 단건 조회 — 부재를 던지지 않아 클릭을 소진하지 않고 다음 기회를 남긴다
     * @param inviteLinkService 그룹 생존 판정({@code findActiveGroup})을 발급·랜딩과 공유하기 위해 주입한다 —
     *                          판정이 갈리면 랜딩에서는 만료인 초대가 매치에서는 성립하는 어긋남이 생긴다
     * @param ga4Events 매치 성공·실패를 모두 발행한다. 실패가 퍼널의 분모라 빼면 매치율을 계산할 수 없다
     * @param matchWindowHours {@code link.match-window-hours} — 클릭을 후보로 인정할 시간창.
     *                         <b>이 값이 이 기능의 정확도 손잡이다</b>: 넓히면 남의 클릭을 물어 갈 확률이
     *                         커지고, 좁히면 스토어를 거치며 지연된 정상 설치를 놓친다
     */
    public InviteLinkMatchService(
            InviteLinkClickRepository clickRepository,
            GroupInviteLinkRepository inviteLinkRepository,
            InviteLinkQueryService inviteLinkQueryService,
            InviteLinkService inviteLinkService,
            InviteLinkGa4Events ga4Events,
            @Value("${link.match-window-hours}") int matchWindowHours) {
        this.clickRepository = clickRepository;
        this.inviteLinkRepository = inviteLinkRepository;
        this.inviteLinkQueryService = inviteLinkQueryService;
        this.inviteLinkService = inviteLinkService;
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
     *
     * @param ipHash 서버가 계산한 클라이언트 IP 해시 — 요청 본문이 아니라 커넥션에서 나온 값이라
     *               호출자가 직접 고를 수 없다. 매칭 축 중 유일하게 그렇다
     * @param request 기기가 보고한 OS·deviceId·appInstanceId. deviceId 는 재시도 멱등의 키이고,
     *                호출자가 값을 정하므로 남의 deviceId 를 참칭하면 그 기기의 매치 결과를 되읽는다
     *                (읽기만 하므로 새 클릭을 소진하지는 않는다)
     * @return 성공이면 slug·groupId, 실패면 {@code matched=false}. <b>실패도 예외가 아니라 정상 응답</b>이며
     *         호출부는 이를 200 으로 내린다 — 4xx/5xx 로 내리면 앱이 매 실행마다 재시도한다.
     *         성공은 "초대 맥락을 찾았다"까지이고 가입·참여를 뜻하지 않는다
     */
    @Transactional
    public InviteMatchResponse match(String ipHash, InviteMatchRequest request) {
        Instant cutoff = Instant.now().minus(matchWindowHours, ChronoUnit.HOURS);

        // 재시도 멱등 — 이 기기가 창 안에서 이미 매치했다면 새 클릭을 소진하지 않고 같은 결과를 돌려준다.
        // 응답 유실로 앱이 재시도할 때 설치 1건이 클릭 여러 건을 소진하는 것을 막는다.
        // GA4 는 재발행하지 않는다(§4-3 이중 집계 금지 — 최초 매치가 이미 보냈다).
        Optional<InviteLinkClick> prior = clickRepository
                .findFirstByMatchedDeviceIdAndMatchedAtAfterOrderByMatchedAtDesc(request.deviceId(), cutoff);
        if (prior.isPresent()) {
            // 기기당 매치는 1회다. 기존 매치의 그룹이 그 사이 죽었어도 후보 소진 경로로 떨어지지 않고
            // 여기서 실패로 끝낸다 — 떨어뜨리면 재시도가 같은 fingerprint 의 "다른 링크" 클릭(남의 클릭일
            // 수 있다)을 두 번째로 소진해, "재시도는 같은 결과"라는 멱등 계약이 새 매치를 만들게 된다.
            log.debug("매치 재시도 — 기존 결과 재반환 deviceId={}", request.deviceId());
            return replayResponse(prior.get());
        }

        Optional<InviteLinkClick> candidate = clickRepository
                .findFirstByIpHashAndOsAndMatchedFalseAndClickedAtAfterOrderByClickedAtDesc(
                        ipHash, request.os(), cutoff);

        Optional<GroupInviteLink> link = candidate.flatMap(click -> {
            Optional<GroupInviteLink> found = inviteLinkQueryService.findInviteLink(click.getLinkId());
            if (found.isEmpty()) {
                // FK 가 보장하므로 도달하지 않는다. 그래도 클릭을 소진하지 않고 빠져나가 다음 기회를 남긴다.
                log.warn("매치 후보의 링크를 찾을 수 없음 — clickId={}", click.getId());
                return Optional.empty();
            }
            // 그룹이 삭제·종료된 링크 — 클릭은 소진하되(죽은 후보가 계속 1순위로 남지 않게) 매치는 실패다.
            // 발급·랜딩(만료 변형)과 같은 판정을 쓴다: 참여시킬 곳이 없는 초대를 되살리지 않는다.
            click.markMatched(request.deviceId(), request.appInstanceId());
            if (inviteLinkService.findActiveGroup(found.get().getGroupId()).isEmpty()) {
                log.debug("매치 후보의 그룹이 삭제·종료됨 — clickId={} slug={}",
                        click.getId(), found.get().getSlug());
                return Optional.empty();
            }
            return found;
        });

        // 실패도 발행한다 — 클릭 대비 매치율이 퍼널의 핵심 지표라 분모가 필요하다.
        ga4Events.matchResolved(request, link.orElse(null));

        return link.map(matched -> InviteMatchResponse.matched(matched.getSlug(), matched.getGroupId()))
                .orElseGet(InviteMatchResponse::notMatched);
    }

    /** 기존 매치를 같은 응답으로 복원한다. 링크의 그룹이 그 사이 삭제·종료됐으면 매치 실패 응답이다. */
    private InviteMatchResponse replayResponse(InviteLinkClick prior) {
        return inviteLinkQueryService.findInviteLink(prior.getLinkId())
                .filter(link -> inviteLinkService.findActiveGroup(link.getGroupId()).isPresent())
                .map(link -> InviteMatchResponse.matched(link.getSlug(), link.getGroupId()))
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
     *
     * <p>후보 조회는 매치와 같은 {@code PESSIMISTIC_WRITE} + {@code SKIP LOCKED} 다. 잠그지 않으면
     * 거의 동시에 claim 한 두 유저가 같은 행을 읽고 마지막 커밋이 앞사람을 덮는다(lost update) —
     * 포워딩된 초대를 여러 명이 받아 비슷한 시각에 로그인하는 시나리오는 이 기능에서 드물지 않다.
     *
     * @param slug 수락할 초대 링크. 없는 slug 는 유일하게 예외로 끝나는 경우다
     *             ({@code SLUG_NOT_FOUND}) — 나머지 실패 사유는 모두 조용한 no-op 이다
     * @param userId 초대를 수락한 유저. 토큰에서 온 값이라 남을 대신해 claim 할 수 없다
     * @return 이번 호출이 실제로 유저를 붙였으면 {@code true}. 컨트롤러는 계약상 몸통 없는 200 이라
     *         쓰지 않지만, "동시 claim 중 정확히 한 명만 기록된다"를 테스트가 관측하는 지점이다.
     */
    @Transactional
    public boolean claim(String slug, UUID userId) {
        GroupInviteLink link = inviteLinkRepository.findBySlug(slug)
                .orElseThrow(() -> new InviteLinkException(InviteLinkErrorCode.SLUG_NOT_FOUND));

        Optional<InviteLinkClick> click = clickRepository
                .findFirstByLinkIdAndMatchedTrueAndClaimedUserIdIsNullAndClaimedAtIsNullOrderByMatchedAtDesc(
                        link.getId());
        if (click.isEmpty()) {
            // 링크 직행(Universal Link)으로 들어온 유저는 클릭 행이 없을 수 있다 — 붙일 곳이 없을 뿐 오류가 아니다.
            log.debug("claim 대상 클릭 없음 — slug={}", slug);
            return false;
        }

        if (!click.get().claim(userId, link.getInviterId())) {
            log.debug("claim no-op — slug={} userId={} (셀프 초대이거나 이미 claim 됨)", slug, userId);
            return false;
        }
        return true;
    }
}
