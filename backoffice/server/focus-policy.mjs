import { createHash, randomUUID } from "node:crypto";
import { Failure, requireValue, publicationId } from "./store.mjs";

const FIELDS = ["secondsPerFish", "dailyCapFish", "personalSharePercent", "goldenFishReward", "goldenMaxMembers", "goldenChancePpm"];
const LIMITS = { secondsPerFish: [30, 86400], dailyCapFish: [0, 960], personalSharePercent: [0, 0],
  goldenFishReward: [0, 1000], goldenMaxMembers: [2, 15] };
export function normalizeFocusPolicy(input) {
  requireValue(input && typeof input === "object" && !Array.isArray(input), "집중 보상 정책을 확인하세요.");
  requireValue(Object.keys(input).length === FIELDS.length && FIELDS.every(key => Object.hasOwn(input, key)),
    "집중 보상 정책 필드를 확인하세요.");
  const policy = Object.fromEntries(FIELDS.map(key => [key, input[key]]));
  requireValue(policy.personalSharePercent === 0, "개인 지갑 몫은 0으로 고정됩니다.");
  for (const key of FIELDS.slice(0, 5)) {
    const [min, max] = LIMITS[key];
    requireValue(Number.isInteger(policy[key]) && policy[key] >= min && policy[key] <= max,
      `${key} 값은 ${min}~${max} 정수여야 합니다.`);
  }
  requireValue(Array.isArray(policy.goldenChancePpm)
    && policy.goldenChancePpm.length === policy.goldenMaxMembers - 1
    && policy.goldenChancePpm.every(value => Number.isInteger(value) && value >= 0 && value <= 1_000_000),
  "황금 물고기 확률표는 2명부터 인원 상한까지의 0~1000000 ppm 정수여야 합니다.");
  return policy;
}
export function focusDigest(policy) {
  return createHash("sha256").update(JSON.stringify(normalizeFocusPolicy(policy)), "utf8").digest("hex");
}
export class FocusPolicyStore {
  constructor(store) {
    this.store = store;
    this.db = store.db;
    this.db.exec("CREATE TABLE IF NOT EXISTS focus_policy_drafts(id TEXT PRIMARY KEY, document TEXT NOT NULL);"
      + "CREATE TABLE IF NOT EXISTS focus_policy_snapshots(draft_id TEXT NOT NULL, revision INTEGER NOT NULL,"
      + "document TEXT NOT NULL, digest TEXT NOT NULL, PRIMARY KEY(draft_id,revision));"
      + "CREATE TRIGGER IF NOT EXISTS focus_policy_snapshots_no_update BEFORE UPDATE ON focus_policy_snapshots"
      + " BEGIN SELECT RAISE(ABORT, 'policy snapshot is immutable'); END;"
      + "CREATE TRIGGER IF NOT EXISTS focus_policy_snapshots_no_delete BEFORE DELETE ON focus_policy_snapshots"
      + " BEGIN SELECT RAISE(ABORT, 'policy snapshot is immutable'); END;");
    for (const item of this.list()) if (item.status === "approving") {
      item.status = "approval_uncertain";
      item.approvalUncertain = true;
      item.error = "서버 재시작으로 승인 결과 확인이 필요합니다. 같은 승인 요청을 재시도하거나 승인을 취소하세요.";
      this.save(item);
    } else if (item.status === "publishing") {
      item.status = "uncertain";
      item.error = "서버 재시작으로 적용 결과 확인이 필요합니다. 같은 요청으로 재시도하세요.";
      this.save(item);
    }
  }
  list() {
    return this.db.prepare("SELECT document FROM focus_policy_drafts ORDER BY rowid DESC").all()
      .map(row => JSON.parse(row.document));
  }
  get(id) {
    const row = this.db.prepare("SELECT document FROM focus_policy_drafts WHERE id=?").get(id);
    requireValue(row, "정책 변경안을 찾을 수 없습니다.", 404);
    return JSON.parse(row.document);
  }
  save(item) {
    this.db.prepare("INSERT INTO focus_policy_drafts VALUES (?,?) ON CONFLICT(id) DO UPDATE SET document=excluded.document")
      .run(item.id, JSON.stringify(item));
    return item;
  }
  event(item, actor, action) {
    item.updatedAt = new Date().toISOString();
    item.audit.push({ at: item.updatedAt, actor, action, revision: item.revision });
  }
  snapshot(item) {
    const policy = normalizeFocusPolicy(item.policy);
    this.db.prepare("INSERT INTO focus_policy_snapshots VALUES (?,?,?,?)")
      .run(item.id, item.revision, JSON.stringify(policy), focusDigest(policy));
  }
  create(input, actor) {
    const policy = normalizeFocusPolicy(input.policy);
    requireValue(Number.isInteger(input.expectedRevision) && input.expectedRevision > 0,
      "현재 정책 revision을 확인하세요.");
    return this.store.transaction(() => {
      const item = { id: randomUUID(), revision: 1, expectedRevision: input.expectedRevision, policy,
        status: "draft", createdAt: new Date().toISOString(), audit: [] };
      this.event(item, actor, "create");
      this.snapshot(item);
      return this.save(item);
    });
  }
  checkRevision(item, revision) {
    requireValue(Number.isInteger(revision) && item.revision === revision,
      "다른 변경이 있습니다. 새로고침 후 다시 시도하세요.", 409);
  }
  changeRequest(id, revision) {
    const item = this.get(id);
    this.checkRevision(item, revision);
    requireValue(["draft", "review", "approved", "failed", "approval_uncertain"].includes(item.status),
      "적용 중이거나 완료된 정책은 수정하거나 철회할 수 없습니다.", 409);
    return item.approvalId ?? null;
  }
  edit(id, input, actor) {
    return this.store.transaction(() => {
      const item = this.get(id);
      this.changeRequest(id, input.revision);
      const policy = normalizeFocusPolicy(input.policy);
      requireValue(Number.isInteger(input.expectedRevision) && input.expectedRevision > 0,
        "현재 정책 revision을 확인하세요.");
      item.policy = policy;
      item.expectedRevision = input.expectedRevision;
      if (item.approvalId) this.event(item, actor, "revoke");
      item.revision++;
      item.status = "draft";
      delete item.approvedBy;
      delete item.approvedAt;
      delete item.approvedDigest;
      delete item.approvedPolicy;
      delete item.approvalId;
      delete item.approvalActor;
      delete item.approvalUncertain;
      delete item.error;
      delete item.receipt;
      delete item.dispatchActor;
      delete item.publicationId;
      delete item.publicationUncertain;
      this.event(item, actor, "edit");
      this.snapshot(item);
      return this.save(item);
    });
  }
  cancel(id, revision, actor) {
    return this.store.transaction(() => {
      const item = this.get(id);
      this.changeRequest(id, revision);
      item.status = "cancelled";
      if (item.approvalId) this.event(item, actor, "revoke");
      this.event(item, actor, "cancel");
      return this.save(item);
    });
  }
  approvalRequest(id, revision) {
    const item = this.get(id);
    this.checkRevision(item, revision);
    requireValue(["review", "approving", "approval_uncertain"].includes(item.status), "검토 요청된 정책만 승인할 수 있습니다.", 409);
    const snapshot = this.db.prepare("SELECT document,digest FROM focus_policy_snapshots WHERE draft_id=? AND revision=?")
      .get(item.id, item.revision);
    requireValue(snapshot?.document === JSON.stringify(normalizeFocusPolicy(item.policy))
      && snapshot?.digest === focusDigest(item.policy), "검토한 정책 수정본이 다릅니다.", 409);
    return { approvalId: publicationId({ id: `approval:${item.id}`, revision: item.revision }),
      expectedRevision: item.expectedRevision, policy: JSON.parse(snapshot.document), approvedDigest: snapshot.digest };
  }
  beginApproval(id, revision, actor) {
    return this.store.transaction(() => {
      const item = this.get(id);
      requireValue(["review", "approval_uncertain"].includes(item.status),
        "검토 요청되었거나 승인 결과 확인이 필요한 정책만 승인할 수 있습니다.", 409);
      requireValue(!item.approvalActor || item.approvalActor === actor,
        "승인 결과가 불확실한 요청은 최초 승인자가 재시도해야 합니다.", 409);
      const request = this.approvalRequest(id, revision);
      item.approvalId = request.approvalId;
      item.approvalActor = actor;
      item.approvalUncertain = item.approvalUncertain || item.status === "approval_uncertain";
      item.status = "approving";
      this.event(item, actor, "approving");
      this.save(item);
      return request;
    });
  }
  failApproval(id, error) {
    return this.store.transaction(() => {
      const item = this.get(id);
      requireValue(item.status === "approving", "승인 상태가 변경되었습니다.", 409);
      item.approvalUncertain = item.approvalUncertain || !error.definite;
      item.status = item.approvalUncertain ? "approval_uncertain" : "review";
      const actor = item.approvalActor;
      if (!item.approvalUncertain) {
        delete item.approvalId;
        delete item.approvalActor;
      }
      item.error = error.message;
      this.event(item, actor, item.status);
      return this.save(item);
    });
  }
  transition(id, revision, actor, action, approval) {
    return this.store.transaction(() => {
      const item = this.get(id);
      this.checkRevision(item, revision);
      if (action === "review") {
        requireValue(item.status === "draft", "작성 중인 정책만 검토 요청할 수 있습니다.", 409);
        item.status = "review";
      } else if (action === "approve") {
        requireValue(item.status === "approving" && item.approvalActor === actor,
          "시작한 승인 요청의 운영자가 다릅니다.", 409);
        const expected = this.approvalRequest(id, revision);
        requireValue(approval?.approvalId === expected.approvalId
          && approval?.approvedBy === actor
          && approval?.expectedRevision === expected.expectedRevision
          && approval?.approvedDigest === expected.approvedDigest
          && approval?.policy && focusDigest(approval.policy) === expected.approvedDigest,
        "Data 승인 기록이 변경안과 일치하지 않습니다.", 409);
        item.approvalId = expected.approvalId;
        item.approvedPolicy = expected.policy;
        item.approvedDigest = expected.approvedDigest;
        item.approvedBy = approval.approvedBy;
        item.approvedAt = approval.approvedAt;
        item.status = "approved";
        delete item.approvalUncertain;
        delete item.error;
      } else if (action === "publish") {
        requireValue(item.status === "approved" || item.status === "uncertain",
          "승인된 정책만 적용할 수 있습니다.", 409);
        requireValue(item.approvedBy !== actor,
          "운영 정책은 승인자와 다른 운영자가 적용해야 합니다.", 409);
        requireValue(!item.dispatchActor || item.dispatchActor === actor,
          "결과가 불확실한 요청은 최초 적용자가 재시도해야 합니다.", 409);
        const snapshot = this.db.prepare("SELECT document,digest FROM focus_policy_snapshots WHERE draft_id=? AND revision=?")
          .get(item.id, item.revision);
        requireValue(focusDigest(item.policy) === item.approvedDigest
          && JSON.stringify(item.policy) === JSON.stringify(item.approvedPolicy)
          && snapshot?.digest === item.approvedDigest
          && snapshot?.document === JSON.stringify(item.approvedPolicy),
        "승인된 정책 스냅샷이 다릅니다.", 409);
        item.publicationUncertain = item.publicationUncertain || item.status === "uncertain";
        item.status = "publishing";
        item.dispatchActor = actor;
        item.publicationId = publicationId(item);
      } else throw new Failure(404, "지원하지 않는 정책 동작입니다.");
      this.event(item, actor, action);
      return this.save(item);
    });
  }
  finish(id, receipt, error) {
    return this.store.transaction(() => {
      const item = this.get(id);
      requireValue(item.status === "publishing", "적용 상태가 변경되었습니다.", 409);
      if (!error) {
        item.status = "published";
        item.receipt = receipt;
        delete item.error;
      } else {
        item.publicationUncertain = item.publicationUncertain || !error.definite;
        item.status = item.publicationUncertain && !error.reconciled ? "uncertain" : "failed";
        item.error = error.message;
      }
      this.event(item, item.dispatchActor, item.status);
      return this.save(item);
    });
  }
  versions(id) {
    this.get(id);
    return this.db.prepare("SELECT revision, document, digest FROM focus_policy_snapshots WHERE draft_id=? ORDER BY revision DESC")
      .all(id).map(row => ({ revision: row.revision, policy: JSON.parse(row.document), digest: row.digest }));
  }
}
