package com.oneorthree.business.upstream.data.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonSetter;
import com.fasterxml.jackson.annotation.Nulls;

import java.util.UUID;

/**
 * 친구 검색 결과의 한 건 (GROMO-1996) — Data 의 {@code FriendSearchResultResponse} 를 받는다.
 * 공개 응답은 UseCase의 별도 DTO로 명시적으로 매핑한다.
 *
 * <p>닉네임이 대소문자 무시로 유일하므로 목록은 <b>0건 또는 1건</b>이다 — 그래도 배열로 내린다.
 * 「없음」을 404 가 아니라 빈 배열로 답해야 앱이 「검색 결과 없음」을 오류 화면 없이 그린다.
 *
 * <p>{@code nickname} 은 {@link FriendItem} 과 달리 <b>필수</b>다 — 저쪽은 탈퇴자까지 담는 친구 목록이라
 * null 이 정상이지만, 검색은 «닉네임으로 찾은» 결과이고 탈퇴자를 제외한다(LLD §1.6). 즉 값이 없다는 건
 * 상류 계약이 깨졌다는 뜻이라, 닉네임 없는 검색 결과를 200 으로 공개하지 않고 502 로 올린다(codex 리뷰).
 *
 * @param userId     검색된 유저 id — 친구 요청의 {@code targetUserId} 가 이 값이다
 * @param nickname   닉네임. 검색이 전체 일치라 질의어와 대소문자만 다를 수 있다. <b>필수</b>
 * @param relation   나와의 관계 — {@code NONE}·{@code PENDING}·{@code FRIEND}. 앱이 요청 버튼과 배지를
 *                   갈라 그리는 축이라 <b>필수</b>다. 값 해석은 앱 몫이라 문자열로 받는다
 */
public record FriendSearchItem(
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) UUID userId,
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String nickname,
        @JsonProperty(required = true) @JsonSetter(nulls = Nulls.FAIL) String relation) {
}
