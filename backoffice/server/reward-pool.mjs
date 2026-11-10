import { createHash } from "node:crypto";
import { requireValue } from "./store.mjs";
import { ApprovalWorkflowStore } from "./approval-workflow.mjs";

const PRODUCT_ID = /^[a-z0-9][a-z0-9._-]{0,99}$/;
// 정규 문자열은 Data 와 바이트 단위로 같아야 한다(계약 §0). productIds 는 오름차순이다.
export function poolDigest(productIds) {
  return createHash("sha256").update(JSON.stringify({ productIds }), "utf8").digest("hex");
}
export function normalizePool(productIds) {
  requireValue(Array.isArray(productIds) && productIds.length >= 1 && productIds.length <= 500
    && productIds.every(id => typeof id === "string" && PRODUCT_ID.test(id)),
  "추첨 풀에는 상품을 1개 이상 넣어야 합니다.");
  requireValue(new Set(productIds).size === productIds.length, "추첨 풀에 같은 상품이 두 번 들어 있습니다.");
  return [...productIds].sort();
}
function expected(value) {
  requireValue(Number.isInteger(value) && value > 0, "현재 추첨 풀 revision을 확인하세요.");
  return value;
}
export class RewardPoolStore extends ApprovalWorkflowStore {
  constructor(store) {
    super(store, {
      prefix: "reward_pool", noun: "추첨 풀 변경안", verb: "발행", run: "publishing", done: "published",
      idName: "publicationId", resume: false,
      content: item => ({ productIds: normalizePool(item.productIds) }),
      digest: content => poolDigest(content.productIds),
      request: (item, approvalId, content, digest) => ({ approvalId, expectedRevision: item.expectedRevision,
        productIds: content.productIds, approvedDigest: digest }),
      matches: (approval, request) => approval?.approvalId === request.approvalId
        && approval.expectedRevision === request.expectedRevision
        && approval.approvedDigest === request.approvedDigest
        && JSON.stringify(approval.productIds) === JSON.stringify(request.productIds)
        && poolDigest(approval.productIds) === request.approvedDigest,
    });
  }
  create(input, actor) {
    return this.insert({ expectedRevision: expected(input.expectedRevision),
      productIds: normalizePool(input.productIds) }, actor);
  }
  edit(id, input, actor) {
    const productIds = normalizePool(input.productIds), expectedRevision = expected(input.expectedRevision);
    return this.applyEdit(id, input.revision, actor, item => {
      item.productIds = productIds;
      item.expectedRevision = expectedRevision;
    });
  }
}
