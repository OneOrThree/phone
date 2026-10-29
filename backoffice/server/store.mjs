import { initialLocalPolicy, validPolicyItems, policyRequest } from "./construction.mjs";
import { DatabaseSync } from "node:sqlite";
import { randomUUID, createHash } from "node:crypto";
export class Failure extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
export function requireValue(condition, message, status = 400) {
  if (!condition) throw new Failure(status, message);
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const now = () => new Date().toISOString();
export function publicationId(item) {
  const hex = createHash("sha256")
    .update(`${item.id}:${item.revision}`)
    .digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
export class Store {
  constructor(path) {
    this.db = new DatabaseSync(path);
    this.db.exec(
      "PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS items(id TEXT PRIMARY KEY, document TEXT NOT NULL); CREATE TABLE IF NOT EXISTS snapshots(id TEXT PRIMARY KEY, document TEXT NOT NULL);",
    );
    this.db.exec("CREATE TABLE IF NOT EXISTS construction_policy_state(id INTEGER PRIMARY KEY CHECK(id=1), document TEXT NOT NULL); CREATE TABLE IF NOT EXISTS construction_policy_receipts(id TEXT PRIMARY KEY, digest TEXT NOT NULL, result TEXT NOT NULL);");
    // 전송 도중 재시작되면 성공 여부를 추측하지 않고 같은 멱등 키로만 재시도한다.
    for (const item of this.list())
      if (item.status === "publishing") {
        item.status = "uncertain";
        item.error =
          "서버 재시작으로 결과 확인이 필요합니다. 같은 요청으로 재시도하세요.";
        this.save(item);
      }
  }
  close() {
    this.db.close();
  }
  list() {
    return this.db
      .prepare("SELECT document FROM items ORDER BY rowid DESC")
      .all()
      .map((row) => JSON.parse(row.document));
  }
  get(id) {
    const row = this.db
      .prepare("SELECT document FROM items WHERE id=?")
      .get(id);
    requireValue(row, "항목을 찾을 수 없습니다.", 404);
    return JSON.parse(row.document);
  }
  save(item) {
    this.db
      .prepare(
        "INSERT INTO items VALUES (?,?) ON CONFLICT(id) DO UPDATE SET document=excluded.document",
      )
      .run(item.id, JSON.stringify(item));
    return item;
  }
  transaction(fn) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const value = fn();
      this.db.exec("COMMIT");
      return value;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  snapshot(value, input) {
    this.db
      .prepare("INSERT OR REPLACE INTO snapshots VALUES (?,?)")
      .run(value.snapshotId, JSON.stringify({ value, input }));
    return value;
  }
  validate(item, complete = false) {
    requireValue(
      ["fcm", "notice", "magazine", "construction"].includes(item.kind),
      "지원하지 않는 채널입니다.",
    );
    requireValue(
      typeof item.title === "string" && [...item.title].length <= 120,
      "제목은 120자 이내여야 합니다.",
    );
    requireValue(
      typeof item.body === "string" &&
        [...item.body].length <= (item.kind === "magazine" ? 80 : 10000),
      "본문 길이를 확인하세요.",
    );
    requireValue(
      item.data && typeof item.data === "object" && !Array.isArray(item.data),
      "추가 데이터는 객체여야 합니다.",
    );
    requireValue(
      Array.isArray(item.targets) &&
        item.targets.length <= 100 &&
        item.targets.every((id) => typeof id === "string" && uuid.test(id)),
      "발송 대상은 최대 100개의 사용자 UUID입니다.",
    );
    requireValue(
      new Set(item.targets.map((id) => id.toLowerCase())).size ===
        item.targets.length,
      "중복된 발송 대상을 제거하세요.",
    );
    if (item.kind === "construction" && (complete || item.data.construction)) {
      const policy = item.data.construction;
      requireValue(policy?.base && Number.isInteger(policy.base.costPolicyVersion)
        && policy.base.costPolicyVersion >= 0 && policy.base.costPolicyVersion < 2147483647
        && validPolicyItems(policy.base.items, undefined, 0), "현재 건설 정책을 먼저 불러오세요.");
      requireValue(validPolicyItems(policy.items, policy.base.items.map(row => row.buildingId)),
        "모든 건물의 비용(1 이상)과 공사 시간(0 이상)을 32비트 정수로 입력하세요.");
    }
    if (!complete) return;
    requireValue(item.title.trim(), "제목을 입력하세요.");
    if (item.kind === "fcm") {
      requireValue(
        item.targets.length > 0 && item.body.trim(),
        "본문과 발송 대상을 입력하세요.",
      );
      const fcm = item.data.fcm;
      requireValue(
        fcm && fcm.kind === "ADMIN_ANNOUNCEMENT",
        "백오피스에서는 서비스 공지(ADMIN_ANNOUNCEMENT)만 발송할 수 있습니다.",
      );
      requireValue(
        typeof fcm.locale === "string" && typeof fcm.silent === "boolean",
        "알림 locale과 silent 값을 지정하세요.",
      );
      const payload = item.data.payload ?? {};
      requireValue(
        payload &&
          typeof payload === "object" &&
          !Array.isArray(payload) &&
          Object.values(payload).every((v) => typeof v === "string"),
        "FCM data 값은 문자열이어야 합니다.",
      );
      requireValue(
        Buffer.byteLength(
          JSON.stringify({
            notification: { title: item.title, body: item.body },
            data: payload,
          }),
        ) <= 4096,
        "FCM 메시지는 4096바이트 이내여야 합니다.",
      );
    }
    if (item.kind === "notice") {
      requireValue(item.body.trim(), "본문을 입력하세요.");
      requireValue(
        typeof item.startsAt === "string" &&
          Number.isFinite(Date.parse(item.startsAt)),
        "게시 시작 시각을 입력하세요.",
      );
      requireValue(
        !item.endsAt ||
          (Number.isFinite(Date.parse(item.endsAt)) &&
            Date.parse(item.endsAt) > Date.parse(item.startsAt)),
        "종료 시각은 시작 시각 이후여야 합니다.",
      );
    }
    if (item.kind === "magazine") {
      const snapshot = item.data.snapshot;
      requireValue(
        snapshot?.snapshotId && snapshot.digest,
        "잡지 게시 내용을 먼저 불러오세요.",
      );
      const row = this.db
        .prepare("SELECT document FROM snapshots WHERE id=?")
        .get(snapshot.snapshotId);
      requireValue(row, "검토 가능한 잡지 스냅샷이 없습니다.");
      const stored = JSON.parse(row.document);
      requireValue(
        JSON.stringify(stored.value) === JSON.stringify(snapshot) &&
          stored.input.issueDate === item.issueDate &&
          (stored.input.editorialBody ?? "") === item.body,
        "잡지 내용이 변경되었습니다. 게시 내용을 다시 불러오세요.",
        409,
      );
    }
  }
  fields(input) {
    const fields = Object.fromEntries(
      ["title", "body", "targets", "data", "issueDate", "startsAt", "endsAt"]
        .filter((k) => Object.hasOwn(input, k))
        .map((k) => [k, input[k]]),
    );
    const reference = fields.data?.snapshot;
    if (
      reference &&
      Object.keys(reference).every((key) =>
        ["snapshotId", "digest"].includes(key),
      )
    ) {
      requireValue(
        typeof reference.snapshotId === "string" &&
          typeof reference.digest === "string",
        "잡지 스냅샷 참조를 확인하세요.",
      );
      const row = this.db
        .prepare("SELECT document FROM snapshots WHERE id=?")
        .get(reference.snapshotId);
      requireValue(row, "검토 가능한 잡지 스냅샷이 없습니다.", 409);
      const stored = JSON.parse(row.document);
      requireValue(
        stored.value.digest === reference.digest,
        "잡지 스냅샷이 다릅니다. 다시 불러오세요.",
        409,
      );
      fields.data = { ...fields.data, snapshot: stored.value };
    }
    if (fields.data?.construction) {
      const proposal = fields.data.construction;
      const row = this.db.prepare("SELECT document FROM snapshots WHERE id=?").get(proposal.snapshotId);
      requireValue(row, "현재 건설 정책을 다시 불러오세요.", 409);
      const stored = JSON.parse(row.document);
      requireValue(stored.input.kind === "construction" && stored.value.digest === proposal.digest,
        "검토 기준 건설 정책이 다릅니다. 다시 불러오세요.", 409);
      fields.data = { ...fields.data, construction: { snapshotId: proposal.snapshotId,
        digest: proposal.digest, base: stored.value, items: proposal.items } };
    }
    return fields;
  }
  constructionSnapshot(value) {
    requireValue(Number.isInteger(value.costPolicyVersion) && value.costPolicyVersion >= 0
      && validPolicyItems(value.items, undefined, 0), "서버 건설 정책을 확인할 수 없습니다.", 502);
    const snapshot = { ...value, snapshotId: randomUUID(),
      digest: createHash("sha256").update(JSON.stringify(value)).digest("hex") };
    return this.snapshot(snapshot, { kind: "construction" });
  }
  localConstructionPolicy() {
    const row = this.db.prepare("SELECT document FROM construction_policy_state WHERE id=1").get();
    if (row) return JSON.parse(row.document);
    const initial = initialLocalPolicy();
    this.db.prepare("INSERT INTO construction_policy_state VALUES(1,?)").run(JSON.stringify(initial));
    return initial;
  }
  applyLocalConstructionPolicy(item, actor) {
    return this.transaction(() => {
      const input = policyRequest(item);
      const digest = createHash("sha256").update(JSON.stringify(input)).digest("hex");
      const previous = this.db.prepare("SELECT digest,result FROM construction_policy_receipts WHERE id=?")
        .get(item.publicationId);
      if (previous) {
        requireValue(previous.digest === digest, "이미 다른 내용으로 적용한 요청입니다.", 409);
        return JSON.parse(previous.result);
      }
      const before = this.localConstructionPolicy();
      requireValue(before.costPolicyVersion === input.expectedCostPolicyVersion,
        "건설 정책이 변경됐습니다. 현재 정책을 다시 불러와 검토하세요.", 409);
      requireValue(validPolicyItems(input.items, before.items.map(row => row.buildingId)),
        "건설 정책 값을 확인하세요.");
      const publishedAt = now();
      const items = before.items.map(row => ({ ...row,
        ...input.items.find(value => value.buildingId === row.buildingId) }));
      const result = { publicationId: item.publicationId, previousRevision: before.costPolicyVersion,
        costPolicyVersion: before.costPolicyVersion + 1, publishedAt, actor, before: before.items, items, local: true };
      this.db.prepare("UPDATE construction_policy_state SET document=? WHERE id=1")
        .run(JSON.stringify({ costPolicyVersion: result.costPolicyVersion, publishedAt, items, local: true }));
      this.db.prepare("INSERT INTO construction_policy_receipts VALUES(?,?,?)")
        .run(item.publicationId, digest, JSON.stringify(result));
      return result;
    });
  }
  event(item, actor, action) {
    item.updatedAt = now();
    item.audit.push({
      at: item.updatedAt,
      actor,
      action,
      revision: item.revision,
    });
  }
  create(input, actor) {
    const item = {
      id: randomUUID(),
      kind: input.kind,
      title: "",
      body: "",
      targets: [],
      data: {},
      ...this.fields(input),
      revision: 1,
      status: "draft",
      createdAt: now(),
      updatedAt: now(),
      audit: [],
    };
    this.validate(item);
    this.event(item, actor, "create");
    return this.save(item);
  }
  edit(id, input, actor) {
    return this.transaction(() => {
      const item = this.get(id);
      this.checkRevision(item, input);
      requireValue(
        ["draft", "review", "approved", "failed"].includes(item.status),
        "발송·게시 중이거나 완료된 항목은 수정할 수 없습니다.",
        409,
      );
      Object.assign(item, this.fields(input));
      item.revision++;
      item.status = "draft";
      delete item.approvedBy;
      delete item.approvedAt;
      delete item.error;
      delete item.receipt;
      delete item.dispatchActor;
      this.validate(item);
      this.event(item, actor, "edit");
      return this.save(item);
    });
  }
  checkRevision(item, input) {
    requireValue(
      Number.isInteger(input.revision) && item.revision === input.revision,
      "다른 변경이 있습니다. 새로고침 후 다시 시도하세요.",
      409,
    );
  }
  transition(id, input, actor, action) {
    return this.transaction(() => {
      const item = this.get(id);
      this.checkRevision(item, input);
      this.validate(item, true);
      if (action === "review") {
        requireValue(
          item.status === "draft",
          "작성 중인 항목만 검토 요청할 수 있습니다.",
          409,
        );
        item.status = "review";
      } else if (action === "approve") {
        requireValue(
          item.status === "review",
          "검토 요청된 항목만 승인할 수 있습니다.",
          409,
        );
        item.status = "approved";
        item.approvedBy = actor;
        item.approvedAt = now();
      } else {
        requireValue(
          item.status === "approved" || item.status === "uncertain",
          "승인된 버전만 발송·게시할 수 있습니다.",
          409,
        );
        requireValue(
          !item.dispatchActor || item.dispatchActor === actor,
          "결과가 불확실한 요청은 최초 발송자가 재시도해야 합니다.",
          409,
        );
        item.publicationUncertain =
          item.publicationUncertain || item.status === "uncertain";
        item.status = "publishing";
        item.dispatchActor = actor;
        item.publicationId = publicationId(item);
      }
      this.event(item, actor, action);
      return this.save(item);
    });
  }
  finish(id, receipt, error) {
    return this.transaction(() => {
      const item = this.get(id);
      requireValue(
        item.status === "publishing",
        "발송 상태가 변경되었습니다.",
        409,
      );
      if (!error) {
        item.status = "published";
        item.receipt = receipt;
        delete item.error;
      } else {
        item.publicationUncertain =
          item.publicationUncertain || !error.definite;
        item.status = item.publicationUncertain ? "uncertain" : "failed";
        item.error = error.message;
      }
      this.event(item, item.dispatchActor, item.status);
      return this.save(item);
    });
  }
}
