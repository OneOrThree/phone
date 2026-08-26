---
description: Run the backend local CI gate (Checkstyle + SpotBugs + tests) and summarize only failures
argument-hint: "[optional: extra gradle test args, e.g. --tests *CurrencyServiceTest]"
allowed-tools: Bash, Read, Grep
---

Run the same checks CI runs (`.github/workflows/dev-ci.yml`) locally so I catch what CI
would reject, before pushing.

Steps:
1. From `server/data-api/`, run the chained gate:
   `cd server/data-api && SPRING_PROFILES_ACTIVE=ci ./gradlew checkstyleMain spotbugsMain test $ARGUMENTS`
   - The `test` task spins up a Testcontainers PostgreSQL, so Docker must be running.
     If Docker isn't available or the test DB fails to start, fall back to
     `./test-local.sh $ARGUMENTS` (it manages its own `test-postgres` container) and say so.
2. Report **only what failed**, grouped:
   - **Checkstyle**: each violation as `file:line — rule — message`. Reports are at
     `server/data-api/build/reports/checkstyle/main.html` (+ `main.xml`).
   - **SpotBugs** (effort=max, HIGH only): each finding with class/method and the bug
     pattern. Report at `server/data-api/build/reports/spotbugs/main.html`.
   - **Tests**: each failing test with the assertion/exception. Reports under
     `server/data-api/build/reports/tests/test/` and JUnit XML under
     `server/data-api/build/test-results/test/`.
3. For each failure, give a one-line concrete fix suggestion.
4. If everything passes, say so plainly (green) and stop — do not over-explain.

Do not commit, push, or modify anything. This command is read/verify only.
