# Protobuf behavior bindings

The existing `protobuf-projection/v1` remains focused on Protobuf wire compatibility: messages, field numbers, presence, JSON names, enums, services and RPC method signatures. Behavioral identity is carried separately so adding semantic metadata does not break existing projection-v1 consumers.

A `protobuf-behavior-bindings/v1` document maps an RPC method to the stable operation ID in `behavior-contract/v1`:

```json
{
  "schema": "ores.typespec-json-schema-validator.protobuf-behavior-bindings/v1",
  "package": "fiducia.transport_parity.v1",
  "bindings": [
    {
      "service": "OpportunityAdmissionService",
      "method": "EvaluateOpportunityAdmission",
      "operationId": "evaluate_opportunity_admission"
    }
  ]
}
```

The corresponding `.proto` should carry the same operation ID in a custom `google.protobuf.MethodOptions` extension. The option is a binding, not a second copy of the CEL/CUE/Rego/Dafny source.

`verifyProtobufBehaviorBindings()` proves that:

- the binding package matches the normalized Protobuf projection;
- each bound `service.method` exists in that projection;
- when a behavioral authority is supplied, every referenced `operationId` exists there;
- when `requireAllMethods` is enabled, every RPC method has an explicit behavioral binding.

The resulting receipt binds the normalized Protobuf projection, behavior-binding map and optional behavioral authority by SHA-256 digests. This gives Protobuf semantic identity without changing the existing v1 wire compatibility format.
