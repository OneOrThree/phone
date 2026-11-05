package com.oneorthree.phone.group.repository.domain;

import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.util.UUID;

/** 웹 입장의 배정 단위. 지금은 main 한 곳이며 다음 분할 때 배정 규칙만 확장한다. */
@Entity
@Table(name = "web_island_pools")
@Getter
@NoArgsConstructor
public class WebIslandPool {
    @Id
    private String id;
    private UUID islandId;

    public void assign(UUID next) {
        islandId = next;
    }
}
