package com.oneorthree.phone.character.service;

import com.oneorthree.phone.character.service.client.OpenAiModerationClient;
import com.oneorthree.phone.character.service.client.OpenAiModerationClient.OpenAiModerationResult;
import com.oneorthree.phone.character.service.dto.ImageModerationRequest;
import com.oneorthree.phone.character.service.dto.ImageModerationResponse;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.UUID;

/**
 * 누끼 이미지 유해성 검사 서비스.
 *
 * <p>OpenAI omni-moderation 호출 결과로 통과/거부를 판정한다. 검사 자체가 불가능한 경우
 * (키 미설정·네트워크·타임아웃·5xx·응답 파싱 실패)는 안전하게 차단(allowed=false)하는
 * fail-closed 정책을 적용하고, 원인은 로깅한다. 이미지는 저장하지 않는다.</p>
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class CharacterModerationService {

    private final OpenAiModerationClient openAiModerationClient;

    public ImageModerationResponse moderate(UUID userId, ImageModerationRequest request) {
        try {
            OpenAiModerationResult result = openAiModerationClient.moderate(request.image());
            return ImageModerationResponse.judged(!result.flagged(), result.flaggedCategories());
        } catch (Exception e) {
            // fail-closed — 검사를 못 하면 안전하게 차단한다. 남용 추적을 위해 userId·원인을 남긴다.
            // 차단하되 '유해 판정'이 아니라 '검사 불가'임을 앱에 알린다(GROMO-1197) — 서버 사정으로
            // 막힌 것을 사진 잘못으로 안내하면 정상 사진을 올린 사용자가 영문을 모른다.
            log.warn("이미지 모더레이션 실패 — fail-closed 차단, userId={}", userId, e);
            return ImageModerationResponse.failClosed();
        }
    }
}
