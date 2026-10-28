package com.oneorthree.phone.shop.repository.domain;

import lombok.AllArgsConstructor;
import lombok.EqualsAndHashCode;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.io.Serializable;

/** 발행본 항목의 복합 PK — (publicationVersion, productId). */
@Getter
@NoArgsConstructor
@AllArgsConstructor
@EqualsAndHashCode
public class ShopCatalogPublicationEntryId implements Serializable {

    private long publicationVersion;
    private String productId;
}
