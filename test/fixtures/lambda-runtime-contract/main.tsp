import "@typespec/json-schema";
using TypeSpec.JsonSchema;

namespace Ores.LambdaRuntimeFixture;

@id("Provider")
enum Provider {
  awsLambda: "aws-lambda",
  gcpCloudRun: "gcp-cloud-run",
  azureFunctions: "azure-functions",
  vercel: "vercel",
  cloudflareWorkers: "cloudflare-workers",
  scintilla: "scintilla",
  local: "local",
}

@id("Operation")
enum Operation {
  health: "health",
  version: "version",
  echo: "echo",
}

@id("LambdaCommand")
model LambdaCommand {
  schemaVersion: "ores.lambda-command/v1";
  provider: Provider;
  operation: Operation;
  requestId: string;
}
