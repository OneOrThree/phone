package com.oneorthree.phone.invitelink.service;

import com.oneorthree.phone.common.analytics.Ga4MeasurementClient;
import com.oneorthree.phone.invitelink.domain.GroupInviteLink;
import com.oneorthree.phone.invitelink.domain.InviteLinkClick;
import com.oneorthree.phone.invitelink.repository.InviteLinkClickRepository;
import com.oneorthree.phone.invitelink.support.ClientIpResolver;
import com.oneorthree.phone.invitelink.support.IpHasher;
import com.oneorthree.phone.invitelink.support.UserAgentClassifier;
import jakarta.servlet.http.HttpServletRequest;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.net.URI;
import java.util.HashMap;
import java.util.Map;

/**
 * 랜딩 클릭 기록 — deferred 매치의 후보를 만드는 유일한 지점.
 *
 * <p>여기서 남긴 행 하나가 "설치 후 첫 실행" 때 fingerprint(IP해시 + OS)로 되찾아진다.
 * 그래서 <b>봇 클릭을 남기지 않는 것</b>이 단순한 위생 문제가 아니다 — 남기면 스크레이퍼 IP 로
 * 찍힌 미소진 클릭이 매치 후보가 돼 엉뚱한 사람에게 초대장이 뜬다.
 */
@Service
@Slf4j
public class InviteLinkClickService {

    private static final int USER_AGENT_MAX_LENGTH = 512;

    private final InviteLinkClickRepository clickRepository;
    private final ClientIpResolver clientIpResolver;
    private final IpHasher ipHasher;
    private final UserAgentClassifier userAgentClassifier;
    private final Ga4MeasurementClient ga4Client;
    private final String env;

    public InviteLinkClickService(
            InviteLinkClickRepository clickRepository,
            ClientIpResolver clientIpResolver,
            IpHasher ipHasher,
            UserAgentClassifier userAgentClassifier,
            Ga4MeasurementClient ga4Client,
            @Value("${spring.profiles.active:local}") String env) {
        this.clickRepository = clickRepository;
        this.clientIpResolver = clientIpResolver;
        this.ipHasher = ipHasher;
        this.userAgentClassifier = userAgentClassifier;
        this.ga4Client = ga4Client;
        this.env = env;
    }

    /**
     * 클릭 1건을 기록하고 GA4 웹스트림 이벤트를 발행한다. 봇이면 아무것도 하지 않는다.
     *
     * <p>호출측(랜딩)은 이 메서드의 실패를 삼킨다 — 기록이 안 되는 것보다 랜딩이 안 뜨는 게 훨씬 나쁘다.
     */
    public void record(GroupInviteLink link, HttpServletRequest request) {
        String userAgent = request.getHeader("User-Agent");
        if (userAgentClassifier.isBot(userAgent)) {
            log.debug("봇 UA 클릭 무시 slug={} ua={}", link.getSlug(), userAgent);
            return;
        }

        String os = userAgentClassifier.classify(userAgent);
        String ipHash = ipHasher.hash(clientIpResolver.resolve(request));
        InviteLinkClick click = clickRepository.save(
                new InviteLinkClick(link.getId(), ipHash, os, truncate(userAgent)));

        Map<String, Object> params = new HashMap<>();
        params.put("slug", link.getSlug());
        params.put("group_id", link.getGroupId().toString());
        params.put("os", os);
        params.put("referer_host", refererHost(request));
        params.put("env", env);
        // 웹 클릭은 익명이라 붙일 app_instance_id 가 없다 — 클릭 id 를 합성 client_id 로 쓴다.
        ga4Client.sendWebEvent(click.getId().toString(), "invite_link_clicked", params);
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
