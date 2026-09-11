export type FactorMethod =
  | 'totp'
  | 'passkey'
  | 'security-key'
  | 'email-otp'
  | 'sms-otp'
  | 'backup-code';

export type AuthPage =
  | 'sign-in'
  | 'sign-up'
  | 'challenge'
  | 'recovery'
  | 'consent'
  | 'error'
  | 'signed-out';

export type Theme = 'system' | 'light' | 'dark';

export interface SharedAuthConfigFile {
  schema_version: 1;
  compatibility:
    | { repository: string; commit: string }
    | { repository: string; range: { base: string; head: string } };
  factors?: {
    two_factor?: { required?: boolean; methods?: FactorMethod[] };
    three_factor?: { enabled?: boolean; methods?: FactorMethod[] };
  };
  pages?: { show?: AuthPage[] };
  styling?: { theme?: Theme; brand_name?: string; accent_color?: string };
}

const REPOSITORY = 'https://github.com/shared-auth/shared-auth-interfaces';
const SHA = /^[0-9a-f]{40}$/;
const ACCENT = /^#[0-9A-Fa-f]{6}$/;
const FACTORS = new Set<FactorMethod>([
  'totp',
  'passkey',
  'security-key',
  'email-otp',
  'sms-otp',
  'backup-code',
]);
const PAGES = new Set<AuthPage>([
  'sign-in',
  'sign-up',
  'challenge',
  'recovery',
  'consent',
  'error',
  'signed-out',
]);
const THEMES = new Set<Theme>(['system', 'light', 'dark']);

function record(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${path} must be an object`);
  }
  return value as Record<string, unknown>;
}

function closed(
  value: Record<string, unknown>,
  allowed: readonly string[],
  required: readonly string[],
  path: string,
): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedSet.has(key)) throw new Error(`${path}.${key} is not declared by the contract`);
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) throw new Error(`${path}.${key} is required`);
  }
}

function optionalBoolean(value: unknown, path: string): void {
  if (value !== undefined && typeof value !== 'boolean') throw new Error(`${path} must be boolean`);
}

function contractSet<T extends string>(
  value: unknown,
  allowed: ReadonlySet<T>,
  path: string,
): asserts value is T[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error(`${path} must be a non-empty array`);
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== 'string' || !allowed.has(entry as T)) throw new Error(`${path} contains an unknown value`);
    if (seen.has(entry)) throw new Error(`${path} contains a duplicate value`);
    seen.add(entry);
  }
}

function validateCompatibility(value: unknown): void {
  const compatibility = record(value, 'compatibility');
  if (compatibility.repository !== REPOSITORY) throw new Error('compatibility.repository is not the Shared Auth interfaces authority');
  const hasCommit = Object.hasOwn(compatibility, 'commit');
  const hasRange = Object.hasOwn(compatibility, 'range');
  if (hasCommit === hasRange) throw new Error('compatibility must select exactly one of commit or range');
  if (hasCommit) {
    closed(compatibility, ['repository', 'commit'], ['repository', 'commit'], 'compatibility');
    if (typeof compatibility.commit !== 'string' || !SHA.test(compatibility.commit)) throw new Error('compatibility.commit is not a lowercase 40-character Git SHA');
    return;
  }
  closed(compatibility, ['repository', 'range'], ['repository', 'range'], 'compatibility');
  const range = record(compatibility.range, 'compatibility.range');
  closed(range, ['base', 'head'], ['base', 'head'], 'compatibility.range');
  for (const key of ['base', 'head'] as const) {
    if (typeof range[key] !== 'string' || !SHA.test(range[key])) throw new Error(`compatibility.range.${key} is not a lowercase 40-character Git SHA`);
  }
}

function validateFactors(value: unknown): void {
  const factors = record(value, 'factors');
  closed(factors, ['two_factor', 'three_factor'], [], 'factors');
  if (factors.two_factor !== undefined) {
    const policy = record(factors.two_factor, 'factors.two_factor');
    closed(policy, ['required', 'methods'], [], 'factors.two_factor');
    optionalBoolean(policy.required, 'factors.two_factor.required');
    if (policy.methods !== undefined) contractSet(policy.methods, FACTORS, 'factors.two_factor.methods');
  }
  if (factors.three_factor !== undefined) {
    const policy = record(factors.three_factor, 'factors.three_factor');
    closed(policy, ['enabled', 'methods'], [], 'factors.three_factor');
    optionalBoolean(policy.enabled, 'factors.three_factor.enabled');
    if (policy.methods !== undefined) contractSet(policy.methods, FACTORS, 'factors.three_factor.methods');
  }
}

function validatePages(value: unknown): void {
  const pages = record(value, 'pages');
  closed(pages, ['show'], [], 'pages');
  if (pages.show !== undefined) contractSet(pages.show, PAGES, 'pages.show');
}

function validateStyling(value: unknown): void {
  const styling = record(value, 'styling');
  closed(styling, ['theme', 'brand_name', 'accent_color'], [], 'styling');
  if (styling.theme !== undefined && (typeof styling.theme !== 'string' || !THEMES.has(styling.theme as Theme))) {
    throw new Error('styling.theme is not a supported theme');
  }
  if (styling.brand_name !== undefined) {
    if (typeof styling.brand_name !== 'string') throw new Error('styling.brand_name must be a string');
    const length = Array.from(styling.brand_name).length;
    if (length < 1 || length > 80) throw new Error('styling.brand_name is outside the contract bounds');
  }
  if (styling.accent_color !== undefined && (typeof styling.accent_color !== 'string' || !ACCENT.test(styling.accent_color))) {
    throw new Error('styling.accent_color is not a six-digit hexadecimal color');
  }
}

export function parseSharedAuthConfig(value: unknown): SharedAuthConfigFile {
  const root = record(value, 'config');
  closed(root, ['schema_version', 'compatibility', 'factors', 'pages', 'styling'], ['schema_version', 'compatibility'], 'config');
  if (root.schema_version !== 1) throw new Error('schema_version must equal 1');
  validateCompatibility(root.compatibility);
  if (root.factors !== undefined) validateFactors(root.factors);
  if (root.pages !== undefined) validatePages(root.pages);
  if (root.styling !== undefined) validateStyling(root.styling);
  return value as SharedAuthConfigFile;
}
