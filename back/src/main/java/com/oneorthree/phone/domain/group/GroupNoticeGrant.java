package com.oneorthree.phone.domain.group;

import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import lombok.Getter;

@Entity
@Table(name = "group_notice_grants",
        uniqueConstraints = @UniqueConstraint(columnNames = {"group_id", "user_id"}))
@Getter
public class GroupNoticeGrant {
    // TODO GROMO-378: 필드 + Lombok 추가 (@Builder @NoArgsConstructor(PROTECTED) @AllArgsConstructor)
    //  - Long id (@Id @GeneratedValue IDENTITY)
    //  - Group group (@ManyToOne LAZY, @JoinColumn(name="group_id") NOT NULL)
    //  - Long userId (@Column(name="user_id") NOT NULL)
    //    User FK 대신 Long 보관 — 조인 비용 절감, List<Long> 계약과 매칭
    //  import 추가 필요: Id, GeneratedValue, GenerationType, ManyToOne, JoinColumn, FetchType
}
