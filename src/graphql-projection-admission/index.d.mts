export type GraphqlProjectionKind = "query" | "mutation" | "subscription";
export type GraphqlProjectionStream = "unary" | "server_stream";

export interface GraphqlProjectionOperation {
  operation_key: string;
  operation: string;
  kind: GraphqlProjectionKind;
  field: string;
  stream: GraphqlProjectionStream;
  graphql_source: string;
  handlers_source: string;
}

export interface GraphqlProjectionManifest {
  schema_version: 1;
  generated_by: "ores-stack";
  endpoint: "/v1/graphql";
  authority: "graphql.rs";
  operations: GraphqlProjectionOperation[];
}

export interface GraphqlProjectionVerification {
  ok: boolean;
  findings: string[];
  canonical: GraphqlProjectionManifest | null;
}

export const GRAPHQL_PROJECTION_SCHEMA_VERSION: 1;
export const GRAPHQL_V1_ENDPOINT: "/v1/graphql";
export const GRAPHQL_PROJECTION_AUTHORITY: "graphql.rs";
export const GRAPHQL_PROJECTION_GENERATOR: "ores-stack";

export function verifyGraphqlProjectionManifest(value: unknown): GraphqlProjectionVerification;
export function assertGraphqlProjectionManifest(value: unknown): GraphqlProjectionManifest;
export function canonicalGraphqlProjectionJson(value: unknown): string;
