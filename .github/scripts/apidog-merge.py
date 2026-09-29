#!/usr/bin/env python3
"""apidog-merge.py — 서비스별 OpenAPI 스펙을 Apidog 한 프로젝트용 병합 스펙으로 만든다 (GROMO-2069).

왜 존재하는가: primary Apidog 프로젝트는 deleteUnmatchedResources=true 로 import 한다.
두 스펙을 순차로 올리면 뒤 import 가 앞 서비스 문서를 전부 지운다 — 그래서 «한 번»에 올릴
단일 스펙이 필요하고, 그 스펙에서 두 서비스의 schema·operationId·경로가 부딪히면 안 된다.

하는 일:
  1. operationId 에 `<서비스>.` 접두어를 붙인다(없으면 method+path 로 결정적 생성).
  2. components 하위 모든 섹션의 키를 `<서비스>.<이름>` 으로 바꾸고,
     `#/components/...` $ref 전부를 함께 고친다.
  3. 각 operation 에 `x-apidog-folder` 를 단다 — `<서비스>` 폴더, business 의 호환
     `/api/v1/**` 경로는 `<서비스>/legacy` 하위로 격리한다.
     (x-apidog-folder 는 tags 보다 우선하고 `/` 가 계층을 나눈다 —
      https://docs.apidog.com/x-apidog-folder-1981658m0)
  4. 두 스펙이 같은 method+path 를 주장하면 «소유권 충돌»로 실패한다 — 조용히 덮지 않는다.
  5. 서비스 경계를 강제한다 — data-api 는 `/internal/**` 만, business-api 는 `/internal/**` 가
     없어야 한다. 그룹 필터가 틀어져도 병합 단계에서 한 번 더 막는다(이중 방어).

사용법:
  python3 apidog-merge.py OUT_JSON SERVICE=SPEC_JSON [SERVICE=SPEC_JSON ...]
  예) apidog-merge.py merged.json \
        business-api=business-api.openapi.json data-api=data-api.openapi.json

실패 조건(fail-closed): 스펙 파일 부재/깨짐, method+path 소유권 충돌.
"""
import json
import re
import sys

LEGACY_PREFIX = "/api/v1"
HTTP_METHODS = {"get", "put", "post", "delete", "patch", "head", "options", "trace"}
COMPONENT_REF = re.compile(r"^#/components/([^/]+)/(.+)$")


# 서비스별 경로 경계. 그룹 필터(OpenApiConfig)가 1차, 여기가 2차다 — 둘이 같은 실수를 하지 않는다.
SERVICE_RULES = {
    # data-api 의 게시 계약은 서버 간 경로뿐이다 — /api/v1·무접두 경로가 새면 그룹 필터가 깨진 것.
    "data-api": {"must_start": "/internal/"},
    # business-api 는 공개 계약이다 — 내부 경로가 새면 AccessTokenFilter 가 아니라 문서가 새는 것.
    "business-api": {"must_not_start": "/internal/"},
}


def load_spec(path):
    try:
        with open(path, encoding="utf-8") as f:
            spec = json.load(f)
    except (OSError, json.JSONDecodeError) as e:
        raise SystemExit(f"::error::스펙을 읽지 못했다 — {path}: {e}")
    if not isinstance(spec.get("paths"), dict) or not spec["paths"]:
        raise SystemExit(f"::error::{path} 에 paths 가 없거나 비어 있다 — 생성이 실패한 스펙을 올리지 않는다.")
    return spec


def operation_id_fallback(method, path):
    slug = re.sub(r"[^a-zA-Z0-9]+", "_", path).strip("_")
    return f"{method}_{slug}"


def rewrite_refs(node, service):
    """모든 문자열 값 중 `#/components/<섹션>/<이름>` 참조의 이름에 서비스 접두어를 붙인다."""
    if isinstance(node, dict):
        for key, value in node.items():
            if isinstance(value, str):
                m = COMPONENT_REF.match(value)
                if m:
                    node[key] = f"#/components/{m.group(1)}/{service}.{m.group(2)}"
            else:
                rewrite_refs(value, service)
    elif isinstance(node, list):
        for item in node:
            rewrite_refs(item, service)


def fix_security_names(node, renames):
    """`security: [{이름: [...]}]` 요구 객체의 «키»는 $ref 가 아니라 평문 이름이다 —
    securitySchemes 키를 접두어로 바꿨으면 여기 이름도 같이 고쳐야 인증 요구가 안 깨진다."""
    if isinstance(node, dict):
        for key, value in node.items():
            if key == "security" and isinstance(value, list):
                for req in value:
                    if isinstance(req, dict):
                        for name in list(req):
                            if name in renames:
                                req[renames[name]] = req.pop(name)
            else:
                fix_security_names(value, renames)
    elif isinstance(node, list):
        for item in node:
            fix_security_names(item, renames)


def fix_discriminator_mappings(node, renames):
    """discriminator.mapping 의 값은 `$ref` 일 수도 «평문 스키마 이름»일 수도 있다.
    평문은 rewrite_refs 가 못 잡으므로 따로 고친다."""
    if isinstance(node, dict):
        disc = node.get("discriminator")
        if isinstance(disc, dict) and isinstance(disc.get("mapping"), dict):
            for k, v in disc["mapping"].items():
                if isinstance(v, str) and not COMPONENT_REF.match(v) and v in renames:
                    disc["mapping"][k] = renames[v]
        for value in node.values():
            fix_discriminator_mappings(value, renames)
    elif isinstance(node, list):
        for item in node:
            fix_discriminator_mappings(item, renames)


def namespace_spec(spec, service):
    """components 키 전부를 `<서비스>.<이름>` 으로 바꾸고 $ref·평문 참조를 따라 고친다."""
    components = spec.get("components") or {}
    renames = {}  # section → {old: new} — 섹션을 안 가리면 schema 와 scheme 이
    # 같은 이름일 때 security 요구 객체를 엉뚱하게 바꾼다.
    for section, entries in components.items():
        if isinstance(entries, dict):
            renames[section] = {name: f"{service}.{name}" for name in entries}
            components[section] = {renames[section][name]: v for name, v in entries.items()}
    rewrite_refs(spec, service)
    fix_security_names(spec, renames.get("securitySchemes", {}))
    fix_discriminator_mappings(spec, renames.get("schemas", {}))
    return spec


def tag_folder(spec, service):
    """서비스 경계 검사 + operationId 접두어 + x-apidog-folder + 경로 소유권 목록."""
    rules = SERVICE_RULES.get(service, {})
    owned = []  # (method, path)
    for path, item in spec["paths"].items():
        if rules.get("must_start") and not path.startswith(rules["must_start"]):
            raise SystemExit(
                f"::error::{service} 스펙에 경계 밖 경로가 있다 — {path} "
                f"(허용: {rules['must_start']}**). 그룹 필터를 확인하라.")
        if rules.get("must_not_start") and path.startswith(rules["must_not_start"]):
            raise SystemExit(
                f"::error::{service} 스펙에 내부 경로가 샜다 — {path}. 공개 문서에 올리면 안 된다.")
        if not isinstance(item, dict):
            continue
        folder = f"{service}/legacy" if path.startswith(LEGACY_PREFIX) else service
        for method, op in item.items():
            if method.lower() not in HTTP_METHODS or not isinstance(op, dict):
                continue
            op["operationId"] = f"{service}.{op.get('operationId') or operation_id_fallback(method, path)}"
            op["x-apidog-folder"] = folder
            owned.append((method.lower(), path))
    return owned


def merge(service_specs):
    paths, components, tags = {}, {}, {}
    seen_tag_names = set()
    owner = {}  # (method, path) → service
    for service, spec in service_specs:
        namespace_spec(spec, service)
        for method, path in tag_folder(spec, service):
            prev = owner.get((method, path))
            if prev is not None:
                raise SystemExit(
                    f"::error::경로 소유권 충돌 — {method.upper()} {path} 를 "
                    f"{prev} 와 {service} 가 동시에 공개한다.")
            owner[(method, path)] = service
        for path, item in spec["paths"].items():
            paths.setdefault(path, {}).update(item)
        for section, entries in (spec.get("components") or {}).items():
            components.setdefault(section, {}).update(entries)
        for tag in spec.get("tags") or []:
            name = tag.get("name") if isinstance(tag, dict) else None
            if name and name not in seen_tag_names:
                seen_tag_names.add(name)
                tags[name] = tag

    merged = {
        "openapi": "3.0.3",
        "info": {
            "title": "Phone API",
            "version": "-".join(
                str((spec.get("info") or {}).get("version", "0")) for _, spec in service_specs),
            "description": "business-api(앱 공개 계약) + data-api(서버 간 계약) 병합 스펙.",
        },
        "paths": paths,
        "components": components,
    }
    if tags:
        merged["tags"] = list(tags.values())
    return merged


def main(argv):
    if len(argv) < 3 or "=" not in argv[2]:
        raise SystemExit(__doc__)
    out_path = argv[1]
    service_specs = []
    for arg in argv[2:]:
        service, _, spec_path = arg.partition("=")
        if not service or not spec_path:
            raise SystemExit(f"::error::인자 형식이 SERVICE=PATH 가 아니다 — {arg}")
        service_specs.append((service, load_spec(spec_path)))

    merged = merge(service_specs)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(merged, f, ensure_ascii=False)
    counts = ", ".join(f"{s}: {len(spec['paths'])}" for s, spec in service_specs)
    print(f"병합 완료 — {len(merged['paths'])} paths → {out_path} ({counts})")


if __name__ == "__main__":
    main(sys.argv)
