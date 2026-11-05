package com.oneorthree.phone.group.repository;

import com.oneorthree.phone.group.repository.domain.WebIslandPool;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;

public interface WebIslandPoolRepository extends JpaRepository<WebIslandPool, String> {
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select p from WebIslandPool p where p.id = 'main'")
    WebIslandPool lockMain();
}
