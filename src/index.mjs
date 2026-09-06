export {
  canonicalStringify,
  canonicalizeJson,
  deepDiff,
  normalizeSchemaDocument,
  normalizeSchemaNode,
  sha256,
} from './canonical.mjs';
export { emitTypeSpecJsonSchema, runCommand, toolVersion } from './emitter.mjs';
export {
  extractSchemaDeclarations,
  inferSchemaKind,
  JSON_SCHEMA_DRAFT_2020_12,
  loadSchemaCollection,
  validateJsonSchemaDocument,
} from './json-schema.mjs';
export {
  buildLaneResolver,
  crossValidate,
  loadInstanceCorpus,
  runDifferential,
} from './differential.mjs';
export {
  jsonEquals,
  SchemaResolutionError,
  SchemaResolver,
  UnsupportedKeywordError,
  validateInstance,
} from './instance-validator.mjs';
export { compareParity, loadMapping, MAPPING_SCHEMA, sortFindings } from './parity.mjs';
export {
  EXIT_CODES,
  REPORT_SCHEMA,
  failedReport,
  renderHumanSummary,
  runCheck,
  runCompare,
  runValidate,
  writeReport,
} from './run.mjs';
export {
  SARIF_SCHEMA,
  SARIF_TOOL_NAME,
  SARIF_VERSION,
  serializeSarif,
  toSarif,
  writeSarif,
} from './sarif.mjs';
export { UnsafeSarifDestinationError, writeSarifFile } from './sarif-file.mjs';
export {
  buildProbes,
  collectValueDomains,
  mutateInstance,
  synthesizeInstance,
  OUT_OF_DOMAIN_STRING,
  UNEXPECTED_PROPERTY,
} from './witness.mjs';
export {
  declarationKindFamily,
  inventoryTypeSpec,
  inventoryTypeSpecSource,
  lexTypeSpec,
} from './typespec-inventory.mjs';
