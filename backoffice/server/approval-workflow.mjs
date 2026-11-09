import { randomUUID } from "node:crypto";
import { Failure, requireValue, publicationId } from "./store.mjs";

// 집중 정책(FocusPolicyStore)과 같은 2인 승인 흐름을 꾸미기 지급·추첨 풀이 함께 쓴다.
// 달라지는 곳(내용 검증, Data 요청 모양, 실행 이름)만 cfg 로 받는다.
// 상태·복구·최초 승인자/실행자 재시도 규칙이 한 곳에 있어야 두 기능이 어긋나지 않는다.
//
// cfg:
//   prefix        SQLite 표 접두사 (`${prefix}_drafts`, `${prefix}_snapshots`)
//   noun          메시지에 쓰는 이름 ("지급", "추첨 풀 변경안")
//   verb          메시지에 쓰는 동작 ("실행", "발행")
//   run           진행 중 상태 이름 ("publishing" | "executing")
//   done          완료 상태 이름 ("published" | "completed")
//   idName        실행 ID 필드 이름 ("publicationId" | "grantId")
//   resume        진행 중 상태에서 이어 갈 수 있는지 (executing 만 true)
//   content(item) 검토 시점의 정규 내용. 준비되지 않았으면 던진다.
//   digest(content)
//   request(item, approvalId, content, digest) Data 승인 요청 본문
//   matches(approval, request) Data 승인 응답이 요청과 같은지
//   keepUncertain(item) 이미 일부 처리됐으면 확정 실패로 보지 않는다
const EDITABLE = ["draft", "review", "approved", "failed", "approval_uncertain"];
const CLEAR_ON_EDIT = ["approvedBy", "approvedAt", "approvedDigest", "approvedContent", "approvalId", "approvalActor",
  "approvalUncertain", "error", "receipt", "dispatchActor", "runUncertain", "progress"];

export class ApprovalWorkflowStore {
  constructor(store, cfg) {
    this.store = store;
    this.db = store.db;
    this.cfg = cfg;
    const p = cfg.prefix;
    this.db.exec(`CREATE TABLE IF NOT EXISTS ${p}_drafts(id TEXT PRIMARY KEY, document TEXT NOT NULL);`
      + `CREATE TABLE IF NOT EXISTS ${p}_snapshots(draft_id TEXT NOT NULL, revision INTEGER NOT NULL,`
      + "document TEXT NOT NULL, digest TEXT NOT NULL, PRIMARY KEY(draft_id,revision));"
      + `CREATE TRIGGER IF NOT EXISTS ${p}_snapshots_no_update BEFORE UPDATE ON ${p}_snapshots`
      + " BEGIN SELECT RAISE(ABORT, 'snapshot is immutable'); END;"
      + `CREATE TRIGGER IF NOT EXISTS ${p}_snapshots_no_delete BEFORE DELETE ON ${p}_snapshots`
      + " BEGIN SELECT RAISE(ABORT, 'snapshot is immutable'); END;");
    for (const item of this.list()) if (item.status === "approving") {
      item.status = "approval_uncertain";
      item.approvalUncertain = true;
      item.error = "서버 재시작으로 승인 결과 확인이 필요합니다. 같은 승인 요청을 재시도하거나 승인을 취소하세요.";
      this.save(item);
    } else if (item.status === cfg.run) {
      // 이어 가기 대기(executing)도 같이 uncertain 이 된다. 같은 실행자가 같은 ID 로 부르면 Data 가 이어서 처리한다.
      item.status = "uncertain";
      item.error = "서버 재시작으로 처리 결과 확인이 필요합니다. 같은 요청으로 재시도하세요.";
      this.save(item);
    }
  }
  list() {
    return this.db.prepare(`SELECT document FROM ${this.cfg.prefix}_drafts ORDER BY rowid DESC`).all()
      .map(row => JSON.parse(row.document));
  }
  get(id) {
    const row = this.db.prepare(`SELECT document FROM ${this.cfg.prefix}_drafts WHERE id=?`).get(id);
    requireValue(row, `${this.cfg.noun}을 찾을 수 없습니다.`, 404);
    return JSON.parse(row.document);
  }
  save(item) {
    this.db.prepare(`INSERT INTO ${this.cfg.prefix}_drafts VALUES (?,?) ON CONFLICT(id) DO UPDATE SET document=excluded.document`)
      .run(item.id, JSON.stringify(item));
    return item;
  }
  event(item, actor, action) {
    item.updatedAt = new Date().toISOString();
    item.audit.push({ at: item.updatedAt, actor, action, revision: item.revision });
  }
  insert(fields, actor) {
    return this.store.transaction(() => {
      const item = { id: randomUUID(), revision: 1, ...fields, status: "draft",
        createdAt: new Date().toISOString(), audit: [] };
      this.event(item, actor, "create");
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
    requireValue(EDITABLE.includes(item.status),
      "처리 중이거나 완료된 항목은 수정하거나 철회할 수 없습니다.", 409);
    return item.approvalId ?? null;
  }
  // apply(item) 이 내용 필드를 바꾼다. 승인·미리 계산 같은 파생 값은 모두 지운다.
  applyEdit(id, revision, actor, apply) {
    return this.store.transaction(() => {
      const item = this.get(id);
      this.changeRequest(id, revision);
      apply(item);
      if (item.approvalId) this.event(item, actor, "revoke");
      item.revision++;
      item.status = "draft";
      for (const key of [...CLEAR_ON_EDIT, this.cfg.idName]) delete item[key];
      this.event(item, actor, "edit");
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
  snapshotRow(item) {
    return this.db.prepare(`SELECT document,digest FROM ${this.cfg.prefix}_snapshots WHERE draft_id=? AND revision=?`)
      .get(item.id, item.revision);
  }
  approvalRequest(id, revision) {
    const item = this.get(id);
    this.checkRevision(item, revision);
    requireValue(["review", "approving", "approval_uncertain"].includes(item.status),
      "검토 요청된 항목만 승인할 수 있습니다.", 409);
    const content = this.cfg.content(item), digest = this.cfg.digest(content);
    const snapshot = this.snapshotRow(item);
    requireValue(snapshot?.document === JSON.stringify(content) && snapshot?.digest === digest,
      "검토한 수정본이 다릅니다.", 409);
    const approvalId = publicationId({ id: `approval:${item.id}`, revision: item.revision });
    return this.cfg.request(item, approvalId, JSON.parse(snapshot.document), snapshot.digest);
  }
  beginApproval(id, revision, actor) {
    return this.store.transaction(() => {
      const item = this.get(id);
      requireValue(["review", "approval_uncertain"].includes(item.status),
        "검토 요청되었거나 승인 결과 확인이 필요한 항목만 승인할 수 있습니다.", 409);
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
  // action: review | approve | run(발행·실행)
  transition(id, revision, actor, action, approval) {
    const { cfg } = this;
    return this.store.transaction(() => {
      const item = this.get(id);
      this.checkRevision(item, revision);
      if (action === "review") {
        requireValue(item.status === "draft", "작성 중인 항목만 검토 요청할 수 있습니다.", 409);
        const content = cfg.content(item);
        this.db.prepare(`INSERT INTO ${cfg.prefix}_snapshots VALUES (?,?,?,?)`)
          .run(item.id, item.revision, JSON.stringify(content), cfg.digest(content));
        item.status = "review";
      } else if (action === "approve") {
        requireValue(item.status === "approving" && item.approvalActor === actor,
          "시작한 승인 요청의 운영자가 다릅니다.", 409);
        const expected = this.approvalRequest(id, revision);
        requireValue(approval?.approvedBy === actor && cfg.matches(approval, expected),
          "Data 승인 기록이 요청과 일치하지 않습니다.", 409);
        const snapshot = this.snapshotRow(item);
        item.approvalId = expected.approvalId;
        item.approvedContent = JSON.parse(snapshot.document);
        item.approvedDigest = snapshot.digest;
        item.approvedBy = approval.approvedBy;
        item.approvedAt = approval.approvedAt;
        item.status = "approved";
        delete item.approvalUncertain;
        delete item.error;
      } else if (action === "run") {
        const allowed = ["approved", "uncertain", ...(cfg.resume ? [cfg.run] : [])];
        requireValue(allowed.includes(item.status), `승인된 ${cfg.noun}만 처리할 수 있습니다.`, 409);
        requireValue(item.approvedBy !== actor, `승인자와 다른 운영자가 ${cfg.verb}해야 합니다.`, 409);
        requireValue(!item.dispatchActor || item.dispatchActor === actor,
          `결과가 불확실하거나 이어 가는 요청은 최초 ${cfg.verb} 운영자가 해야 합니다.`, 409);
        const content = cfg.content(item);
        const snapshot = this.snapshotRow(item);
        requireValue(cfg.digest(content) === item.approvedDigest
          && JSON.stringify(content) === JSON.stringify(item.approvedContent)
          && snapshot?.digest === item.approvedDigest
          && snapshot?.document === JSON.stringify(item.approvedContent),
        "승인된 스냅샷이 다릅니다.", 409);
        item.runUncertain = item.runUncertain || item.status === "uncertain";
        item.status = cfg.run;
        item.dispatchActor = actor;
        item[cfg.idName] = publicationId(item);
      } else throw new Failure(404, "지원하지 않는 동작입니다.");
      this.event(item, actor, action === "run" ? cfg.run : action);
      return this.save(item);
    });
  }
  finish(id, receipt, error) {
    const { cfg } = this;
    return this.store.transaction(() => {
      const item = this.get(id);
      requireValue(item.status === cfg.run, "처리 상태가 변경되었습니다.", 409);
      if (!error) {
        item.status = cfg.done;
        item.receipt = receipt;
        delete item.error;
      } else {
        item.runUncertain = item.runUncertain || !error.definite || Boolean(cfg.keepUncertain?.(item));
        item.status = item.runUncertain && !(error.reconciled && !cfg.keepUncertain?.(item)) ? "uncertain" : "failed";
        item.error = error.message;
      }
      this.event(item, item.dispatchActor, item.status);
      return this.save(item);
    });
  }
}
