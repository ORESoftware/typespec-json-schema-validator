import "@typespec/json-schema";
using TypeSpec.JsonSchema;

@id("LegalClassification")
enum LegalClassification {
  internal: "internal",
  external: "external",
}

@id("LegalDocumentStatus")
enum LegalDocumentStatus {
  draft: "draft",
  approved: "approved",
  expired: "expired",
  superseded: "superseded",
}

@id("LegalDocument")
model LegalDocument {
  id: string;
  path: string;
  classification: LegalClassification;
  agreementType: string;
  sha256: string;
  status: LegalDocumentStatus;
  required: boolean;
  effectiveDate?: string;
  approvalRecord?: string;
}

@id("LegalRolloutManifest")
model LegalRolloutManifest {
  schema: string;
  repository: string;
  legalRoot: string;
  releaseApproved: boolean;
  documents: LegalDocument[];
}
