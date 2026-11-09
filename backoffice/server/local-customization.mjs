import { createHash } from "node:crypto";
import { Failure } from "./store.mjs";
import { grantDigest } from "./customization-grant.mjs";
import { poolDigest } from "./reward-pool.mjs";

// 로컬 모드의 Data 흉내(계약 §2·§3). 외부 호출은 없고, 규칙(2인·멱등 영수증·revision 409·RUNNING 이어 하기)만 같게 둔다.
// 정산·추첨·카탈로그는 만들지 않는다. 풀 발행은 revision 이 오르고, 지급은 보유 행만 늘린다.
const RARITIES = ["common", "uncommon", "rare", "legendary"];
const WEIGHTS = { head: 1, neck: 1 };
const ITEMS = [
  ["cust.head.bun", "동그란 올림머리", "head", "common"],
  ["cust.head.mandarin", "귤 한 알", "head", "uncommon"],
  ["cust.head.crown", "작은 왕관", "head", "rare"],
  ["cust.head.halo", "달빛 후광", "head", "legendary"],
  ["cust.neck.bell", "방울 목걸이", "neck", "common"],
  ["cust.neck.scarf", "털실 목도리", "neck", "uncommon"],
  ["cust.neck.ribbon", "비단 리본", "neck", "rare"],
  ["cust.neck.pearl", "진주 목걸이", "neck", "legendary"],
].map(([productId, title, category, rarity], sortOrder) => ({ productId, title, kind: category, category, rarity,
  imagePath: `/static/customization/${category}/${productId.split(".")[2]}.png`, displayable: true, sortOrder, retiredAt: null }));
// 보상 행이 없는 정적 상품: 지급 목록에서 빠지는지 화면에서 확인한다.
ITEMS.push({ productId: "cust.head.old", title: "단종된 모자", kind: "head", category: null, rarity: null,
  imagePath: "/static/customization/head/old.png", displayable: true, sortOrder: 99, retiredAt: "2026-10-01T00:00:00.000Z" });
const INITIAL_POOL = ["cust.head.bun", "cust.head.crown", "cust.head.halo", "cust.head.mandarin",
  "cust.neck.bell", "cust.neck.ribbon", "cust.neck.scarf"];
const USERS = [1, 2, 3].map(n => ({ userId: `0192f5a0-0000-7000-8000-00000000000${n}`, nickname: `local-cat-${n}`,
  createdAt: "2026-10-01T00:00:00.000Z" }));
const SEED_OWNED = [[USERS[0].userId, "cust.head.bun"], [USERS[1].userId, "cust.head.bun"], [USERS[1].userId, "cust.neck.bell"]];
const sha = value => createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
const fail = (status, message) => Object.assign(new Failure(status, message), { definite: true });

export class LocalCustomizationData {
  constructor(store, { chunkSize = 200 } = {}) {
    this.store = store;
    this.db = store.db;
    this.chunkSize = chunkSize;
    this.db.exec("CREATE TABLE IF NOT EXISTS local_customization(kind TEXT NOT NULL, id TEXT NOT NULL,"
      + "document TEXT NOT NULL, PRIMARY KEY(kind,id));");
    for (const [userId, productId] of SEED_OWNED)
      this.db.prepare("INSERT OR IGNORE INTO local_customization VALUES('owned',?,?)")
        .run(`${userId}|${productId}`, JSON.stringify({ userId, productId }));
  }
  rows(kind) {
    return this.db.prepare("SELECT document FROM local_customization WHERE kind=? ORDER BY rowid").all(kind)
      .map(row => JSON.parse(row.document));
  }
  row(kind, id) {
    const row = this.db.prepare("SELECT document FROM local_customization WHERE kind=? AND id=?").get(kind, id);
    return row ? JSON.parse(row.document) : null;
  }
  put(kind, id, value) {
    this.db.prepare("INSERT INTO local_customization VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET document=excluded.document")
      .run(kind, id, JSON.stringify(value));
    return value;
  }
  currentPool() {
    const stored = this.rows("pool").sort((a, b) => b.revision - a.revision)[0];
    return stored ?? { revision: 1, productIds: INITIAL_POOL, publishedAt: null };
  }
  owned() {
    return this.rows("owned");
  }
  items() {
    const pool = this.currentPool();
    const counts = new Map();
    for (const row of this.owned()) counts.set(row.productId, (counts.get(row.productId) ?? 0) + 1);
    return { pool: { revision: pool.revision, categoryWeights: WEIGHTS, productIds: pool.productIds },
      items: ITEMS.map(item => ({ ...item, inPool: pool.productIds.includes(item.productId)
        && item.category !== null && WEIGHTS[item.category] > 0, ownerCount: counts.get(item.productId) ?? 0 })) };
  }
  validatePool(productIds) {
    if (!Array.isArray(productIds) || !productIds.length || new Set(productIds).size !== productIds.length
      || productIds.some((id, index) => typeof id !== "string" || (index && productIds[index - 1] >= id)))
      throw fail(400, "추첨 풀은 1개 이상, 중복 없이 정렬된 상품이어야 합니다.");
    const picked = productIds.map(id => ITEMS.find(item => item.productId === id));
    if (picked.some(item => !item || !["head", "neck"].includes(item.category)))
      throw fail(400, "머리·목 보상 상품만 추첨 풀에 넣을 수 있습니다.");
    for (const category of Object.keys(WEIGHTS)) for (const rarity of RARITIES)
      if (!picked.some(item => item.category === category && item.rarity === rarity))
        throw fail(400, `${category} ${rarity} 등급 상품이 풀에 하나 이상 있어야 합니다.`);
  }
  pool() {
    const current = this.currentPool();
    return { current: { revision: current.revision, productIds: current.productIds, publishedAt: current.publishedAt },
      history: this.rows("poolPublication").map(({ requestDigest, ...value }) => value).reverse() };
  }
  approvalView(approval) {
    const { requestDigest, revokedAt, revokedBy, usedBy, ...value } = approval;
    return value;
  }
  approvePool(approvalId, body, actor) {
    const requestDigest = sha(body);
    const previous = this.row("poolApproval", approvalId);
    if (previous) {
      if (previous.revokedAt || previous.requestDigest !== requestDigest)
        throw fail(409, "취소됐거나 다른 내용으로 쓰인 승인 ID입니다.");
      return this.approvalView(previous);
    }
    this.validatePool(body.productIds);
    if (poolDigest(body.productIds) !== body.approvedDigest) throw fail(409, "승인 지문이 요청과 다릅니다.");
    if (body.expectedRevision !== this.currentPool().revision) throw fail(409, "추첨 풀 revision이 바뀌었습니다.");
    return this.approvalView(this.put("poolApproval", approvalId, { approvalId, expectedRevision: body.expectedRevision,
      productIds: body.productIds, approvedDigest: body.approvedDigest, requestDigest, approvedBy: actor,
      approvedAt: new Date().toISOString() }));
  }
  revoke(kind, approvalId) {
    const approval = this.row(kind, approvalId);
    if (!approval) throw fail(404, "승인 기록이 없습니다.");
    if (approval.usedBy) throw fail(409, "이미 사용한 승인은 취소할 수 없습니다.");
    if (!approval.revokedAt) this.put(kind, approvalId, { ...approval, revokedAt: new Date().toISOString() });
    return { ok: true, local: true };
  }
  revokePool(approvalId) { return this.revoke("poolApproval", approvalId); }
  revokeGrant(approvalId) { return this.revoke("grantApproval", approvalId); }
  publishPool(publicationId, body, actor) {
    const requestDigest = sha(body);
    const previous = this.row("poolPublication", publicationId);
    if (previous) {
      if (previous.requestDigest !== requestDigest) throw fail(409, "이미 다른 내용으로 발행한 요청입니다.");
      const { requestDigest: _drop, ...value } = previous;
      return value;
    }
    const approval = this.row("poolApproval", body.approvalId);
    if (!approval) throw fail(404, "승인 기록이 없습니다.");
    if (approval.revokedAt || approval.usedBy) throw fail(409, "취소됐거나 이미 쓴 승인입니다.");
    if (approval.approvedBy === actor) throw fail(409, "승인자와 다른 운영자가 발행해야 합니다.");
    if (body.approvedDigest !== approval.approvedDigest || poolDigest(body.productIds) !== approval.approvedDigest
      || body.expectedRevision !== approval.expectedRevision) throw fail(409, "승인한 내용과 다릅니다.");
    const current = this.currentPool();
    if (body.expectedRevision !== current.revision) throw fail(409, "추첨 풀 revision이 바뀌었습니다.");
    return this.store.transaction(() => {
      const publishedAt = new Date().toISOString();
      this.put("pool", String(current.revision + 1), { revision: current.revision + 1, productIds: body.productIds, publishedAt });
      this.put("poolApproval", approval.approvalId, { ...approval, usedBy: publicationId });
      const value = { publicationId, approvalId: approval.approvalId, revision: current.revision + 1,
        previousRevision: current.revision, productIds: body.productIds, previousProductIds: current.productIds,
        actor, approvedBy: approval.approvedBy, approvedDigest: approval.approvedDigest, publishedAt, local: true };
      this.put("poolPublication", publicationId, { ...value, requestDigest });
      return value;
    });
  }
  grantableItem(productId) {
    const item = ITEMS.find(value => value.productId === productId);
    if (!item || !item.displayable || item.retiredAt) throw fail(400, "지급할 수 없는 상품입니다.");
    return item;
  }
  previewGrant(input) {
    const item = this.grantableItem(input.productId);
    const owners = new Set(this.owned().filter(row => row.productId === item.productId).map(row => row.userId));
    if (input.mode === "ALL") {
      const targets = USERS;
      const already = targets.filter(user => owners.has(user.userId)).length;
      return { productId: item.productId, productTitle: item.title, mode: "ALL", reason: input.reason, targets: [],
        unknownNicknames: [], targetCount: targets.length, alreadyOwnedCount: already, newCount: targets.length - already,
        digest: grantDigest({ productId: item.productId, mode: "ALL", userIds: [], reason: input.reason }) };
    }
    if (input.mode !== "USERS" || !Array.isArray(input.nicknames) || !input.nicknames.length || input.nicknames.length > 500)
      throw fail(400, "닉네임을 1~500개 입력하세요.");
    const names = input.nicknames.map(name => String(name).trim());
    if (new Set(names.map(name => name.toLowerCase())).size !== names.length) throw fail(400, "같은 닉네임이 두 번 들어 있습니다.");
    const targets = [], unknownNicknames = [];
    for (const [index, name] of names.entries()) {
      const user = USERS.find(value => value.nickname.toLowerCase() === name.toLowerCase());
      if (user) targets.push({ nickname: user.nickname, userId: user.userId }); else unknownNicknames.push(input.nicknames[index]);
    }
    const already = targets.filter(target => owners.has(target.userId)).length;
    const userIds = targets.map(target => target.userId).sort();
    return { productId: item.productId, productTitle: item.title, mode: "USERS", reason: input.reason, targets,
      unknownNicknames, targetCount: targets.length, alreadyOwnedCount: already, newCount: targets.length - already,
      digest: unknownNicknames.length ? null : grantDigest({ productId: item.productId, mode: "USERS", userIds, reason: input.reason }) };
  }
  approveGrant(approvalId, body, actor) {
    const requestDigest = sha(body);
    const previous = this.row("grantApproval", approvalId);
    if (previous) {
      if (previous.revokedAt || previous.requestDigest !== requestDigest)
        throw fail(409, "취소됐거나 다른 내용으로 쓰인 승인 ID입니다.");
      return this.approvalView(previous);
    }
    this.grantableItem(body.productId);
    if (!["ALL", "USERS"].includes(body.mode) || !Array.isArray(body.userIds)
      || (body.mode === "USERS" && (!body.userIds.length || body.userIds.length > 500))
      || (body.mode === "ALL" && body.userIds.length))
      throw fail(400, "지급 대상을 확인하세요.");
    if (grantDigest(body) !== body.digest) throw fail(409, "승인 지문이 요청과 다릅니다.");
    if (body.userIds.some(id => !USERS.some(user => user.userId === id)))
      throw fail(409, "대상이 바뀌었습니다. 다시 미리 계산해 주세요");
    return this.approvalView(this.put("grantApproval", approvalId, { approvalId, productId: body.productId, mode: body.mode,
      userIds: body.userIds, reason: body.reason, digest: body.digest, requestDigest, approvedBy: actor,
      approvedAt: new Date().toISOString() }));
  }
  executionView(execution) {
    const { requestDigest, cursor, ...value } = execution;
    return value;
  }
  executeGrant(grantId, body, actor) {
    return this.store.transaction(() => {
      const requestDigest = sha(body);
      let execution = this.row("grantExecution", grantId);
      if (execution) {
        if (execution.requestDigest !== requestDigest) throw fail(409, "이미 다른 내용으로 실행한 요청입니다.");
      } else {
        const approval = this.row("grantApproval", body.approvalId);
        if (!approval) throw fail(404, "승인 기록이 없습니다.");
        if (approval.revokedAt || body.digest !== approval.digest) throw fail(409, "취소됐거나 승인한 내용과 다릅니다.");
        if (approval.approvedBy === actor) throw fail(409, "승인자와 다른 운영자가 실행해야 합니다.");
        if (approval.usedBy) throw fail(409, "이미 다른 실행에 쓴 승인입니다.");
        const startedAt = new Date().toISOString();
        execution = { grantId, approvalId: approval.approvalId, productId: approval.productId, mode: approval.mode,
          reason: approval.reason, status: "RUNNING", targetCount: approval.mode === "ALL" ? USERS.length : approval.userIds.length,
          grantedCount: 0, alreadyOwnedCount: 0, skippedCount: 0, approvedBy: approval.approvedBy, actor, startedAt,
          completedAt: null, requestDigest, cursor: "", userIds: approval.mode === "ALL" ? USERS.map(user => user.userId).sort() : [...approval.userIds].sort() };
        this.put("grantApproval", approval.approvalId, { ...approval, usedBy: grantId });
      }
      if (execution.status === "RUNNING") {
        const batch = execution.userIds.filter(id => id > execution.cursor).slice(0, this.chunkSize);
        for (const userId of batch) {
          const key = `${userId}|${execution.productId}`;
          if (this.row("owned", key)) execution.alreadyOwnedCount++;
          else { this.put("owned", key, { userId, productId: execution.productId }); execution.grantedCount++; }
          execution.cursor = userId;
        }
        if (execution.cursor === execution.userIds.at(-1) || !execution.userIds.length) {
          execution.status = "COMPLETED";
          execution.completedAt = new Date().toISOString();
        }
      }
      this.put("grantExecution", grantId, execution);
      const { userIds: _ids, ...view } = this.executionView(execution);
      return { ...view, local: true };
    });
  }
  executions(limit) {
    return this.rows("grantExecution").reverse().slice(0, limit).map(value => {
      const { userIds: _ids, ...view } = this.executionView(value);
      return view;
    });
  }
}
