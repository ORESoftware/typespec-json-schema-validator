# Fleet rollout

## Phase 1 — observe without promotion

Run `tsjsv check` in pull requests and upload the JSON receipt. Do not make it required until every intentionally divergent declaration has an owner and either converges or is represented by an explicit mapping.

Track:

- repositories enrolled;
- declarations compared;
- unexplained finding count and age;
- compiler/emitter versions;
- false-positive reports; and
- percentage of runs with immutable input digests.

## Phase 2 — fail closed on changed contracts

Require exit code `0` when a pull request changes `.tsp`, `.schema.json`, mapping, or generator configuration. Existing unrelated discrepancies can be captured in a reviewed baseline, but new fingerprints must block.

## Phase 3 — full promotion gate

Require zero unexplained findings for every build and scheduled drift run. Store receipts with the exact Git SHA. Consumer code generation, ORM generation, OpenAPI generation, and deployment promotion may consume only a green receipt matching the current head.

## Adoption checklist

1. Identify the independently authored TypeSpec entry point.
2. Identify the independently authored Draft 2020-12 schema bundle or directory.
3. Ensure generated output is outside both authority directories.
4. Add explicit mappings for names that cannot match directly.
5. Run positive and intentionally negative fixtures.
6. Archive the report as CI evidence.
7. Make the check required only after the discrepancy queue is owned.
8. Pin tool and TypeSpec versions through the lockfile.
9. Re-run on dependency updates.
10. Never auto-apply generated changes to either authority.
