package com.oneorthree.business.linkpreview;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import com.oneorthree.business.auth.AuthAttributes;
import com.oneorthree.business.config.RequestEnvelopeFilter;
import com.oneorthree.business.linkpreview.dto.Preview;
import com.oneorthree.business.linkpreview.service.PreviewService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.List;
import org.springframework.http.CacheControl;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/link-previews")
public class PreviewController {

    /** 외부 배치 입력은 엄격히 검증하되 상류 응답의 확장 필드는 허용한다. */
    public record BatchRequest(@NotNull @Size(min = 1, max = 10) List<@NotBlank @Size(max = 4096) String> urls) {
        @JsonAnySetter
        public void rejectUnknown(String name, Object value) {
            throw new IllegalArgumentException("Unknown request field");
        }
    }

    private final PreviewService service;

    public PreviewController(PreviewService service) {
        this.service = service;
    }

    @PostMapping
    public List<Preview> create(@Valid @RequestBody BatchRequest body, HttpServletRequest request) {
        return service.request((String) request.getAttribute(AuthAttributes.USER_ID), body.urls(),
                (String) request.getAttribute(RequestEnvelopeFilter.REQUEST_ID));
    }

    @GetMapping("/{id}")
    public Preview get(@PathVariable String id, HttpServletRequest request) {
        return service.get((String) request.getAttribute(AuthAttributes.USER_ID), id);
    }

    @GetMapping(value = "/{id}/thumbnail", produces = MediaType.IMAGE_PNG_VALUE)
    public ResponseEntity<byte[]> thumbnail(@PathVariable String id, HttpServletRequest request) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).contentType(MediaType.IMAGE_PNG)
                .header("X-Content-Type-Options", "nosniff")
                .body(service.thumbnail((String) request.getAttribute(AuthAttributes.USER_ID), id));
    }
}
