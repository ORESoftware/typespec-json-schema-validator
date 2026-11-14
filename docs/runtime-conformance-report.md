# Runtime conformance decision receipt

Runtime adapter evidence and the decision that admits or rejects that evidence are different protocol objects.

- `ores.typespec-json-schema-validator.runtime-evidence/v1` is the untrusted, minimal adapter envelope.
- `ores.typespec-json-schema-validator.runtime-conformance-report/v1` is the deterministic decision produced by the trusted comparator.

Sharing one schema identifier for both objects makes artifact routing, retention, and downstream admission ambiguous. The runtime API therefore returns a dedicated decision receipt and publishes its Draft 2020-12 schema at `schema/runtime-conformance-report.schema.json`.

## Preparing isolated adapter jobs

The trusted caller must retain the complete parity receipt, Contract IR, and fresh Contract IR verification. Adapter jobs receive only the immutable identifiers they must echo:

```js
import {
  createRuntimeEvidenceContractBinding,
} from '@oresoftware/typespec-json-schema-validator/runtime-conformance';

const binding = createRuntimeEvidenceContractBinding({
  contractIr,
  contractIrVerification,
});

const adapterInput = {
  ...binding,
  corpusDigest,
  // generated validator sources, pinned toolchain, and recorded cases
};
```

The helper reuses the full Contract IR admission gate. It refuses a malformed self-digest, changed authority role, missing source-lane provenance, stale parity receipt, duplicate declaration identity, non-admissible IR, or verification result that does not match the current inputs. Failure text contains rule identifiers rather than arbitrary Contract IR or verification payload content.

## Decision fields

`compareRuntimeEvidence()` preserves the existing bounded findings and summaries and additionally returns:

- `schema`: the dedicated runtime-conformance report identifier;
- `contractIrId`: the verified Contract IR self-digest, or `null` when it could not be verified;
- `contractIrVerified`: whether the complete Contract IR gate passed;
- `receiptRunId`: the admitted parity receipt run ID;
- `receiptDigest`: the canonical parity receipt digest, but only when Contract IR verification passed;
- `evidenceDigest`: the canonical normalized adapter evidence digest; and
- `expectedCaseDigest`: the canonical trusted-corpus expectation digest.

A stopped report never promotes a copied receipt digest into trusted output. Runtime evidence remains downstream execution evidence; independently authored TypeSpec and JSON Schema remain the peer authorities, and TypeSpec-generated JSON Schema remains comparison evidence only.
