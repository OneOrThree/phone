package com.oneorthree.phone.invitelink.service;

import com.oneorthree.phone.common.util.ClientIpResolver;
import com.oneorthree.phone.invitelink.dto.InviteLinkRef;
import com.oneorthree.phone.invitelink.repository.domain.InviteLinkClick;
import com.oneorthree.phone.invitelink.repository.InviteLinkClickRepository;
import com.oneorthree.phone.invitelink.support.InviteLinkGa4Events;
import com.oneorthree.phone.invitelink.support.IpHasher;
import com.oneorthree.phone.invitelink.support.UserAgentClassifier;
import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.net.URI;

/**
 * 랜딩 클릭 기록 — deferred 매치의 후보를 만드는 유일한 지점.
 *
 * <p>여기서 남긴 행 하나가 "설치 후 첫 실행" 때 fingerprint(IP해시 + OS)로 되찾아진다.
 * 그래서 <b>봇 클릭을 남기지 않는 것</b>이 단순한 위생 문제가 아니다 — 남기면 스크레이퍼 IP 로
 * 찍힌 미소진 클릭이 매치 후보가 돼 엉뚱한 사람에게 초대장이 뜬다.
 *
 * <p>메서드 수준 {@code @Transactional} 을 일부러 두지 않는다. 쓰기는 클릭 INSERT 하나뿐이라
 * 리포지토리 자체 트랜잭션으로 충분하고, 경계를 넓혀두면 나중에 여기 붙는 외부 호출(GA4 실구현 등)이
 * DB 트랜잭션 안으로 딸려 들어간다.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class InviteLinkClickService {

    private static final int USER_AGENT_MAX_LENGTH = 512;

    private final InviteLinkClickRepository clickRepository;
    private final ClientIpResolver clientIpResolver;
    private final IpHasher ipHasher;
    private final UserAgentClassifier userAgentClassifier;
    private final InviteLinkGa4Events ga4Events;

    /**
     * 클릭 1건을 기록하고 GA4 웹스트림 이벤트를 발행한다. 봇이면 아무것도 하지 않는다.
     *
     * <p>호출측(랜딩)은 이 메서드의 실패를 삼킨다 — 기록이 안 되는 것보다 랜딩이 안 뜨는 게 훨씬 나쁘다.
     */
    public void record(InviteLinkRef link, HttpServletRequest request) {
        String userAgent = request.getHeader("User-Agent");
        if (userAgentClassifier.isBot(userAgent)) {
            log.debug("봇 UA 클릭 무시 slug={} ua={}", link.slug(), userAgent);
            return;
        }

        String os = userAgentClassifier.classify(userAgent);
        String ipHash = ipHasher.hash(clientIpResolver.resolve(request));
        InviteLinkClick click = clickRepository.save(
                new InviteLinkClick(link.id(), ipHash, os, truncate(userAgent)));

        ga4Events.linkClicked(link, click.getId(), os, refererHost(request));
    }

    private String truncate(String userAgent) {
        if (userAgent == null) {
            return null;
        }
        return userAgent.length() <= USER_AGENT_MAX_LENGTH
                ? userAgent
                : userAgent.substring(0, USER_AGENT_MAX_LENGTH);
    }

    /** 어디서 왔는지(카톡·인스타 등)만 알면 되므로 호스트만 남긴다 — 전체 URL 은 사생활 정보가 섞인다. */
    private String refererHost(HttpServletRequest request) {
        String referer = request.getHeader("Referer");
        if (referer == null || referer.isBlank()) {
            return "";
        }
        try {
            String host = URI.create(referer).getHost();
            return host == null ? "" : host;
        } catch (IllegalArgumentException e) {
            return "";
        }
    }
}
