package com.oneorthree.phone.invitelink.repository;

import java.util.UUID;

/**
 * manifest 한 항목 — {@code (id, sourceChecksum)}.
 *
 * <p>링크 서버의 최종 검증이 이 쌍의 목록을 canonical JSON 으로 만들어 체크섬을 대조한다. 그래서
 * <b>순서가 계약</b>이고, 그 순서는 DB 의 uuid 오름차순이다 — 애플리케이션 정렬로 대신하면
 * {@code UUID.compareTo} 가 부호 있는 long 비교라 상위 비트가 선 uuid 에서 갈린다.
 */
public interface ManifestEntry {

    /** 클릭 또는 링크의 PK. */
    UUID getId();

    /** 그 행의 원본 체크섬. */
    String getChecksum();
}
