import test from "node:test";
import assert from "node:assert/strict";
import { GRAFANA_TUNNEL, MONITORING_GROUPS } from "../src/monitoringLinkList.ts";

const links = MONITORING_GROUPS.flatMap(group => group.links);

test("링크는 https 이고 터널로 여는 Grafana 만 localhost 를 쓴다", () => {
  for (const { name, url } of links) {
    const { protocol, hostname, port } = new URL(url);
    assert.ok(protocol === "https:" || (hostname === "localhost" && port === "13000"), name);
  }
  assert.ok(GRAFANA_TUNNEL.includes("-L 13000:localhost:3000"));
});

test("분류 안에서 링크 이름이 겹치지 않는다", () => {
  for (const group of MONITORING_GROUPS) {
    const names = group.links.map(link => link.name);
    assert.equal(new Set(names).size, names.length, group.title);
  }
});

test("공개 저장소에 실리는 목록에 IP 주소와 AWS 계정 번호가 없다", () => {
  const text = JSON.stringify(MONITORING_GROUPS);
  assert.doesNotMatch(text, /\b\d{1,3}(\.\d{1,3}){3}\b/);
  assert.doesNotMatch(text, /\b\d{12}\b/);
});
