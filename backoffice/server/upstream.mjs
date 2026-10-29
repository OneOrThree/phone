import { randomUUID, createHash } from "node:crypto";
import { Failure } from "./store.mjs";
export class Upstream {
  constructor({ mode, notificationUrl, dataUrl, fetchImpl = fetch }) {
    Object.assign(this, { mode, notificationUrl, dataUrl, fetchImpl });
  }
  async request(base, path, actor, token, body, method = "POST", key) {
    if (!base || !token)
      throw Object.assign(
        new Failure(
          503,
          "내부 서비스 연결 또는 운영자 자격이 설정되지 않았습니다.",
        ),
        { definite: true },
      );
    let response;
    try {
      response = await this.fetchImpl(new URL(path, base), {
        method,
        redirect: "error",
        signal: AbortSignal.timeout(15000),
        headers: {
          Authorization: `Bearer ${token}`,
          "X-Console-Actor": actor,
          "Content-Type": "application/json",
          ...(key ? { "Idempotency-Key": key } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch {
      throw new Failure(
        502,
        "내부 서비스 응답을 확인하지 못했습니다. 같은 요청으로 재시도하세요.",
      );
    }
    if (!response.ok) {
      // 오류 원문에 자격·payload가 들어갈 수 있어 브라우저로 전달하지 않는다.
      const error = new Failure(
        response.status === 409 ? 409 : 502,
        response.status === 409
          ? "검토한 내용이 달라졌거나 이미 처리된 요청입니다. 상태를 확인하세요."
          : `내부 서비스가 요청을 거부했습니다 (${response.status}).`,
      );
      error.definite =
        response.status >= 400 &&
        response.status < 500 &&
        response.status !== 408 &&
        response.status !== 429;
      throw error;
    }
    try {
      return await response.json();
    } catch {
      throw new Failure(
        502,
        "처리 결과 응답을 읽지 못했습니다. 같은 요청으로 재시도하세요.",
      );
    }
  }
  async preview(input, actor, operator) {
    if (this.mode === "local") {
      const value = {
        snapshotId: randomUUID(),
        issueDate: input.issueDate,
        issueNo: 1,
        editorial: {
          ranking: [],
          newIslands: [],
          note: {
            type: "EDITOR",
            body: input.editorialBody ?? "",
            tipNo: null,
          },
        },
        cells: [],
        local: true,
      };
      return {
        ...value,
        digest: createHash("sha256")
          .update(JSON.stringify(value))
          .digest("hex"),
      };
    }
    return this.request(
      this.dataUrl,
      "/internal/admin/content/magazine/previews",
      actor,
      operator.dataToken,
      input,
    );
  }
  async catalog(actor, operator) {
    if (this.mode === "local") return { items: [] };
    return this.request(
      this.notificationUrl,
      "/internal/admin/templates",
      actor,
      operator.notificationToken,
      undefined,
      "GET",
    );
  }
  async publish(item, actor, operator) {
    if (this.mode === "local")
      return {
        publicationId: item.publicationId,
        local: true,
        status: item.kind === "fcm" ? "PENDING" : "PUBLISHED",
        dispatchEnabled: false,
        recipientCount: item.targets.length,
        message: "로컬 모의 처리입니다. 실제 발송·게시는 하지 않았습니다.",
      };
    const id = item.publicationId;
    if (item.kind === "fcm") {
      const fcm = item.data.fcm;
      return this.request(
        this.notificationUrl,
        `/internal/admin/publications/${id}`,
        actor,
        operator.notificationToken,
        {
          kind: fcm.kind,
          locale: fcm.locale,
          title: item.title,
          body: item.body,
          data: item.data.payload ?? {},
          silent: fcm.silent,
          params: fcm.params ?? {},
          subjectId: fcm.subjectId ?? id,
          userIds: item.targets,
        },
        "POST",
        `${item.id}:${item.revision}`,
      );
    }
    if (item.kind === "notice")
      return this.request(
        this.dataUrl,
        `/internal/admin/content/notices/${id}`,
        actor,
        operator.dataToken,
        {
          title: item.title,
          body: item.body,
          startsAt: item.startsAt,
          endsAt: item.endsAt || null,
        },
        "PUT",
      );
    return this.request(
      this.dataUrl,
      `/internal/admin/content/magazine/publications/${id}`,
      actor,
      operator.dataToken,
      {
        snapshotId: item.data.snapshot.snapshotId,
        digest: item.data.snapshot.digest,
      },
    );
  }
}
