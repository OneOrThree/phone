package com.oneorthree.phone.group.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;

/**
 * 그룹 공지 작성·수정 요청 본문.
 *
 * <p>제목·본문 모두 공백만이면 400 이다. 작성자는 싣지 않는다 — 서버가 토큰의 유저를 쓰고,
 * 작성 권한(방장 또는 공지 권한을 받은 멤버)도 서버가 판정한다.
 */
@Getter
@NoArgsConstructor
@AllArgsConstructor
public class CreateAnnouncementRequest {
    @NotBlank
    @Size(max = 100)
    private String title;

    @NotBlank
    private String content;
}
