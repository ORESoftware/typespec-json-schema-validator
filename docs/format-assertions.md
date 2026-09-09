# Opt-in format assertions

`formatAssertion` remains false by default. When enabled, `validateInstance`
uses the shared format checks in `src/format-assertions.mjs`. Differential
validation of independently authored JSON Schema and the TypeSpec-generated
comparison witness therefore uses the same checks without modifying either
source. The generated witness is not a third authority.

## Semantics of this repair

- `date` validates the four-digit proleptic Gregorian calendar, including the
  century/400-year leap-year rules, rather than accepting a date-shaped string.
- `time` requires the RFC 3339 full-time spelling, seconds, timezone, valid
  clock/offset fields, and optional decimal second fraction. Lowercase `z` and
  the unknown-local-offset spelling `-00:00` remain accepted.
- `date-time` requires a valid date, `T` or `t`, and a valid full-time.
- A second of `60` must map to UTC 23:59. For `date-time`, it must also map to
  a UTC month end, accounting for the offset and local date rollover. This is
  a placement check, **not verification against an announced leap-second
  schedule**. No historical/future schedule or negative leap-second calendar
  is maintained; application-specific temporal rules need separate evidence.
- `ipv4` and `ipv6` use Node's IP parser. IPv6 supports compressed and
  IPv4-embedded forms, but not URI brackets, CIDR suffixes or zone identifiers.
- Known regex-backed formats require a full-string match, including rejection
  of an otherwise valid value followed by a line terminator.
- Unknown format names remain annotations, even names such as `constructor`,
  `__proto__` and `toString`. The dispatch table has no inherited properties.

This is not certification of the complete JSON Schema Format-Assertion
vocabulary. Existing email, hostname, URI/reference and duration patterns
remain bounded implementations; this repair does not expand their grammar.
It does not independently prove Rust, Dart, Zod or other runtime conformance.
Consumers still need exact-revision TJSV receipts and actual cross-runtime
positive/negative decision evidence before promotion.

## Regression evidence

The shared case corpus is exercised against both the pure format module and
actual `validateInstance` admission. Unit tests additionally enumerate every
four-digit year against Node's UTC calendar and all 2,879 numeric minute
offsets, and cover nested paths, `$ref`, composition/probe contexts, disabled
assertions, unknown annotations and capped error lists. This finite corpus is
bounded evidence, not proof of universal equivalence.

```sh
node --test test/unit/format-assertions.test.mjs test/unit/instance-format-assertions.test.mjs
npm run test:all
```

The first command is the focused suite. The second includes the existing
syntax, flags-2-env CLI-contract, complete unit and compiler-backed integration
gates. Hosted CI runs those gates and package-content checks on Linux/macOS;
record the actual exact-head results rather than treating this document as a
passing execution receipt.

References: RFC 3339 sections 5.6–5.7
(https://www.rfc-editor.org/rfc/rfc3339), JSON Schema Draft 2020-12 validation
(https://json-schema.org/draft/2020-12/json-schema-validation), and Node net.isIP
(https://nodejs.org/api/net.html#netisipinput).
