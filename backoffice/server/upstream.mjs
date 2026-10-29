import { randomUUID, createHash } from "node:crypto";
import { Failure } from "./store.mjs";
export class Upstream {
  constructor({ mode, environment, expectedFcmProjectId, notificationUrl, dataUrl, fetchImpl = fetch }) {
    Object.assign(this, { mode, environment, expectedFcmProjectId, notificationUrl, dataUrl, fetchImpl });
  }
  async verifyEnvironment(expected, actor, operator) {
    try {
      const [data, notification] = await Promise.all([
        this.request(this.dataUrl, "/internal/admin/content/environment", actor,
          operator.dataToken, undefined, "GET"),
        this.request(this.notificationUrl, "/internal/admin/publications/environment", actor,
          operator.notificationToken, undefined, "GET"),
      ]);
      if (data.environment !== expected || notification.environment !== expected
          || notification.fcmProjectId !== this.expectedFcmProjectId) {
        throw new Failure(503, "Data·Notification DB 또는 FCM 프로젝트가 백오피스 환경과 일치하지 않습니다.");
      }
    } catch (error) {
      // 검증 단계에서 중단한 것이므로 발행 요청은 아직 전송되지 않았다.
      error.definite = true;
      throw error;
    }
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
          ...(this.environment ? { "X-Backoffice-Environment": this.environment } : {}),
          ...(this.expectedFcmProjectId ? { "X-Backoffice-Fcm-Project": this.expectedFcmProjectId } : {}),
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
    if (this.environment) await this.verifyEnvironment(this.environment, actor, operator);
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
    if (this.environment) await this.verifyEnvironment(this.environment, actor, operator);
    return this.request(
      this.notificationUrl,
      "/internal/admin/templates",
      actor,
      operator.notificationToken,
      undefined,
      "GET",
    );
  }
  async history(kind, cursor, actor, operator) {
    if (this.mode === "local") return { items: [], total: 0, nextCursor: null };
    await this.verifyEnvironment(this.environment, actor, operator);
    if (kind === "fcm") {
      const page = await this.request(
        this.notificationUrl,
        `/internal/admin/publications/history?limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
        actor,
        operator.notificationToken,
        undefined,
        "GET",
      );
      return { ...page, items: page.items.map(item => ({ ...item, notificationKind: item.kind, kind: "fcm" })) };
    }
    const resource = kind === "notice" ? "notices" : "magazines";
    const page = await this.request(
      this.dataUrl,
      `/internal/admin/content/history/${resource}?limit=50&offset=${cursor || "0"}`,
      actor,
      operator.dataToken,
      undefined,
      "GET",
    );
    return { ...page, nextCursor: page.nextOffset == null ? null : String(page.nextOffset) };
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
    if (this.environment) await this.verifyEnvironment(this.environment, actor, operator);
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
