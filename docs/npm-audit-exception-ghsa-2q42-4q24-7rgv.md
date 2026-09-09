# Temporary production-audit exception: GHSA-2q42-4q24-7rgv

Owner: ORESoftware. Review expiry: **2026-10-09T00:00:00Z**.

The production TJSV action currently pins `@typespec/compiler` 1.15.0 because `@typespec/json-schema` 1.15.0 is the reviewed peer-authority emitter. `npm audit --omit=dev` reports `GHSA-2q42-4q24-7rgv` as high severity and currently reports no fixed version. The count also propagates through `@typespec/asset-emitter` and `@typespec/json-schema`.

This is not a claim that the advisory is fixed. The exception exists only because the reviewed exploit path is outside TJSV's emitter boundary, and CI proves that boundary continuously:

- TJSV resolves and explicitly passes only `@typespec/json-schema` to the normal `tsp compile --emit` path.
- The pinned in-process compiler fallback replaces the emitter list with only the resolved JSON Schema emitter.
- `test/integration/emitter-isolation.test.mjs` supplies an input `tspconfig.yaml` that requests `@typespec/openapi3`, which is not installed. The test must still pass in normal **subprocess** mode. Falling back or activating the project emitter fails the regression.
- The production lockfile must not contain `@typespec/openapi3`.

`scripts/check-production-audit.mjs` is the fail-closed policy. Until expiry it permits only the exact GHSA, exact compiler version 1.15.0, and the three expected affected npm entries. Any critical vulnerability, any other high advisory, compiler-version drift, OpenAPI3 entering the production graph, malformed/unavailable npm audit output, or expiry fails CI. If the advisory disappears, CI also fails so the exception is reviewed and removed rather than becoming permanent dead policy.

Merge or release evidence for this exception must name the exact tested commit SHA and a completed hosted CI run for that SHA. A green run from an earlier tree, a local-only test, or a ref move without a corresponding hosted run is insufficient.

Before expiry, re-check upstream for a fixed compatible TypeSpec/compiler + JSON Schema emitter release. Prefer upgrading to a fixed version and deleting this exception. Do not extend the date merely to make CI green; an extension requires a new reachability review and recorded rationale.
