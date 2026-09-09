# Current-input verification for five-runtime promotion

For the five-runtime manifest example, promotion must use the current-input verifier rather than trusting a retained passed-looking parity report or Contract IR object by itself.

The trusted path is:

1. independently author TypeSpec and JSON Schema Draft 2020-12 as peer authorities;
2. run TJSV parity and retain the exact passed receipt;
3. retain the parity-bound Contract IR as downstream evidence;
4. execute each required language/runtime producer and emit exact evidence;
5. call `verifyLanguageBoundariesAgainstCurrentInputs()` with the current authored sources, generated Schema B witness, retained receipt/IR, manifest, and runtime evidence map;
6. promote only the exact artifacts whose returned receipt is `passed` with zero unexplained findings.

Any current-source drift, generated-witness drift, stale/tampered Contract IR, mismatched parity run, missing runtime evidence, runtime source-revision disagreement, or failed ingress/egress result stops evaluation.
