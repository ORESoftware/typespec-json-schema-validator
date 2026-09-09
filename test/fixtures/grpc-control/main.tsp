// Real-world peer-authority regression fixture derived from
// ORESoftware/grpc-pg-general-connect-server DEN-3914 control contracts.

import "@typespec/json-schema";
using TypeSpec.JsonSchema;

namespace Ores.GrpcPg.Control.V1;

@jsonSchema
@id("DatabaseTarget")
@extension("unevaluatedProperties", false)
model DatabaseTarget {
  @minLength(1)
  databaseAlias: string;
  schemas: string[];
}

@jsonSchema
@id("DriftKind")
enum DriftKind {
  DRIFT_KIND_UNSPECIFIED,
  DRIFT_KIND_MISSING_FROM_WITNESS,
  DRIFT_KIND_MISSING_FROM_DATABASE,
  DRIFT_KIND_COLUMN_MISMATCH,
  DRIFT_KIND_CONFIGURATION,
  DRIFT_KIND_CONTRACT_MISMATCH,
}

@jsonSchema
@id("Drift")
@extension("unevaluatedProperties", false)
model Drift {
  kind: DriftKind;
  witness: string;
  databaseAlias: string;
  schema: string;
  table: string;
  column: string;
  expected: string;
  actual: string;
}

@jsonSchema
@id("WitnessSummary")
@extension("unevaluatedProperties", false)
model WitnessSummary {
  source: string;
  revision: string;
  fingerprint: string;
  relationCount: uint32;
  columnCount: uint32;
  lineage: string;
  artifactDigest: string;
  contractVersion: string;
}

@jsonSchema
@id("CheckTargetSummary")
@extension("unevaluatedProperties", false)
model CheckTargetSummary {
  target: DatabaseTarget;
  balanced: boolean;
  witnessCount: uint32;
  driftCount: uint32;
}
