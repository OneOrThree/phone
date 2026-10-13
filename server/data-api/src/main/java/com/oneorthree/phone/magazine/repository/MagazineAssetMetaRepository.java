package com.oneorthree.phone.magazine.repository;

import com.oneorthree.phone.magazine.repository.domain.MagazineAssetMeta;
import org.springframework.data.jpa.repository.JpaRepository;

/** 잡지 꾸미기 재료 부가 정보 (GROMO-2289, V113) — 읽기 전용. */
public interface MagazineAssetMetaRepository extends JpaRepository<MagazineAssetMeta, String> {
}
