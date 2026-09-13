# OpenAPI 3.1 compatibility

TJSV normalizes the HTTP surface into `openapi-projection/v1` and compares an admitted baseline with a current projection. The projection is downstream transport evidence: it does not replace independently authored TypeSpec or JSON Schema authorities.

The v1 gate intentionally focuses on compatibility-significant operation semantics: stable `operationId`, HTTP method/path, parameters, request body, responses, referenced structural schemas, and optional normalized `x-ores-behavior` metadata.

The following changes stop promotion as breaking: removing an operation, changing its route, removing an existing parameter, changing parameter/request/response schema references, making an optional parameter/body required, adding a new required parameter/body, removing a request body, or removing a previously documented response.

Backward-compatible additions such as a new operation, optional parameter, or additional response remain admissible. A behavioral metadata change is not automatically labeled structurally breaking; instead it emits `review_required` and stops promotion until semantic review or executable behavior evidence proves compatibility.

This separation is deliberate. HTTP compatibility is not the same problem as Protobuf wire compatibility, and neither is the same problem as behavioral equivalence. TJSV gives each dimension its own fail-closed gate while preserving one operation identity across projections.
