import { getProfile } from "./profiles.js";

export interface SandboxConfig {
  enabled: boolean;
  memory_limit: string;
  cpu_limit: string;
  timeout_seconds: number;
  network: "none" | "bridge" | "internal" | "host";
  readonly_mounts: string[];
  writable_mounts: string[];
}

/** 프로필 기반 샌드박스 설정 생성 */
export function buildSandboxConfig(
  profileName: string,
  projectDir?: string,
): SandboxConfig {
  const profile = getProfile(profileName);

  // admin이거나 sandbox 비활성 프로필 → 직접 실행
  if (!profile || !profile.sandbox) {
    return {
      enabled: false,
      memory_limit: "0",
      cpu_limit: "0",
      timeout_seconds: 0,
      network: "host",
      readonly_mounts: [],
      writable_mounts: [],
    };
  }

  // 프로필 허용 디렉토리 → Docker 마운트로 변환
  const readonlyMounts: string[] = [];
  const writableMounts: string[] = [];

  for (const dir of profile.directories) {
    if (dir === "*" && projectDir) {
      readonlyMounts.push(projectDir);
    } else if (dir !== "*") {
      const fullPath = projectDir ? `${projectDir}/${dir}` : dir;
      if (profile.permissions.write) {
        writableMounts.push(fullPath);
      } else {
        readonlyMounts.push(fullPath);
      }
    }
  }

  return {
    enabled: true,
    memory_limit: "512m",
    cpu_limit: "1",
    timeout_seconds: profile.max_timeout_seconds,
    network: "bridge",
    readonly_mounts: readonlyMounts,
    writable_mounts: writableMounts,
  };
}

/** Docker run 명령 생성 */
export function buildDockerCommand(
  config: SandboxConfig,
  command: string,
): string[] {
  if (!config.enabled) return ["sh", "-c", command];

  const args = [
    "docker", "run", "--rm",
    "--memory", config.memory_limit,
    "--cpus", config.cpu_limit,
    "--pids-limit", "100",
  ];

  // 네트워크 설정
  switch (config.network) {
    case "none":
      args.push("--network", "none");
      break;
    case "bridge":
      args.push("--network", "bridge");
      break;
    case "internal":
      args.push("--network", "jarvis-sandbox-net");
      break;
    // host는 Docker 기본값
  }

  for (const mount of config.readonly_mounts) {
    args.push("-v", `${mount}:/workspace/${mount.split("/").pop()}:ro`);
  }
  for (const mount of config.writable_mounts) {
    args.push("-v", `${mount}:/workspace/${mount.split("/").pop()}:rw`);
  }

  args.push("jarvis-sandbox:latest");
  args.push(String(config.timeout_seconds), "sh", "-c", command);

  return args;
}
