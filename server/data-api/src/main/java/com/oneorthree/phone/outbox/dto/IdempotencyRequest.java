package com.oneorthree.phone.outbox.dto;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.UUID;

/**
 * 멱등 명령 한 건의 식별 — 키·주체·본문 지문.
 *
 * <p><b>키의 소유자는 앱이다</b>(A21). Business 는 무상태라 앱이 응답을 못 받고 같은 {@code POST} 를
 * 다시 부르면 새 키가 생겨 UNIQUE 가 중복 생성을 못 막는다. 그래서 앱이 재시도 간 보존하는 키를
 * {@code Idempotency-Key} 헤더로 보내고 Business 는 그대로 전달한다.
 *
 * <p><b>헤더가 없는 구 앱에서 요청 내용으로 키를 도출하면 안 된다</b> — 별개의 정상 명령이 같은 키로
 * 접힌다(끝난 챌린지와 같은 설정으로 다시 만드는 것은 유효한 명령인데, 동일 본문에서 나온 키는 과거
 * 응답을 재생해 새 챌린지를 아예 안 만든다). 구 앱 지원 기간에는 <b>매 호출 새 키를 생성</b>해
 * 서버 내부 재시도만 보호한다.
 *
 * @param key         앱이 소유하는 멱등 키
 * @param userId      명령 주체
 * @param commandType 명령 종류 — 키가 어느 명령의 것인지 기록에 남긴다
 * @param fingerprint 요청 본문 지문(SHA-256 hex). <b>멱등 키가 아니다</b> — 같은 키로 다른 본문이
 *                    왔는지만 본다
 */
public record IdempotencyRequest(String key, UUID userId, String commandType, String fingerprint) {

    public IdempotencyRequest {
        if (key == null || key.isBlank()) {
            throw new IllegalArgumentException("멱등 키는 필수입니다.");
        }
        if (userId == null) {
            throw new IllegalArgumentException("명령 주체는 필수입니다.");
        }
        if (commandType == null || commandType.isBlank()) {
            throw new IllegalArgumentException("명령 종류는 필수입니다.");
        }
        if (fingerprint == null || fingerprint.isBlank()) {
            throw new IllegalArgumentException("요청 본문 지문은 필수입니다.");
        }
    }

    /** 사용자별 키 공간. 다른 사용자의 같은 헤더가 명령을 차단하거나 응답을 공유하지 않는다. */
    public String storageKey() {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256")
                    .digest((userId + "\0" + key).getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(digest);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 미지원", e);
        }
    }
}
