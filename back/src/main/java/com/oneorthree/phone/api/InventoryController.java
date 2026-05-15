package com.oneorthree.phone.api;

import com.oneorthree.phone.api.dto.request.GrantItemRequest;
import com.oneorthree.phone.api.dto.response.UserItemResponse;
import com.oneorthree.phone.service.InventoryService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/inventory")
@RequiredArgsConstructor
public class InventoryController {
    private final InventoryService inventoryService;

    @GetMapping("/{userId}")
    public ResponseEntity<List<UserItemResponse>> getInventory(@PathVariable Long userId) {
        List<UserItemResponse> response = inventoryService.getInventory(userId);
        return ResponseEntity.ok(response);
    }

    @PostMapping("/grant")
    public ResponseEntity<Void> grantItem(@RequestBody GrantItemRequest request) {
        inventoryService.grantItem(request.getUserId(), request.getItemId());
        return ResponseEntity.ok().build();
    }
}
