---
description: Scaffold a new Spring REST endpoint as study skeletons — every layer is empty bodies + `// TODO` guideline comments the user implements themselves
argument-hint: "<ticket number or endpoint description, e.g. GROMO-286>"
allowed-tools: Bash, Read, Grep, Glob, Edit, Write
---

Scaffold the endpoint for: **$ARGUMENTS**

## Purpose

The user implements EVERYTHING themselves, as a learning exercise. Your job is only to
create the skeleton files/methods and write **brief `// TODO` guideline comments inside
them** describing, step by step, what the user needs to write. The TODO comments ARE the
deliverable — study notes written into the real source files.

## The Iron Rule — applies to EVERY layer

**NEVER write implementation. NEVER complete a method body, a field list, a query method,
a mapping, or routing wiring.** Controller, Service, Repository, Domain, DTO — all of them
are skeleton + `// TODO` only. There is NO layer that you are allowed to "complete because
it's just wiring." Routing, validation annotations, field declarations, Swagger
annotations — the user writes all of it.

You only write:
1. The minimal declaration needed for the file to exist (package, class/interface/enum
   declaration, method signature).
2. `// TODO:` comments explaining what goes inside.

If you catch yourself typing a field, an annotation, an `if`, a `.stream()`, a repository
call, a `return ResponseEntity...`, or a query method name — STOP. That is a violation.

## What each layer gets

| Layer | You write | TODO comments describe |
|-------|-----------|------------------------|
| **DTO** | class declaration + empty body | which fields, which validation annotations, which inner enums are needed |
| **Domain** | (usually nothing new) | which mutation methods to add and what they do |
| **Repository** | interface declaration if new | which query methods (by signature intent) to add |
| **Service** | method signature + `@Transactional` + empty/`return null` body | numbered steps: what to look up, what to check, what error to throw, which mutation/repo method will be needed |
| **Controller** | method signature + empty body | which HTTP mapping + Swagger annotations to add, how to extract userId, which service method to call, what to return |

## TODO comment style (brief — study hints, not a spec)

```java
// GROMO-XXX: 그룹 설정 수정
// TODO: @PatchMapping("/groups/{groupId}") 매핑 + @Operation/@ApiResponses(204/400/403/404) 추가
// TODO: @PathVariable groupId, @RequestBody UpdateGroupRequest, HttpServletRequest 파라미터
// TODO: httpServletRequest.getAttribute("userId")로 userId 추출 → groupService.updateGroup 호출 → 204 반환
public void updateGroup(...) {
}
```

One line per step. Point at the method/annotation/error to use; flag any error code, enum
value, domain mutation, or repository method the user must add elsewhere. Do not paste real
implementation into the comments.

## Style
- 4-space indent, 120-col lines
- No star imports — explicit imports only; no unused imports

## After scaffolding
- List all created/modified files
- List the TODO items + cross-cutting additions the user must make (error codes, enum
  values, domain mutations, repository methods)
- Do NOT run `/back-check` or any tests unless explicitly asked
