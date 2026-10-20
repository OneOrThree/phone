#!/usr/bin/env python3
"""승인 합본과 확률 설계를 해시 PNG·렌더 자료·보상 SQL로 옮긴다. 운영 DB에는 접속하지 않는다."""
import argparse
import hashlib
import json
from pathlib import Path
import struct


ROOT = Path(__file__).resolve().parents[3]
HERE = Path(__file__).resolve().parent
STATIC = ROOT / "server/static"
RESOURCES = ROOT / "server/data-api/src/main/resources"
CAT_CATEGORIES = {"head", "neck", "shoes"}
MOTIONS = {"walk": 6, "focus": 4, "reel": 4}


def load(path):
    return json.loads(path.read_text())


def json_bytes(value):
    return (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode()


def sql(value):
    return "'" + str(value).replace("'", "''") + "'"


def png_size(raw):
    if raw[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError("PNG 파일이 아닙니다")
    return list(struct.unpack(">II", raw[16:24]))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path, help="승인된 customization-assets 합본 폴더")
    args = parser.parse_args()
    source = args.source.resolve()
    design = load(HERE / "reward-design.json")
    catalog = load(source / "final/catalog.json")
    manifest_items = {
        item["id"]: item for group in catalog["manifest"]["groups"] for item in group["items"]
    }
    file_index = {}

    def publish(raw, category, name, suffix):
        digest = hashlib.sha256(raw).hexdigest()
        relative = f"customization/{category}/{name}.{digest[:8]}.{suffix}"
        destination = STATIC / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        if destination.exists() and destination.read_bytes() != raw:
            raise ValueError(f"내용 해시 충돌: {relative}")
        destination.write_bytes(raw)
        path = "/static/" + relative
        file_index[path] = {"sha256": digest, "bytes": len(raw)}
        return path

    def original(path, category, name):
        file = (source / path).resolve()
        if not file.is_relative_to(source):
            raise ValueError("합본 밖의 파일은 등록하지 않습니다")
        raw = file.read_bytes()
        w, h = png_size(raw)
        metadata = catalog["metadata"].get(path)
        if metadata:
            assert [w, h] == [metadata["width"], metadata["height"]]
            box = metadata["bbox"]
        else:
            box = [0, 0, w, h]
        return {"path": publish(raw, category, name, "png"), "width": w, "height": h, "crop": box}

    rigs = {}
    for slot in ["head", "neck", "shoes"]:
        filename = "shoe-rig.json" if slot == "shoes" else slot + "-rig.json"
        raw = (source / "final" / filename).read_bytes()
        rigs[slot] = publish(raw, "rigs", slot, "json")
    band = original("final/assets/neck/common-band.png", "neck", "common-band")
    band["view"] = catalog["views"]["common-band"]
    # 합본의 실제 계산을 보존한다. 런타임 스크립트가 아니라 앱 이식 시 참고할 자료다.
    reference_code = {
        name: publish((source / "final" / name).read_bytes(), "reference", name.removesuffix(".js"), "js")
        for name in ["fitting.js", "renderer-base.js"]
    }
    clean_rafts = {
        name: original(path, "raft", name)
        for name, path in {
            "isometric": "reference/raft-clean-isometric.png",
            "side": "reference/raft-clean-side.png",
        }.items()
    }
    head_rig = load(source / "final/head-rig.json")
    # head-rig에는 reel-2 접촉 보정이 이미 반영돼 있다. HTML 원본과 대조해 이중 가산을 막는다.
    raw_contacts = (source / "head-contact.js").read_text().strip()
    contacts = json.loads(raw_contacts.removeprefix("window.HEAD_CONTACT = ").removesuffix(";"))["black"]
    head_frames = {}
    for motion, count in MOTIONS.items():
        for frame in range(count):
            x, y, angle = head_rig["baseContacts"][motion][frame]
            expected_x, expected_y, expected_angle = contacts[motion][frame]
            if motion == "reel" and frame == 2:
                expected_x += 12
                expected_y += 5
            assert [x, y, angle] == [expected_x, expected_y, expected_angle]
            head_frames[f"{motion}-{frame}"] = {"x": x, "y": y, "angleDegrees": angle}

    # 승인된 renderer-base.js의 800×620 검토 장면 좌표. 실제 앱 좌표로 오해하지 않도록 공간을 명시한다.
    placements = {
        "flag": [[205, 445, 72, .08, 1, 0, "behindCat"], [190, 411, 72, .08, 1, 0, "behindCat"]],
        "mat": [[385, 441, 175, .5, .5, -15, "behindCat"], [378, 414, 175, .5, .5, 0, "behindCat"]],
        "oar": [[510, 464, 258, .5, .5, 125, "inFrontOfCat"], [412, 493, 345, .5, .5, 8, "inFrontOfCat"]],
        "cargo": [[330, 520, 70, .5, 1, 0, "inFrontOfCat"], [630, 418, 70, .5, 1, 0, "inFrontOfCat"]],
        "lantern": [[486, 446, 49, .5, 1, 0, "inFrontOfCat"], [478, 421, 49, .5, 1, 0, "inFrontOfCat"]],
        "canopy": [[565, 403, 150, .5, 1, 0, "behindCat"], [550, 405, 150, .5, 1, 0, "behindCat"]],
    }
    items = []
    for index, record in enumerate(design["items"]):
        item = manifest_items[record["sourceId"]]
        category = record["category"]
        assert item["category"] == category and item["label"] == record["title"]
        kind = category if category in CAT_CATEGORIES else "decor"
        slug = item["slug"]
        # 공개된 cust.head.duck은 기존 오리 모자다. 새 인형으로 의미를 덮어쓰지 않는다.
        product_id = "cust.head.duck-plush" if record["sourceId"] == "head-duck" else (
            f"cust.{kind}.{slug}" if kind != "decor" else f"cust.decor.{category}-{slug}"
        )
        render = {
            "format": "cat-fit-v1" if kind != "decor" else "raft-fit-v1",
            "target": item["target"],
            "source": original(item["path"], kind, slug if kind != "decor" else f"{category}-{slug}"),
        }
        if kind != "decor":
            render.update({
                "coordinateSpace": "black-cat-512", "canvas": [512, 512],
                "validatedMotions": MOTIONS, "rigPath": rigs[category],
            })
            if category == "head":
                render.update({
                    "drawWidth": item["width"], "itemDepthY": head_rig["itemDepthY"][slug],
                    "contactFrames": head_frames, "contactShadow": {"widthFactor": .22, "height": 2.5},
                })
            else:
                render["views"] = catalog["views"][item["id"]]
                if category == "neck":
                    render["neckStyle"] = item["kind"]
                    render["commonBand"] = band
        else:
            render.update({"coordinateSpace": "review-scene-800x620", "canvas": [800, 620], "placements": {}})
            for view_index, view in enumerate(["isometric", "side"]):
                x, y, width, ax, ay, rotation, layer = placements[category][view_index]
                if category == "mat" and slug == "picnic":
                    rotation = 0
                render["placements"][view] = {
                    "x": x, "y": y, "drawWidth": width, "anchorX": ax, "anchorY": ay,
                    "rotationDegrees": rotation, "layer": layer,
                }
            if "sidePath" in item:
                render["sideSource"] = original(item["sidePath"], kind, f"{category}-{slug}-side")
            if category == "oar":
                render["replacementRafts"] = clean_rafts
        items.append({
            **record, "productId": product_id, "kind": kind, "ownerType": "user",
            "sortOrder": index, "renderData": render,
        })
    assert len(items) == len(manifest_items) == 90
    assert len({item["productId"] for item in items}) == 90
    bundle = {
        "formatVersion": 1, "sourceWorkbookSha256": design["sourceWorkbookSha256"],
        "policy": design["policy"], "items": items,
        "referenceCode": reference_code, "files": file_index,
    }
    out = RESOURCES / "customization/reward-catalog-v1.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(json_bytes(bundle))
    policy = design["policy"]
    columns = [
        ("revision", "revision"), ("minimum_active_seconds", "minimumActiveSeconds"),
        ("rare_unlock_seconds", "rareUnlockSeconds"), ("legendary_unlock_seconds", "legendaryUnlockSeconds"),
        ("time_half_seconds", "timeHalfSeconds"), ("rare_max_bonus_ppm", "rareMaxBonusPpm"),
        ("legendary_max_bonus_ppm", "legendaryMaxBonusPpm"),
        ("rewards_per_eligible_session", "rewardsPerEligibleSession"),
    ]
    statements = [
        "-- GROMO-2313 승인된 꾸미기 90종·확률 설정. build_reward_catalog.py 생성 결과.",
        "-- 기존 단계표와 기존 cust.head.duck 상품·메타는 변경하지 않는다.",
        "-- 머지·적용된 마이그레이션은 재생성하지 말고 새 버전으로 변경한다.",
        "INSERT INTO customization_reward_policies\n    ("
        + ", ".join(key for key, _ in columns)
        + ", duplicates_allowed, location_weights, category_weights, source_workbook_sha256)\nVALUES ("
        + ", ".join(str(policy[key]) for _, key in columns)
        + ", TRUE, " + sql(json.dumps(policy["locationWeights"])) + "::jsonb, "
        + sql(json.dumps(policy["categoryWeights"])) + "::jsonb, "
        + sql(design["sourceWorkbookSha256"]) + ");",
    ]
    for item in items:
        statements.append(
            "INSERT INTO catalog_assets (product_id, title, kind, owner_type) VALUES ("
            + ", ".join(sql(item[key]) for key in ["productId", "title", "kind", "ownerType"])
            + ") ON CONFLICT (product_id) DO NOTHING;"
        )
        # 이미 존재하는 ID의 종류·소유자·제목이 다르면 배포를 실패시킨다. 조용히 다른 의미에 연결하지 않는다.
        statements.append(
            "DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM catalog_assets WHERE product_id = "
            + sql(item["productId"]) + " AND title = " + sql(item["title"])
            + " AND kind = " + sql(item["kind"]) + " AND owner_type = 'user') THEN\n"
            + "    RAISE EXCEPTION '꾸미기 상품 ID 충돌: %', " + sql(item["productId"]) + ";\n"
            + "END IF; END $$;"
        )
        statements.append(
            "INSERT INTO customization_reward_items\n"
            "    (revision, product_id, source_asset_id, category, rarity, rarity_reason, render_data, sort_order)\n"
            "VALUES (" + str(policy["revision"]) + ", "
            + ", ".join(sql(item[key]) for key in ["productId", "sourceId", "category", "rarity", "rarityReason"])
            + ", " + sql(json.dumps(item["renderData"], ensure_ascii=False, separators=(",", ":")))
            + "::jsonb, " + str(item["sortOrder"]) + ");"
        )
    (RESOURCES / "db/migration/V134__seed_customization_reward_catalog.sql").write_text(
        "\n\n".join(statements) + "\n"
    )
    print(f"카탈로그 {len(items)}종, 해시 파일 {len(file_index)}개, V134 생성 완료")


if __name__ == "__main__":
    main()
