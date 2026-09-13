package com.oneorthree.notification;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;
import java.util.UUID;

@RestController
class InternalController {

    private final DeviceService devices;
    private final SettingsService settings;
    private final AckService ack;
    private final InboundService inbound;
    private final Store store;

    InternalController(DeviceService devices, SettingsService settings, AckService ack,
            InboundService inbound, Store store) {
        this.devices = devices;
        this.settings = settings;
        this.ack = ack;
        this.inbound = inbound;
        this.store = store;
    }

    @GetMapping("/health")
    Map<String, Object> health() {
        store.one("SELECT id FROM dispatch_control WHERE id=1");
        return Map.of("status", "UP");
    }

    @PostMapping("/internal/events")
    Map<String, Object> event(@RequestBody Map<String, Object> body) {
        return inbound.accept(body);
    }

    @PostMapping("/internal/devices")
    Map<String, Object> register(@RequestBody Map<String, Object> body,
            @RequestHeader("Idempotency-Key") String key, HttpServletRequest request) {
        return devices.register(ServiceAuth.delegatedUser(request), body, key);
    }

    @DeleteMapping("/internal/devices")
    Map<String, Object> delete(@RequestHeader("Idempotency-Key") String key,
            @RequestHeader(value = "X-Device-Token", required = false) String token,
            @RequestHeader(value = "X-Device-Ownership", required = false) String owner,
            @RequestHeader(value = "X-Auth-Generation", required = false) Long generation,
            @RequestHeader(value = "X-Device-Session", required = false) String sessionId,
            @RequestHeader(value = "X-Device-Bootstrap-Hash", required = false) String bootstrapHash,
            HttpServletRequest request) {
        return devices.delete(ServiceAuth.delegatedUser(request), token, owner, generation,
                sessionId, bootstrapHash, key);
    }

    @GetMapping("/internal/users/{userId}/notification-settings")
    Map<String, Object> settings(@PathVariable UUID userId) {
        return settings.read(userId);
    }

    @PutMapping("/internal/users/{userId}/notification-settings")
    Map<String, Object> settings(@PathVariable UUID userId, @RequestBody Map<String, Object> body,
            @RequestParam long version, @RequestHeader("Idempotency-Key") String key) {
        if (version < 1) {
            throw new NotificationFailure(400, "INVALID_SETTINGS_VERSION");
        }
        return settings.apply(userId, body, version, key);
    }

    @PatchMapping("/internal/users/{userId}/notification-settings")
    Map<String, Object> patchSettings(@PathVariable UUID userId, @RequestBody Map<String, Object> body,
            @RequestParam long version, @RequestHeader("Idempotency-Key") String key) {
        return settings.patch(userId, body, version, key);
    }

    @PostMapping("/internal/users/{userId}/notification-settings/initialized")
    Map<String, Object> initializeSettings(@PathVariable UUID userId, @RequestBody Map<String, Object> body) {
        return settings.initialize(userId, body);
    }

    @PostMapping("/internal/users/{userId}/result-ack/{action}")
    Map<String, Object> ack(@PathVariable UUID userId, @PathVariable String action,
            @RequestBody Map<String, Object> body, @RequestHeader("Idempotency-Key") String key) {
        return ack.command(userId, Json.uuid(body, "sessionId"), action, key);
    }
}
