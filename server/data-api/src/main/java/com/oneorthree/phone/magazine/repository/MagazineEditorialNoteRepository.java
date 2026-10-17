package com.oneorthree.phone.magazine.repository;

import com.oneorthree.phone.magazine.repository.domain.MagazineEditorialNote;
import org.springframework.data.jpa.repository.JpaRepository;

import java.time.LocalDate;

/** 편집부 소식 (GROMO-2289, V120) — 읽기 전용, 행은 운영 SQL 이 넣는다. */
public interface MagazineEditorialNoteRepository extends JpaRepository<MagazineEditorialNote, LocalDate> {
}
