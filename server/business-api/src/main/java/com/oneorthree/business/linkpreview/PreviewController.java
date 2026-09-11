package com.oneorthree.business.linkpreview;

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

    public record BatchRequest(@NotNull @Size(min = 1, max = 10) List<@NotBlank @Size(max = 4096) String> urls) {
    }

    private final PreviewService service;

    public PreviewController(PreviewService service) {
        this.service = service;
    }

    @PostMapping
    public List<Preview> create(@Valid @RequestBody BatchRequest body, HttpServletRequest request) {
        return service.request((String) request.getAttribute("userId"), body.urls(),
                (String) request.getAttribute("requestId"));
    }

    @GetMapping("/{id}")
    public Preview get(@PathVariable String id, HttpServletRequest request) {
        return service.get((String) request.getAttribute("userId"), id);
    }

    @GetMapping(value = "/{id}/thumbnail", produces = MediaType.IMAGE_PNG_VALUE)
    public ResponseEntity<byte[]> thumbnail(@PathVariable String id, HttpServletRequest request) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).contentType(MediaType.IMAGE_PNG)
                .header("X-Content-Type-Options", "nosniff")
                .body(service.thumbnail((String) request.getAttribute("userId"), id));
    }
}
