import type {
  LanguageBoundaryEvidence,
  LanguageBoundaryManifest,
  LanguageBoundaryVerification,
} from './language-boundary-verification.mjs';

export interface LanguageBoundaryCurrentInputs {
  typespec: string;
  generatedSchema: string;
  authoredSchema: string;
  report: Record<string, unknown>;
  contractIr: Record<string, unknown>;
  manifest: LanguageBoundaryManifest;
  evidenceByPath: Map<string, LanguageBoundaryEvidence> | Record<string, LanguageBoundaryEvidence>;
}

export function verifyLanguageBoundariesAgainstCurrentInputs(
  input: LanguageBoundaryCurrentInputs,
): Promise<LanguageBoundaryVerification>;
