export type ValidatorStatus = 'passed' | 'stopped_for_evaluation' | 'failed';

export interface ValidatorFinding {
  ruleId: string;
  severity: 'error';
  resolutionState: 'unexplained';
  comparison: string;
  declaration?: string;
  pointer?: string;
  message: string;
  left?: unknown;
  right?: unknown;
  /** Present on `instance-verdict-divergence`: the instance proving the two lanes disagree. */
  witness?: DifferentialWitness;
  fingerprint: string;
}

export interface DifferentialWitness {
  probeId: string;
  origin: string;
  lane: 'authored' | 'generated' | 'corpus';
  mutation: string | null;
  pointer: string | null;
  synthesisComplete: boolean;
  instance: unknown;
}

export interface DifferentialSummary {
  comparedDeclarations: number;
  probesEvaluated: number;
  agreements: number;
  divergences: number;
  refusals: number;
  corpusInstances: number;
  maxProbesPerDeclarationPerLane: number;
  formatAssertion: boolean;
  behaviorallyIndistinguishableDeclarations: number;
}

export interface DifferentialDeclarationResult {
  typespec: string;
  generated: string;
  authored: string;
  probes: number;
  divergences: number;
  refusals: number;
  behaviorallyIndistinguishable: boolean;
}

export interface DifferentialResult {
  findings: ValidatorFinding[];
  declarations: DifferentialDeclarationResult[];
  summary: DifferentialSummary;
}

/** Options shared by every comparison command. */
export interface DifferentialOptions {
  /** Directory of JSON instances: `<Declaration>/{valid,invalid}/*.json`. */
  instances?: string;
  /** Set false to skip the differential lane; the receipt then records the missing evidence. */
  probes?: boolean;
  /** Synthesized probes per declaration per lane. */
  maxProbes?: number;
  /** Treat known `format` values as assertions in both lanes. */
  formatAssertion?: boolean;
}

export interface ValidatorReport {
  schema: 'ores.typespec-json-schema-validator.report/v1';
  runId: string;
  status: ValidatorStatus;
  zeroUnexplainedFindings: boolean;
  findings: ValidatorFinding[];
  [key: string]: unknown;
}

export interface CheckOptions extends DifferentialOptions {
  typespec: string;
  authoredSchema: string;
  outputDir: string;
  bundleId?: string;
  mapping?: string;
  maxFindings?: number;
  tspBin?: string;
  int64Strategy?: 'string' | 'number';
  sealObjectSchemas?: boolean;
  polymorphicModelsStrategy?: 'ignore' | 'oneOf' | 'anyOf';
}

export interface CompareOptions extends DifferentialOptions {
  typespec: string;
  authoredSchema: string;
  generatedSchema: string;
  mapping?: string;
  maxFindings?: number;
  tspBin?: string;
}

export interface ValidateOptions extends DifferentialOptions {
  authoredSchema: string;
  generatedSchema: string;
  mapping?: string;
  maxFindings?: number;
}

export interface InstanceCorpusItem {
  declaration: string;
  expectation: 'accepted' | 'rejected' | null;
  path: string;
  relativePath: string;
  instance: unknown;
}

export declare class SchemaResolver {
  constructor(documents?: Array<{ path: string; document: unknown }>);
  addDocument(document: unknown, path: string): { path: string; document: unknown; base: string };
  resolve(reference: string, base: string): { schema: unknown; base: string } | undefined;
  readonly documents: Array<{ path: string; document: unknown; base: string }>;
}

export declare class UnsupportedKeywordError extends Error {
  keyword: string;
  pointer: string;
  source: string;
}

export declare class SchemaResolutionError extends Error {
  reference: string;
  pointer: string;
  source: string;
}

export function runCheck(options: CheckOptions): Promise<ValidatorReport>;
export function runCompare(options: CompareOptions): Promise<ValidatorReport>;
export function runValidate(options: ValidateOptions): Promise<ValidatorReport>;
export function validateInstance(input: {
  schema: unknown;
  instance: unknown;
  resolver: SchemaResolver;
  base: string;
  formatAssertion?: boolean;
  maxErrors?: number;
}): { valid: boolean; errors: Array<Record<string, unknown>> };
export function crossValidate(input: Record<string, unknown>): DifferentialResult;
export function loadInstanceCorpus(input?: string): Promise<InstanceCorpusItem[]>;
export function synthesizeInstance(input: Record<string, unknown>): { instance: unknown; complete: boolean };
export function mutateInstance(
  seed: unknown,
  options?: { limit?: number; maxNodes?: number },
): Array<{ mutation: string; pointer: string; instance: unknown }>;
export function buildProbes(input: Record<string, unknown>): Array<Record<string, unknown>>;
export function collectValueDomains(input: Record<string, unknown>): Array<{ pointer: string; values: unknown[] }>;
export function jsonEquals(left: unknown, right: unknown): boolean;
export function sortFindings(findings: ValidatorFinding[]): ValidatorFinding[];
export function writeReport(path: string, report: ValidatorReport): Promise<string>;
export function renderHumanSummary(report: ValidatorReport): string;
export function inventoryTypeSpec(inputPath: string): Promise<Record<string, unknown>>;
export function inventoryTypeSpecSource(source: string, file?: string): Record<string, unknown>;
export function loadSchemaCollection(input: string, options?: Record<string, unknown>): Promise<Record<string, unknown>>;
export function validateJsonSchemaDocument(document: unknown, source?: string, options?: Record<string, unknown>): ValidatorFinding[];
export function compareParity(input: Record<string, unknown>): Record<string, unknown>;
export function normalizeSchemaNode(value: unknown, parentKey?: string): unknown;
export function normalizeSchemaDocument(value: unknown): unknown;
export function canonicalStringify(value: unknown, space?: number): string;
export function sha256(value: string | Buffer): string;
export const REPORT_SCHEMA: 'ores.typespec-json-schema-validator.report/v1';
export const EXIT_CODES: Readonly<Record<ValidatorStatus, number>>;
