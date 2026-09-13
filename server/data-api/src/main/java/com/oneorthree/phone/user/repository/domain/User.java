package com.oneorthree.phone.user.repository.domain;

import com.oneorthree.phone.common.id.GeneratedUuidV7;
import jakarta.persistence.CascadeType;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
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
 * PII 파기를 통째로 되살릴 수 있고, 동시에 도는 다른 갱신도 조용히 덮어쓴다. 활동 시각·기기 토큰·
 * refresh 해시처럼 단독으로 바뀌는 컬럼은 전부 {@code UserRepository} 의 조건부 단일 컬럼 UPDATE 를 쓴다.
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

    /**
     * 리그 콜드스타트용 스크립트 유저 여부 (GROMO-1565, migration V48).
     * 리그 랭킹·친구 검색에는 실유저와 똑같이 노출되고, 이 플래그는 실유저 통계를 분리하거나
     * 나중에 봇을 회수할 때 대상을 특정하는 근거로만 쓴다. 성향은 bot_profiles 가 들고 있다.
     * columnDefinition 으로 DB default 를 주는 이유는 stat_visibility(v22) 선례와 같다 —
     * ddl-auto=update 환경에서 마이그레이션 선적용 없이 배포돼도 기존 row ALTER 가 실패하지 않는다.
     */
    @Column(name = "is_bot", nullable = false, columnDefinition = "boolean not null default false")
    @Builder.Default
    private boolean isBot = false;

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

    @Enumerated(EnumType.STRING)
    private Occupation occupation;

    @Column(name = "tier_level", nullable = false, columnDefinition = "integer not null default 1")
    @Builder.Default
    private int tierLevel = 1;

    /**
     * 개인 통계 공개 범위 — migration v22 로 컬럼 추가 (NOT NULL DEFAULT 'FRIENDS')
     * columnDefinition 으로 DB default 지정 → ddl-auto=update 환경에서 v22 선적용 없이 배포 시 기존 row ALTER 실패 방지
     */
    @Enumerated(EnumType.STRING)
    @Column(name = "stat_visibility", nullable = false, columnDefinition = "varchar(20) not null default 'FRIENDS'")
    @Builder.Default
    private StatVisibility statVisibility = StatVisibility.FRIENDS;

    /**
     * FCM registration token — 최대 길이가 문서로 보장되지 않아 512 로 여유 확보 (GROMO-528, migration v23 선적용)
     */
    @Column(length = 512)
    private String deviceToken;

    private String refreshTokenHash;

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

    /**
     * 마지막 활동 시각 — 미접속 복귀 푸시(GROMO-578)의 D+3/7/14 판정 기준. JwtFilter 가 하루 1회 스로틀 갱신.
     * columnDefinition 으로 DB default now() 지정 → stat_visibility(v22) 선례와 동일하게 ddl-auto=update(prod)
     * 환경에서 migration v25 선적용 없이 배포돼도 기존 row ALTER 실패 방지. 신규 유저는 @Builder.Default 로 채움
     * (AuthService 미수정 — 585 충돌 회피).
     */
    @Column(name = "last_active_at", nullable = false,
            columnDefinition = "timestamptz not null default now()")
    @Builder.Default
    private Instant lastActiveAt = Instant.now();

    /**
     * 누끼 생성 trial(7일 무제한)의 기준 시각 — 유저가 쿼터를 처음 조회할 때 한 번 박힌다(migration v26).
     * 배포 날짜 상수 대신 유저별 "첫 접촉"을 쓰는 이유는, 앱 업데이트 시점이 유저마다 달라도 trial 7일을
     * 온전히 받게 하기 위함이다. NULL = 아직 이 기능을 만난 적 없음.
     */
    @Column(name = "character_trial_anchor_at")
    private Instant characterTrialAnchorAt;

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

    // 보유 아이템·장착(item 도메인)은 여기서 매핑하지 않는다 (GROMO-1656) — 소유측이 item 쪽
    // @ManyToOne 이라 이 역방향 컬렉션은 읽는 곳이 한 군데도 없었고, user 가 item 을 컴파일
    // 단위로 끌어들여 user↔item 순환을 만들고 있었다. 장착 조회는 CharacterEquipmentRepository 로 한다.
}
