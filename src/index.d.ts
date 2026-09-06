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
  fingerprint: string;
}

export interface ValidatorReport {
  schema: 'ores.typespec-json-schema-validator.report/v1';
  runId: string;
  status: ValidatorStatus;
  zeroUnexplainedFindings: boolean;
  findings: ValidatorFinding[];
  [key: string]: unknown;
}

export interface CheckOptions {
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

export interface CompareOptions {
  typespec: string;
  authoredSchema: string;
  generatedSchema: string;
  mapping?: string;
  maxFindings?: number;
  tspBin?: string;
}

export function runCheck(options: CheckOptions): Promise<ValidatorReport>;
export function runCompare(options: CompareOptions): Promise<ValidatorReport>;
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
