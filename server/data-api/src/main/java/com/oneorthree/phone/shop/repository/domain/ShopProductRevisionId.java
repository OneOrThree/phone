package com.oneorthree.phone.shop.repository.domain;

import lombok.AllArgsConstructor;
import lombok.EqualsAndHashCode;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.io.Serializable;

/** 판매 revision 의 복합 PK — (productId, revision). */
@Getter
@NoArgsConstructor
@AllArgsConstructor
@EqualsAndHashCode
public class ShopProductRevisionId implements Serializable {

    private String productId;
    private int revision;
}
