import { createHash } from "node:crypto";
import { Failure, requireValue } from "./store.mjs";
import { ApprovalWorkflowStore } from "./approval-workflow.mjs";

const PRODUCT_ID = /^[a-z0-9][a-z0-9._-]{0,99}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// 제어 문자가 없어야 Data 와 JS 의 문자열 이스케이프가 갈리지 않는다(계약 §0).
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;
// 정규 문자열은 Data 와 바이트 단위로 같아야 한다. 키 순서를 여기서 못 박는다.
export function grantCanonical({ productId, mode, userIds, reason }) {
  return JSON.stringify({ productId, mode, userIds, reason });
}
export function grantDigest(content) {
  return createHash("sha256").update(grantCanonical(content), "utf8").digest("hex");
}
export function parseNicknames(text) {
  return String(text ?? "").split(/\r?\n/).map(line => line.trim()).filter(Boolean);
}
export function normalizeGrantInput(input) {
  requireValue(typeof input.productId === "string" && PRODUCT_ID.test(input.productId), "지급할 아이템을 고르세요.");
  requireValue(["ALL", "USERS"].includes(input.mode), "지급 대상은 전체 또는 닉네임 목록이어야 합니다.");
  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  // Data 가 UTF-16 길이로 세어도 넘지 않도록 length 로 센다.
  requireValue(reason.length >= 1 && reason.length <= 200 && !CONTROL.test(reason),
    "지급 사유는 줄바꿈 없이 1~200자로 입력하세요.");
  // 짝 없는 서로게이트는 JS 가 \udXXX 로, Java 는 다른 바이트로 인코딩해 지문이 갈린다.
  requireValue(reason.isWellFormed(), "지급 사유에 올바르지 않은 문자가 있습니다.");
  let nicknamesText = "";
  if (input.mode === "USERS") {
    const nicknames = parseNicknames(input.nicknamesText);
    requireValue(nicknames.length >= 1 && nicknames.length <= 500, "닉네임을 줄마다 1~500개 입력하세요.");
    requireValue(new Set(nicknames.map(name => name.toLowerCase())).size === nicknames.length,
      "대소문자를 무시하면 같은 닉네임이 두 번 들어 있습니다.");
    nicknamesText = nicknames.join("\n");
  } else {
    requireValue(parseNicknames(input.nicknamesText).length === 0, "전체 지급에는 닉네임을 입력하지 않습니다.");
  }
  return { productId: input.productId, mode: input.mode, nicknamesText, reason };
}
// 미리 계산 결과(Data) -> 지문 입력. USERS 는 소문자 UUID 오름차순, ALL 은 [].
function contentOf(item) {
  const preview = item.preview;
  requireValue(preview, "미리 계산을 먼저 실행하세요.", 409);
  requireValue(preview.unknownNicknames.length === 0, "찾지 못한 닉네임이 있습니다. 닉네임을 고쳐 다시 계산하세요.", 409);
  requireValue(typeof preview.digest === "string" && preview.digest, "미리 계산 지문이 없습니다. 다시 계산하세요.", 409);
  const userIds = item.mode === "ALL" ? []
    : preview.targets.map(target => String(target.userId).toLowerCase()).sort();
  requireValue(item.mode === "ALL" || (userIds.length > 0 && userIds.every(id => UUID.test(id))),
    "대상 사용자 ID를 확인할 수 없습니다. 다시 계산하세요.", 409);
  const content = { productId: item.productId, mode: item.mode, userIds, reason: item.reason };
  requireValue(grantDigest(content) === preview.digest, "미리 계산 지문이 Data 와 다릅니다. 다시 계산하세요.", 409);
  return content;
}
export class CustomizationGrantStore extends ApprovalWorkflowStore {
  constructor(store) {
    super(store, {
      prefix: "customization_grant", noun: "지급", verb: "실행", run: "executing", done: "completed",
      idName: "grantId", resume: true,
      content: contentOf,
      digest: grantDigest,
      request: (_item, approvalId, content, digest) => ({ approvalId, ...content, digest }),
      matches: (approval, request) => approval?.approvalId === request.approvalId
        && approval.productId === request.productId && approval.mode === request.mode
        && approval.reason === request.reason && approval.digest === request.digest
        && JSON.stringify(approval.userIds) === JSON.stringify(request.userIds)
        && grantDigest(approval) === request.digest,
      // 일부라도 지급됐으면 실패로 단정하지 않고 같은 grantId 로 이어 간다.
      keepUncertain: item => Boolean(item.progress),
    });
  }
  create(input, actor) {
    return this.insert(normalizeGrantInput(input), actor);
  }
  edit(id, input, actor) {
    const fields = normalizeGrantInput(input);
    return this.applyEdit(id, input.revision, actor, item => {
      Object.assign(item, fields);
      delete item.preview;
    });
  }
  // 미리 계산에 보낼 입력. draft 만 계산할 수 있다.
  previewInput(id, revision) {
    const item = this.get(id);
    this.checkRevision(item, revision);
    requireValue(item.status === "draft", "작성 중인 지급만 미리 계산할 수 있습니다.", 409);
    return { productId: item.productId, mode: item.mode, nicknames: parseNicknames(item.nicknamesText), reason: item.reason };
  }
  savePreview(id, revision, result, actor) {
    return this.store.transaction(() => {
      const item = this.get(id);
      this.checkRevision(item, revision);
      requireValue(item.status === "draft", "작성 중인 지급만 미리 계산할 수 있습니다.", 409);
      const nicknames = parseNicknames(item.nicknamesText);
      const shape = result && result.productId === item.productId && result.mode === item.mode
        && Array.isArray(result.targets) && Array.isArray(result.unknownNicknames)
        && [result.targetCount, result.alreadyOwnedCount, result.newCount].every(Number.isInteger)
        && (result.digest === null || typeof result.digest === "string")
        && (item.mode === "ALL" ? result.targets.length === 0
          : result.targets.length + result.unknownNicknames.length === nicknames.length
            && result.targets.every(target => typeof target.nickname === "string" && UUID.test(String(target.userId).toLowerCase())));
      if (!shape) throw new Failure(502, "미리 계산 결과가 요청과 다릅니다. 다시 계산하세요.");
      item.preview = { productId: result.productId, productTitle: String(result.productTitle ?? ""), mode: result.mode,
        targets: result.targets.map(({ nickname, userId }) => ({ nickname, userId })),
        unknownNicknames: result.unknownNicknames.map(String), targetCount: result.targetCount,
        alreadyOwnedCount: result.alreadyOwnedCount, newCount: result.newCount,
        digest: result.unknownNicknames.length ? null : result.digest, previewedAt: new Date().toISOString() };
      this.event(item, actor, "preview");
      return this.save(item);
    });
  }
  // 실행 응답(RUNNING)의 진행 건수를 저장한다. 상태는 executing 그대로다.
  progress(id, execution) {
    return this.store.transaction(() => {
      const item = this.get(id);
      requireValue(item.status === "executing", "실행 상태가 변경되었습니다.", 409);
      item.progress = { status: execution.status, targetCount: execution.targetCount, grantedCount: execution.grantedCount,
        alreadyOwnedCount: execution.alreadyOwnedCount, skippedCount: execution.skippedCount, startedAt: execution.startedAt };
      item.updatedAt = new Date().toISOString();
      return this.save(item);
    });
  }
}
