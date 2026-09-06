# SARIF presentation output

The validator can project its deterministic JSON receipt into SARIF 2.1.0 for GitHub code scanning and editor integrations:

```bash
npx tsjsv check \
  --typespec=contracts/main.tsp \
  --schema=contracts/authored.schema.json \
  --report=.typespec-json-schema-validator/report.json \
  --sarif=.typespec-json-schema-validator/report.sarif
```

The JSON receipt remains the admission artifact. SARIF is presentation-only and cannot authorize a merge, release, migration, package promotion, or deployment. A consumer must still require a `passed` JSON receipt for the exact revision with zero unexplained findings.

## Data boundary

SARIF contains stable `TSJSV.<source-rule-id>` rules, declaration names, JSON Pointers, bounded source locations, and the existing finding fingerprints. It deliberately excludes `left`, `right`, witness instances, schema values, arbitrary compiler messages, remote URIs, hostnames, and wall-clock timestamps. Full adjudication evidence remains in the JSON receipt.

Existing SARIF files are replaced only when they carry this validator's ownership envelope. Existing source files, unrelated JSON, symbolic links, and multiply linked files fail closed without truncation.

## GitHub code scanning

Use immutable action revisions in production. The placeholders below must be replaced with reviewed commit SHAs:

```yaml
permissions:
  contents: read
  security-events: write

steps:
  - uses: actions/checkout@<reviewed-commit-sha>
  - uses: ORESoftware/typespec-json-schema-validator@<reviewed-commit-sha>
    with:
      typespec: contracts/main.tsp
      schema: contracts/authored.schema.json
      report: .typespec-json-schema-validator/report.json
      sarif: .typespec-json-schema-validator/report.sarif
  - uses: github/codeql-action/upload-sarif@<reviewed-commit-sha>
    if: always()
    with:
      sarif_file: .typespec-json-schema-validator/report.sarif
```

The composite action defaults `sarif` to `.typespec-json-schema-validator/report.sarif`. Pass an empty value to disable the projection.

## Programmatic API

```js
import { serializeSarif, toSarif, writeSarif } from '@oresoftware/typespec-json-schema-validator';

const sarifObject = toSarif(report);
const deterministicBytes = serializeSarif(report);
await writeSarif('artifacts/report.sarif', report);
```
