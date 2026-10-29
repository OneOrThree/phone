import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../server/store.mjs";
const notice = {
  kind: "notice",
  title: "업데이트 안내",
  body: "새 기능 안내입니다.",
  startsAt: "2026-10-29T00:00:00Z",
};
function approve(store, item) {
  item = store.transition(item.id, item, "member-1", "review");
  return store.transition(item.id, item, "member-2", "approve");
}
test("승인 전 게시 거부, 수정시 승인 무효화, stale revision 거부", () => {
  const store = new Store(":memory:");
  let item = store.create(notice, "member-1");
  assert.throws(
    () => store.transition(item.id, item, "member-1", "publish"),
    /승인된/,
  );
  item = approve(store, item);
  const old = item;
  item = store.edit(
    item.id,
    { revision: item.revision, body: "수정된 내용" },
    "member-1",
  );
  assert.equal(item.status, "draft");
  assert.equal(item.approvedBy, undefined);
  assert.throws(
    () => store.transition(item.id, old, "member-1", "publish"),
    /다른 변경/,
  );
  assert.throws(
    () => store.transition(item.id, item, "member-1", "publish"),
    /승인된/,
  );
  store.close();
});
test("중복 게시 잠금, 불확실한 응답의 동일 키 재시도, 게시후 수정 거부", () => {
  const store = new Store(":memory:");
  let item = approve(store, store.create(notice, "member-1"));
  item = store.transition(item.id, item, "member-1", "publish");
  const id = item.publicationId;
  assert.throws(
    () => store.transition(item.id, item, "member-1", "publish"),
    /승인된/,
  );
  item = store.finish(item.id, null, new Error("timeout"));
  assert.equal(item.status, "uncertain");
  assert.throws(
    () =>
      store.edit(
        item.id,
        { revision: item.revision, body: "다른 내용" },
        "member-1",
      ),
    /수정할 수/,
  );
  assert.throws(
    () => store.transition(item.id, item, "member-2", "publish"),
    /최초 발송자/,
  );
  item = store.transition(item.id, item, "member-1", "publish");
  assert.equal(item.publicationId, id);
  item = store.finish(item.id, { ok: true });
  assert.equal(item.status, "published");
  assert.equal(item.audit.at(-1).action, "published");
  assert.throws(
    () =>
      store.edit(
        item.id,
        { revision: item.revision, body: "변경" },
        "member-1",
      ),
    /수정할 수/,
  );
  store.close();
});
test("재시작시 발송중 상태는 불확실로 복구하고 이력 보존", () => {
  const dir = mkdtempSync(join(tmpdir(), "backoffice-"));
  const path = join(dir, "test.sqlite");
  let store = new Store(path);
  let item = approve(store, store.create(notice, "member-1"));
  item = store.transition(item.id, item, "member-1", "publish");
  store.close();
  store = new Store(path);
  assert.equal(store.get(item.id).status, "uncertain");
  assert.equal(store.get(item.id).publicationId, item.publicationId);
  store.close();
  rmSync(dir, { recursive: true });
});
test("잡지는 서버가 준비한 snapshot 내용/문구/날짜만 승인 가능", () => {
  const store = new Store(":memory:");
  const snapshot = {
    snapshotId: "s",
    digest: "digest",
    editorial: { body: "소식" },
  };
  store.snapshot(snapshot, { issueDate: "2026-10-29", editorialBody: "소식" });
  let item = store.create(
    {
      kind: "magazine",
      title: "오늘 잡지",
      body: "소식",
      issueDate: "2026-10-29",
      data: { snapshot },
    },
    "member-1",
  );
  item = approve(store, item);
  item = store.edit(
    item.id,
    { revision: item.revision, body: "변조" },
    "member-1",
  );
  assert.throws(
    () => store.transition(item.id, item, "member-1", "review"),
    /다시 불러/,
  );
  store.close();
});
test("한 번 결과가 유실된 발송은 재시도 인증 실패로 편집 잠금이 풀리지 않는다", () => {
  const store = new Store(":memory:");
  let item = approve(store, store.create(notice, "member-1"));
  item = store.transition(item.id, item, "member-1", "publish");
  const publicationId = item.publicationId;
  item = store.finish(item.id, null, new Error("응답 유실"));
  item = store.transition(item.id, item, "member-1", "publish");
  item = store.finish(
    item.id,
    null,
    Object.assign(new Error("인증 거부"), { definite: true }),
  );
  assert.equal(item.status, "uncertain");
  assert.equal(item.publicationId, publicationId);
  assert.throws(
    () =>
      store.edit(
        item.id,
        { revision: item.revision, body: "새 발송" },
        "member-1",
      ),
    /수정할 수/,
  );
  store.close();
});
test("큰 잡지는 원본 재전송 없이 스냅샷 참조로 저장·검토하고 digest 변조는 거부한다", () => {
  const store = new Store(":memory:");
  const snapshot = {
    snapshotId: "large",
    digest: "digest",
    editorial: {},
    cells: Array.from({ length: 3000 }, (_, i) => ({
      id: i,
      body: "내용".repeat(60),
    })),
  };
  assert.ok(Buffer.byteLength(JSON.stringify(snapshot)) > 65536);
  store.snapshot(snapshot, { issueDate: "2026-10-29" });
  const input = {
    kind: "magazine",
    title: "잡지",
    body: "",
    issueDate: "2026-10-29",
    data: { snapshot: { snapshotId: "large", digest: "digest" } },
  };
  assert.ok(Buffer.byteLength(JSON.stringify(input)) < 1024);
  const item = approve(store, store.create(input, "member-1"));
  assert.equal(item.data.snapshot.cells.length, 3000);
  assert.throws(
    () =>
      store.create(
        {
          ...input,
          data: { snapshot: { snapshotId: "large", digest: "변조" } },
        },
        "member-1",
      ),
    /다시 불러/,
  );
  store.close();
});
