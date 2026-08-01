package com.oneorthree.phone.invitelink.api;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Apple App Site Association — iOS 가 Universal Links 를 켜기 위해 읽는 파일.
 *
 * <p>정적 리소스로 두지 않고 컨트롤러가 서빙한다. 파일명에 확장자가 없어 정적 서빙으로는
 * content-type 이 {@code application/octet-stream} 등으로 어긋나고, 그러면 iOS 가 조용히 무시한다.
 *
 * <p><b>리다이렉트 금지</b>도 같은 이유다 — Apple 의 CDN 은 리다이렉트를 따라가지 않는다.
 * (배포 후 Apple CDN 전파에 24~48h 걸린다는 점은 배포 일정에서 감안한다.)
 */
@RestController
@Tag(name = "WellKnown", description = "Universal Links 연결 파일")
public class WellKnownController {

    /** appID = {@code <Team ID>.<bundle id>}. 경로는 초대 링크 전용({@code /l/*})으로 좁힌다. */
    private static final String AASA = """
            {"applinks":{"apps":[],"details":[\
            {"appIDs":["P6Z68QUK9M.com.oneorthree.gromo"],"components":[{"/":"/l/*"}]}]}}""";

    @Operation(summary = "AASA 서빙", description = "application/json, 리다이렉트 없음")
    @GetMapping(value = "/.well-known/apple-app-site-association",
            produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<String> appleAppSiteAssociation() {
        return ResponseEntity.ok()
                .contentType(MediaType.APPLICATION_JSON)
                .body(AASA);
    }
}
