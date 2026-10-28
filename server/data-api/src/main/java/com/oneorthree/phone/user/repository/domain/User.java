package com.oneorthree.phone.user.repository.domain;

import com.oneorthree.phone.common.id.GeneratedUuidV7;
import jakarta.persistence.CascadeType;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.OneToMany;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import lombok.AccessLevel;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/**
 * 유저 계정 행. 서비스의 거의 모든 트랜잭션이 이 행을 지나므로 두 가지가 계약처럼 굳어 있다.
 *
 * <p><b>탈퇴는 삭제가 아니라 {@code isDeleted} 플래그다</b> — 행이 남아 있으므로 활성 조건 없는 조회는
 * 탈퇴 유저까지 잡는다. 탈퇴 시 닉네임 같은 PII 는 파기된다.
 *
 * <p><b>{@code @Version} 도 {@code @DynamicUpdate} 도 없다</b> — 필드 하나만 고쳐도 커밋 시
 * <b>전 컬럼 UPDATE</b> 가 나간다. 그래서 낡은 스냅샷을 더티 체킹으로 저장하면 그 사이 커밋된 탈퇴와
 * PII 파기를 통째로 되살릴 수 있고, 동시에 도는 다른 갱신도 조용히 덮어쓴다. 활동 시각처럼 단독으로 바뀌는 컬럼은 전부 {@code UserRepository} 의 조건부 단일 컬럼 UPDATE 를 쓴다.
 */
@Entity
/**
 * nickname 유니크 — 닉네임 중복 방지 (GROMO-584). nullable(게스트·온보딩 전)이나 Postgres 는 NULL 을
 * 서로 다른 값으로 취급해 다중 NULL 을 허용하므로 전체 유니크로 충분(부분 인덱스 불필요).
 */
@Table(name = "users",
        uniqueConstraints = @UniqueConstraint(name = "uq_users_nickname", columnNames = "nickname"))
@Getter
@Setter
@Builder
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@AllArgsConstructor
public class User {

    @Id
    @GeneratedUuidV7
    private UUID id;

    @Column(nullable = false)
    @Builder.Default
    private boolean isGuest = false;

    private String nickname;

    @Column(name = "country_code")
    private String countryCode;

    /**
     * 앱이 적용 중인 표시 언어(BCP-47: {@code ko}·{@code en}·{@code ja}·{@code zh-Hant}) — 푸시를 이 언어로
     * 렌더링한다(GROMO-1659 D11). 앱이 {@code PATCH /users/me} 로 채운다(GROMO-1692). {@code null} =
     * 아직 보고된 적 없음(구앱·미접속) — 소비자가 기본 언어로 폴백한다. 국가({@link #countryCode})와는
     * 다른 축이다: 한국에 사는 일본어 사용자가 있다.
     */
    @Column(length = 8)
    private String language;

    /**
     * 고양이 색 자산 ID({@code CatColors} 6종, V80 CHECK). {@code null} = 아직 고르지 않음(온보딩 전) —
     * 기본색을 백필하지 않는다(계정 Q03). 탈퇴 시 파기한다.
     */
    @Column(name = "cat_color", length = 16)
    private String catColor;

    /**
     * 유저 축 세대 (A22 ㊼ · ㊓ · ㊹) — <b>탈퇴와 전 기기 로그아웃에만</b> 오른다.
     *
     * <p>개별 기기 로그아웃에서 올리면 로그인 중인 <b>다른 기기</b>의 {@code onTokenRefresh} 재등록이
     * 거부돼 그 기기 푸시가 끊긴다. 개별 기기의 순서 장벽은 알림 서버가 소유하는 기기 축
     * ({@code ownershipVersion})이고, 로그인 세션의 생사는 {@code auth_sessions} 축이다 — 셋을 섞지 않는다.
     *
     * <p>0 은 「아직 한 번도 올린 적 없다」는 사실이다. 구 AT 에는 {@code gen} claim 이 아예 없는데
     * (㊍), 그 「없음」을 여기서 읽은 현재 값으로 채우면 로그아웃 전에 발급된 옛 AT 가 최신 세대로
     * 태깅돼 기기 토큰 tombstone 을 통째로 우회한다. 세대는 AT claim 에서만 온다.
     */
    @Column(name = "auth_generation", nullable = false,
            columnDefinition = "bigint not null default 0")
    @Builder.Default
    private long authGeneration = 0L;

    @CreationTimestamp
    private Instant createdAt;

    @UpdateTimestamp
    private Instant updatedAt;

    /**
     * 회원탈퇴 삭제 대기 플래그 — 동의 보관기간 경과 후 배치 하드 삭제(retention→purge). GROMO-671
     */
    @Column(name = "is_deleted", nullable = false)
    @Builder.Default
    private boolean isDeleted = false;

    @Builder.Default
    @OneToMany(mappedBy = "user", cascade = CascadeType.ALL, orphanRemoval = true)
    private List<SocialAccount> socialAccounts = new ArrayList<>();

    /**
     * 유저 축 세대를 한 칸 올린다 — <b>탈퇴·전 기기 로그아웃 전용</b>(㊼).
     *
     * <p>반드시 배타 락으로 로드한 행에서 부른다. 이 엔티티에는 {@code @Version} 도
     * {@code @DynamicUpdate} 도 없어 더티 체킹이 전 컬럼을 덮으므로, 낡은 스냅샷에서 부르면 그 사이
     * 커밋된 다른 갱신까지 되살린다(클래스 주석).
     *
     * @return 올린 «뒤»의 세대 — outbox 봉투에 실을 값이다
     */
    public long bumpAuthGeneration() {
        this.authGeneration = this.authGeneration + 1;
        return this.authGeneration;
    }

}
