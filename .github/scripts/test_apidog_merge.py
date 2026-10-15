"""apidog-merge.py 단위 테스트 (GROMO-2069).

실행: python3 -m unittest .github/scripts/test_apidog_merge.py -v
"""
import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).with_name("apidog-merge.py")
spec = importlib.util.spec_from_file_location("apidog_merge", SCRIPT)
merge_mod = importlib.util.module_from_spec(spec)
sys.modules["apidog_merge"] = merge_mod
spec.loader.exec_module(merge_mod)


def make_spec(paths, schemas=None, refs_to=None):
    """paths: {path: [methods]} — 각 operation 에 최소 필드만 채운다."""
    spec = {"openapi": "3.0.3", "info": {"title": "t", "version": "1"}, "paths": {}}
    for path, methods in paths.items():
        spec["paths"][path] = {
            m: {"operationId": f"op_{m}_{path.strip('/').replace('/', '_') or 'root'}",
                "responses": {"200": {"description": "ok"}}}
            for m in methods
        }
    if schemas:
        spec["components"] = {"schemas": schemas}
    if refs_to:
        # refs_to: 스키마 이름 — 응답에서 그 스키마를 참조하게 만든다.
        for item in spec["paths"].values():
            for op in item.values():
                op["responses"]["200"]["content"] = {
                    "application/json": {"schema": {"$ref": f"#/components/schemas/{refs_to}"}}}
    return spec


class ApidogMergeTest(unittest.TestCase):

    def merge(self, **service_specs):
        """kwargs service=spec → 병합 결과."""
        return merge_mod.merge(list(service_specs.items()))

    def op(self, merged, path, method):
        return merged["paths"][path][method]

    def test_각_operation에_서비스_폴더가_붙는다(self):
        merged = self.merge(
            **{"business-api": make_spec({"/me": ["get"]}),
               "data-api": make_spec({"/internal/users/{id}": ["get"]})})
        self.assertEqual(self.op(merged, "/me", "get")["x-apidog-folder"], "business-api")
        self.assertEqual(
            self.op(merged, "/internal/users/{id}", "get")["x-apidog-folder"], "data-api")

    def test_business의_api_v1은_legacy_하위폴더로_격리된다(self):
        merged = self.merge(**{"business-api": make_spec({"/api/v1/users/me": ["get"],
                                                          "/me": ["get"]})})
        self.assertEqual(
            self.op(merged, "/api/v1/users/me", "get")["x-apidog-folder"],
            "business-api/legacy")
        self.assertEqual(self.op(merged, "/me", "get")["x-apidog-folder"], "business-api")

    def test_같은_이름_스키마가_공존하고_ref가_따라간다(self):
        schema = {"type": "object", "properties": {"code": {"type": "string"}}}
        merged = self.merge(
            **{"business-api": make_spec({"/me": ["get"]},
                                         schemas={"ErrorResponse": dict(schema)},
                                         refs_to="ErrorResponse"),
               "data-api": make_spec({"/internal/users/{id}": ["get"]},
                                     schemas={"ErrorResponse": dict(schema)},
                                     refs_to="ErrorResponse")})
        self.assertIn("business-api.ErrorResponse", merged["components"]["schemas"])
        self.assertIn("data-api.ErrorResponse", merged["components"]["schemas"])
        ref = self.op(merged, "/me", "get")["responses"]["200"]["content"][
            "application/json"]["schema"]["$ref"]
        self.assertEqual(ref, "#/components/schemas/business-api.ErrorResponse")

    def test_operationId에_서비스_접두어가_붙는다(self):
        merged = self.merge(
            **{"business-api": make_spec({"/me": ["get"]}),
               "data-api": make_spec({"/internal/x": ["get"]})})
        self.assertTrue(
            self.op(merged, "/me", "get")["operationId"].startswith("business-api."))
        self.assertTrue(
            self.op(merged, "/internal/x", "get")["operationId"].startswith("data-api."))

    def test_operationId가_없으면_method와_path로_결정적_생성(self):
        spec = make_spec({"/internal/users/{userId}": ["post"]})
        del spec["paths"]["/internal/users/{userId}"]["post"]["operationId"]
        merged = self.merge(**{"data-api": spec})
        self.assertEqual(self.op(merged, "/internal/users/{userId}", "post")["operationId"],
                         "data-api.post_internal_users_userId")

    def test_같은_method_path를_두_서비스가_주장하면_실패(self):
        # business-api/data-api 는 경계 규칙 때문에 원래 겹칠 수 없다 — 규칙 없는 서비스명으로
        # 충돌 감지 자체를 검증한다(경계 규칙은 별도 테스트가 덮는다).
        with self.assertRaises(SystemExit):
            self.merge(
                **{"svc-a": make_spec({"/x": ["get"]}),
                   "svc-b": make_spec({"/x": ["get"]})})

    def test_다른_method면_충돌이_아니다(self):
        merged = self.merge(
            **{"business-api": make_spec({"/x": ["get"]}),
               "data-api": make_spec({"/internal/x": ["post"]})})
        self.assertIn("get", merged["paths"]["/x"])
        self.assertIn("post", merged["paths"]["/internal/x"])

    def test_security_요구객체의_평문_이름이_따라간다(self):
        spec = make_spec({"/internal/x": ["get"]})
        spec["components"] = {"securitySchemes": {"serviceToken": {"type": "http"}}}
        spec["paths"]["/internal/x"]["get"]["security"] = [{"serviceToken": []}]
        merged = self.merge(**{"data-api": spec})
        self.assertIn("data-api.serviceToken", merged["components"]["securitySchemes"])
        self.assertEqual(
            self.op(merged, "/internal/x", "get")["security"], [{"data-api.serviceToken": []}])

    def test_discriminator_mapping의_평문_이름이_따라간다(self):
        spec = make_spec({"/internal/x": ["get"]})
        spec["components"] = {"schemas": {
            "Base": {"type": "object",
                     "discriminator": {"propertyName": "t", "mapping": {"a": "Sub"}}},
            "Sub": {"type": "object"}}}
        merged = self.merge(**{"data-api": spec})
        mapping = merged["components"]["schemas"]["data-api.Base"]["discriminator"]["mapping"]
        self.assertEqual(mapping["a"], "data-api.Sub")

    def test_data_api에_비internal_경로가_있으면_실패(self):
        with self.assertRaises(SystemExit):
            self.merge(**{"data-api": make_spec({"/api/v1/x": ["get"]})})

    def test_business_api에_internal_경로가_있으면_실패(self):
        with self.assertRaises(SystemExit):
            self.merge(**{"business-api": make_spec({"/internal/x": ["get"]})})

    def test_빈_paths_스펙은_실패(self):
        with tempfile.TemporaryDirectory() as d:
            empty = Path(d) / "empty.json"
            empty.write_text(json.dumps({"openapi": "3.0.3", "paths": {}}))
            with self.assertRaises(SystemExit):
                merge_mod.main(["x", str(Path(d) / "o.json"), f"data-api={empty}"])

    def test_main_은_파일을_읽어_병합_스펙을_쓴다(self):
        with tempfile.TemporaryDirectory() as d:
            biz = Path(d) / "biz.json"
            dat = Path(d) / "dat.json"
            out = Path(d) / "merged.json"
            biz.write_text(json.dumps(make_spec({"/me": ["get"]})))
            dat.write_text(json.dumps(make_spec({"/internal/x": ["get"]})))
            merge_mod.main(["x", str(out), f"business-api={biz}", f"data-api={dat}"])
            merged = json.loads(out.read_text())
            self.assertEqual(set(merged["paths"]), {"/me", "/internal/x"})

    def test_깨진_스펙_파일은_실패(self):
        with tempfile.TemporaryDirectory() as d:
            bad = Path(d) / "bad.json"
            bad.write_text("not json")
            with self.assertRaises(SystemExit):
                merge_mod.main(["x", str(Path(d) / "o.json"), f"data-api={bad}"])


if __name__ == "__main__":
    unittest.main()
