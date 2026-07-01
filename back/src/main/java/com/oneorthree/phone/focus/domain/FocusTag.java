package com.oneorthree.phone.focus.domain;

import com.oneorthree.phone.user.domain.User;

import com.oneorthree.phone.common.id.GeneratedUuidV7;
import jakarta.persistence.CascadeType;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.OneToMany;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

@Entity
@Table(name = "focus_tags")
@Getter
@Builder
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@AllArgsConstructor
public class FocusTag {

    @Id
    @GeneratedUuidV7
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "user_id", nullable = false)
    private User user;

    @Column(nullable = false)
    private String name;

    @CreationTimestamp
    private Instant createdAt;

    // 소프트 딜리트 — focus_sessions.focus_tag_id 는 nullable 이나(태그 없는 세션 허용),
    // 이 태그를 참조 중인 세션이 있으면 하드 삭제 시 참조 무결성이 파손되므로 소프트 딜리트로 처리한다.
    private Instant deletedAt;

    @Builder.Default
    @OneToMany(mappedBy = "focusTag", cascade = CascadeType.ALL, orphanRemoval = true)
    private List<FocusSession> focusSessions = new ArrayList<>();

    public void updateName(String name) {
        this.name = name;
    }

    public void softDelete() {
        this.deletedAt = Instant.now();
    }
}
