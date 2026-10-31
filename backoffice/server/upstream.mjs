import { policyRequest } from "./construction.mjs";
import { randomUUID, createHash } from "node:crypto";
import { Failure } from "./store.mjs";
import contract from "./contract.json" with { type: "json" };
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
      for (const [service, identity] of Object.entries({ data, notification })) {
        if (identity.contractVersion !== contract.contractVersion
            || !Array.isArray(identity.capabilities)
            || !contract[service].every(capability => identity.capabilities.includes(capability))) {
          throw new Failure(503, `${service} API가 백오피스 필수 계약을 지원하지 않습니다.`);
        }
      }
      if (data.environment !== expected || notification.environment !== expected
          || notification.fcmProjectId !== this.expectedFcmProjectId) {
        throw new Failure(503, "Data·Notification DB 또는 FCM 프로젝트가 백오피스 환경과 일치하지 않습니다.");
      }
      return { data, notification };
    } catch (error) {
      // 검증 단계에서 중단한 것이므로 발행 요청은 아직 전송되지 않았다.
      error.definite = true;
      throw error;
    }
  }
  // 표시 전용. 운영자 토큰이 Apple로 나가지 않도록 request()를 쓰지 않고 실패해도 던지지 않는다.
  async iosStoreVersion() {
    if (this.mode === "local") return { version: null, status: "local" };
    try {
      const response = await this.fetchImpl("https://itunes.apple.com/lookup?id=6813004121&country=kr",
        { redirect: "error", signal: AbortSignal.timeout(5000) });
      if (!response.ok) return { version: null, status: "unavailable" };
      const body = await response.json();
      if (body?.resultCount === 0) return { version: null, status: "unpublished" };
      const version = body?.results?.[0]?.version;
      return typeof version === "string" ? { version, status: "ok" } : { version: null, status: "unavailable" };
    } catch {
      return { version: null, status: "unavailable" };
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
    if (response.status === 204) return { ok: true };
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
  async catalog(actor, operator, cursor = "") {
    if (this.mode === "local") return { items: [] };
    if (this.environment) await this.verifyEnvironment(this.environment, actor, operator);
    return this.request(
      this.notificationUrl,
      `/internal/admin/templates?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
      actor,
      operator.notificationToken,
      undefined,
      "GET",
    );
  }
  async constructionPolicy(actor, operator) {
    await this.verifyEnvironment(this.environment, actor, operator);
    return this.request(this.dataUrl, "/internal/admin/content/construction-policy",
      actor, operator.dataToken, undefined, "GET");
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
      `/internal/admin/content/history/${resource}?limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
      actor,
      operator.dataToken,
      undefined,
      "GET",
    );
    return page;
  }
  async focusPolicy(actor, operator) {
    if (this.mode === "local") return {
      current: { revision: 1, publishedAt: null, policy: {
        secondsPerFish: 60, dailyCapFish: 480, personalSharePercent: 0,
        goldenFishReward: 50, goldenMaxMembers: 5,
        goldenChancePpm: [4000, 12000, 24000, 40000],
      } }, history: [], local: true,
    };
    await this.verifyEnvironment(this.environment, actor, operator);
    return this.request(this.dataUrl, "/internal/admin/policies/focus", actor,
      operator.dataToken, undefined, "GET");
  }
  async approveFocusPolicy(request, actor, operator) {
    if (this.mode === "local") return { ...request, approvedBy: actor,
      approvedAt: new Date().toISOString(), local: true };
    await this.verifyEnvironment(this.environment, actor, operator);
    return this.request(this.dataUrl,
      `/internal/admin/policies/focus/approvals/${request.approvalId}`,
      actor, operator.dataToken, {
        expectedRevision: request.expectedRevision, policy: request.policy,
        approvedDigest: request.approvedDigest,
      }, "POST", request.approvalId);
  }
  async revokeFocusPolicy(approvalId, actor, operator) {
    if (this.mode === "local") return { ok: true, local: true };
    await this.verifyEnvironment(this.environment, actor, operator);
    return this.request(this.dataUrl,
      `/internal/admin/policies/focus/approvals/${approvalId}`,
      actor, operator.dataToken, undefined, "DELETE");
  }
  async publishFocusPolicy(item, actor, operator) {
    if (this.mode === "local") return {
      publicationId: item.publicationId, revision: item.expectedRevision + 1,
      policy: item.approvedPolicy, local: true,
    };
    await this.verifyEnvironment(this.environment, actor, operator);
    return this.request(this.dataUrl,
      `/internal/admin/policies/focus/publications/${item.publicationId}`,
      actor, operator.dataToken, {
        approvalId: item.approvalId,
        expectedRevision: item.expectedRevision,
        policy: item.approvedPolicy,
        approvedDigest: item.approvedDigest,
      }, "PUT", `${item.id}:${item.revision}`);
  }
  async publish(item, actor, operator) {
    if (item.kind === "construction") {
      if (this.mode === "local") throw new Failure(503, "로컬 정책 저장소가 필요합니다.");
      await this.verifyEnvironment(this.environment, actor, operator);
      return this.request(this.dataUrl, `/internal/admin/content/construction-policy/${item.publicationId}`,
        actor, operator.dataToken, policyRequest(item), "PUT");
    }
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
          minIosVersion: item.minIosVersion || null,
          minAndroidVersion: item.minAndroidVersion || null,
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
  async cancelFcm(publicationId, actor, operator) {
    if (this.mode === "local") return { publicationId, cancelledCount: 0, totalCancelledCount: 0,
      sentCount: 0, inFlightCount: 0, local: true };
    await this.verifyEnvironment(this.environment, actor, operator);
    return this.request(this.notificationUrl,
      `/internal/admin/publications/${publicationId}/cancel`, actor,
      operator.notificationToken, {}, "POST");
  }
  async withdrawNotice(publicationId, actor, operator) {
    if (this.mode === "local") return { publicationId, withdrawnAt: new Date().toISOString(), local: true };
    await this.verifyEnvironment(this.environment, actor, operator);
    return this.request(this.dataUrl,
      `/internal/admin/content/notices/${publicationId}/withdraw`, actor,
      operator.dataToken, {}, "POST");
  }
}
