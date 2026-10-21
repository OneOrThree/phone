#!/usr/bin/env python3
"""등록 데이터의 이미지 무결성·보정 자료·확률 계약을 검증한다. 추첨/지급 엔진은 아니다."""
from collections import Counter
import hashlib
import json
from pathlib import Path
import struct

ROOT = Path(__file__).resolve().parents[3]
BUNDLE = ROOT / "server/data-api/src/main/resources/customization/reward-catalog-v1.json"
GRADES = ("common", "uncommon", "rare", "legendary")
CATEGORIES = ("head", "neck", "shoes", "flag", "mat", "oar", "cargo", "lantern", "canopy")
MOTIONS = {"walk": 6, "focus": 4, "reel": 4}
# 머리·목 6색 자세 자료(GROMO-2382). 독서는 책이 목을 가려 목 리그에 프레임이 없다.
FIT_COLORS = ["black", "ginger", "cream", "gray", "white", "calico"]
FIT_MOTIONS = {"walk": 6, "focus": 4, "reel": 4, "blink": 3, "read": 6}
FIT_STILLS = ["idle", "loaf", "avatar"]


def frame_ids(motions, stills=()):
    return {f"{m}-{i}" for m, n in motions.items() for i in range(n)} | {f"still/{s}" for s in stills}


def probabilities(policy, seconds, location):
    if seconds < policy["minimumActiveSeconds"]:
        return dict.fromkeys(GRADES, 0.0)
    weights = policy["locationWeights"][location]
    p = {grade: weights[grade] / sum(weights.values()) for grade in GRADES}
    extra = max(0, seconds - policy["minimumActiveSeconds"])
    factor = extra / (extra + policy["timeHalfSeconds"])
    rare_bonus = policy["rareMaxBonusPpm"] / 1_000_000 * factor
    legendary_bonus = policy["legendaryMaxBonusPpm"] / 1_000_000 * factor
    common = p["common"] - rare_bonus - legendary_bonus
    uncommon = p["uncommon"]
    p["rare"] = p["rare"] + rare_bonus if seconds >= policy["rareUnlockSeconds"] else 0.0
    p["legendary"] = (
        p["legendary"] + legendary_bonus if seconds >= policy["legendaryUnlockSeconds"] else 0.0
    )
    remaining = 1 - p["rare"] - p["legendary"]
    p["common"] = remaining * common / (common + uncommon)
    p["uncommon"] = remaining * uncommon / (common + uncommon)
    return p


def static_file(path):
    if not path.startswith("/static/") or ".." in Path(path).parts:
        raise AssertionError(f"잘못된 정적 경로: {path}")
    return ROOT / "server/static" / path.removeprefix("/static/")


def main():
    bundle = json.loads(BUNDLE.read_text())
    policy = bundle["policy"]
    items = bundle["items"]
    assert len(items) == len({x["productId"] for x in items}) == 90
    assert Counter(x["category"] for x in items) == dict.fromkeys(CATEGORIES, 10)
    assert policy["minimumActiveSeconds"] == 900
    assert policy["rareUnlockSeconds"] == 1800
    assert policy["legendaryUnlockSeconds"] == 3600
    assert policy["duplicatesAllowed"] is True and policy["rewardsPerEligibleSession"] == 1
    assert set(policy["categoryWeights"]) == set(CATEGORIES)
    assert all(value > 0 for value in policy["categoryWeights"].values())
    assert policy["timeHalfSeconds"] > 0
    for location in ("ISLAND", "SEA"):
        weights = policy["locationWeights"][location]
        assert set(weights) == set(GRADES) and all(value >= 0 for value in weights.values())
        max_bonus = (policy["rareMaxBonusPpm"] + policy["legendaryMaxBonusPpm"]) / 1_000_000
        assert weights["common"] / sum(weights.values()) >= max_bonus
    counts = Counter((x["category"], x["rarity"]) for x in items)
    for category in CATEGORIES:
        assert [counts[(category, grade)] for grade in GRADES] == [4, 3, 2, 1]
    for path, info in bundle["files"].items():
        raw = static_file(path).read_bytes()
        digest = hashlib.sha256(raw).hexdigest()
        assert digest == info["sha256"] and len(raw) == info["bytes"]
        assert "." + digest[:8] + "." in path

    def verify_sources(value):
        if isinstance(value, dict):
            if "path" in value and "width" in value:
                raw = static_file(value["path"]).read_bytes()
                assert raw[:8] == b"\x89PNG\r\n\x1a\n"
                w, h = struct.unpack(">II", raw[16:24])
                assert [w, h] == [value["width"], value["height"]]
                l, t, r, b = value["crop"]
                assert 0 <= l < r <= w and 0 <= t < b <= h
            for key, child in value.items():
                if key.endswith("Path") or key == "path":
                    assert child in bundle["files"], child
                verify_sources(child)
        elif isinstance(value, list):
            for child in value:
                verify_sources(child)

    for item in items:
        verify_sources(item["renderData"])
        source = item["renderData"]["source"]
        # 소품 그림은 캔버스를 꽉 채우지 않는다. 전체 캔버스 크롭은 알파 영역을 못 읽었다는 뜻이다.
        assert source["crop"] != [0, 0, source["width"], source["height"]], item["productId"]
        assert item["ownerType"] == "user"
        render = item["renderData"]
        if item["category"] == "shoes":
            assert item["kind"] == "shoes"
            assert render["validatedMotions"] == MOTIONS
        elif item["category"] in ("head", "neck"):
            assert item["kind"] == item["category"]
            assert render["validatedMotions"] == FIT_MOTIONS
            assert render["validatedStills"] == FIT_STILLS and render["validatedColors"] == FIT_COLORS
            if item["category"] == "head":
                contacts = {"black": render["contactFrames"], **render["colorContactFrames"]}
                assert list(contacts) == FIT_COLORS, item["productId"]
                for frames in contacts.values():
                    assert set(frames) == frame_ids(FIT_MOTIONS, FIT_STILLS), item["productId"]
                    for fid, c in frames.items():
                        assert all(isinstance(c[k], (int, float)) for k in ("x", "y", "angleDegrees")), fid
                        # 프로필 그림만 고양이를 키워 그려 view 로 옮긴다
                        assert ("view" in c) == (fid == "still/avatar"), fid
            else:
                rigs = {"black": render["rigPath"], **render["colorRigPaths"]}
                assert list(rigs) == FIT_COLORS, item["productId"]
                for path in rigs.values():
                    assert path in bundle["files"], path
                    frames = json.loads(static_file(path).read_text())["frames"]
                    assert set(frames) == frame_ids({**FIT_MOTIONS, "read": 0}, FIT_STILLS), path
        else:
            assert item["kind"] == "decor"
            assert set(item["renderData"]["placements"]) == {"isometric", "side"}
    assert "cust.head.duck" not in {x["productId"] for x in items}
    assert next(x["productId"] for x in items if x["sourceId"] == "head-duck") == "cust.head.duck-plush"
    shoes = next(x for x in items if x["category"] == "shoes")
    assert set(json.loads(static_file(shoes["renderData"]["rigPath"]).read_text())) == frame_ids(MOTIONS)
    checked = 0
    for seconds in sorted(set(range(0, 14401, 60)) | {899, 900, 1799, 1800, 3599, 3600, 86400, 10**9}):
        per_place = {}
        for location in ("ISLAND", "SEA"):
            grades = probabilities(policy, seconds, location)
            quantity = int(seconds >= 900)
            assert abs(sum(grades.values()) - quantity) < 1e-12
            assert all(0 <= p <= 1 for p in grades.values())
            assert seconds >= 1800 or grades["rare"] == 0
            assert seconds >= 3600 or grades["legendary"] == 0
            category_weights = policy["categoryWeights"]
            item_probs = [
                category_weights[x["category"]] / sum(category_weights.values())
                * grades[x["rarity"]] / counts[(x["category"], x["rarity"])]
                for x in items
            ]
            assert abs(sum(item_probs) - quantity) < 1e-12
            per_place[location] = grades
            checked += 1
        for grade, threshold in [("rare", 1800), ("legendary", 3600)]:
            if seconds >= threshold:
                assert per_place["ISLAND"][grade] > per_place["SEA"][grade]
    fixtures_path = ROOT / "server/scripts/customization/probability-fixtures.json"
    fixtures = json.loads(fixtures_path.read_text())
    assert fixtures["sourceWorkbookSha256"] == bundle["sourceWorkbookSha256"]
    for case in fixtures["cases"]:
        for location in ("ISLAND", "SEA"):
            computed = probabilities(policy, case["activeSeconds"], location)
            for grade, expected in zip(GRADES, case[location]):
                assert abs(computed[grade] - expected) < 1e-12
    print(f"90종·{len(bundle['files'])}개 파일·머리·목 6색 26자세·확률 {checked}조건·엑셀 경계값 일치")


if __name__ == "__main__":
    main()
