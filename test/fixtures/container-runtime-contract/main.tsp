import "@typespec/json-schema";
using TypeSpec.JsonSchema;

namespace Ores.ContainerRuntime;

@id("RuntimeBaseKind")
enum RuntimeBaseKind {
  shell: "shell",
  distroless: "distroless",
  scratch: "scratch",
}

@id("EntrypointMode")
enum EntrypointMode {
  execWrapper: "exec_wrapper",
  directBinary: "direct_binary",
}

@id("ContainerPlatform")
enum ContainerPlatform {
  linuxAmd64: "linux/amd64",
  linuxArm64: "linux/arm64",
}

@id("ContainerRuntimeContract")
model ContainerRuntimeContract {
  schemaVersion: "ores.container-runtime-contract/v1";
  serviceName: string;
  runtimeBase: RuntimeBaseKind;
  entrypointMode: EntrypointMode;
  entrypoint: string[];
  cmd: string[];
  platforms: ContainerPlatform[];
  runsAsNonRoot: boolean;
  preservesPid1: boolean;
}
