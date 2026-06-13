---
description: Scaffold a new Spring REST endpoint (Controller→Service→Repository→DTO + test) following project conventions, TDD-first
argument-hint: "<what the endpoint should do, e.g. 유저 친구 목록 조회 GET /api/v1/friends>"
allowed-tools: Bash, Read, Grep, Glob, Edit, Write
---

Build a new backend endpoint for: **$ARGUMENTS**

First invoke the `superpowers:test-driven-development` skill and drive the work
test-first. If the feature is non-trivial or its shape is unclear, invoke
`superpowers:brainstorming` before writing code.

Follow the existing conventions exactly — read a real controller as the template
before writing anything:
- `back/src/main/java/com/oneorthree/phone/api/InGameCurrencyController.java`
- `back/src/main/java/com/oneorthree/phone/api/UserController.java`

Conventions to match (base package `com.oneorthree.phone`):
- **Layering**: `api/` controller → `service/` service → `repository/<feature>/` repository
  → `domain/<feature>/` entity. Keep each layer's responsibility clean; never expose
  entities from controllers.
- **Controller**: `@RestController`, `@RequestMapping("/api/v1")`, `@RequiredArgsConstructor`
  (constructor injection via Lombok — no field `@Autowired`). Swagger `@Tag` on the class
  and `@Operation(summary, description)` per method, **descriptions in Korean**. Return
  `ResponseEntity<...>`. The authenticated user id comes from
  `(Long) request.getAttribute("userId")` (set by `JwtFilter`) — use that, don't add a
  custom auth param.
- **DTOs**: request/response DTOs go under the closest existing feature package — either
  `service/dto/<feature>/` (e.g. `service/dto/currency/CurrencyRequest`) or
  `api/dto/request` / `api/dto/response`. Match whichever the nearest sibling feature uses.
  Add Bean Validation (`@Valid`, `@NotNull`, etc.) on request bodies.
- **Service**: `@Service`, `@RequiredArgsConstructor`, `@Transactional` (use
  `@Transactional(readOnly = true)` for queries).
- **Style**: obey `back/config/checkstyle/checkstyle.xml` — 4-space indent, 120-col lines,
  UpperCamelCase types / lowerCamelCase members / UPPER_SNAKE_CASE constants, no unused imports.
- **Test**: write a JUnit 5 test (Testcontainers PostgreSQL is available — see existing
  tests under `back/src/test/`). Cover the new service logic and the controller contract.

After implementing, run `/back-check` (or `cd back && SPRING_PROFILES_ACTIVE=ci ./gradlew checkstyleMain spotbugsMain test`)
and fix any failures. If the change touches the DB schema, tell me to also run
`/back-migration`. Do not commit or push.
