// 실제 운영 값은 Data에서 읽는다. 아래 값은 격리된 로컬 모드의 최초 예제뿐이다.
export function initialLocalPolicy() {
  return { costPolicyVersion: 1, publishedAt: new Date().toISOString(), local: true,
    items: [
      ["hall", "회관", 60, 60], ["board", "게시판", 240, 900],
      ["gram", "방송기", 1360, 1800], ["library", "도서관", 2720, 3600],
      ["mail", "우체통", 4080, 5400], ["tower", "전망대", 5440, 9000],
      ["shop", "상점", 6800, 14400],
    ].map(([buildingId, displayName, cost, buildSeconds]) => ({ buildingId, displayName, cost, buildSeconds })),
  };
}

export function validPolicyItems(items, expectedIds, minimumCost = 1) {
  return Array.isArray(items) && items.length > 0 && items.length <= 100
    && items.every(item => item && typeof item.buildingId === "string"
      && Number.isInteger(item.cost) && item.cost >= minimumCost && item.cost <= 2147483647
      && Number.isInteger(item.buildSeconds) && item.buildSeconds >= 0 && item.buildSeconds <= 2147483647)
    && new Set(items.map(item => item.buildingId)).size === items.length
    && (!expectedIds || (items.length === expectedIds.length
      && items.every(item => expectedIds.includes(item.buildingId))));
}

export function policyRequest(item) {
  const policy = item.data.construction;
  return { expectedCostPolicyVersion: policy.base.costPolicyVersion,
    items: policy.items.map(({ buildingId, cost, buildSeconds }) => ({ buildingId, cost, buildSeconds }))
      .sort((a, b) => a.buildingId.localeCompare(b.buildingId)),
  };
}
