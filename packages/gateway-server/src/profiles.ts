import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const PROFILES_FILE = join(
  process.env.HOME ?? "~",
  "jarvis",
  "config",
  "profiles.jsonc",
);

export interface ProfilePermissions {
  read: boolean;
  write: boolean;
  execute: boolean;
  git: boolean | "read-only";
  docker: boolean;
  cron: boolean;
  settings: boolean;
}

export interface Profile {
  description: string;
  permissions: ProfilePermissions;
  sandbox: boolean;
  directories: string[];
  allowed_commands: string[];
  max_timeout_seconds: number;
}

/** JSONC 파싱 (주석 제거) */
function parseJsonc(content: string): unknown {
  const stripped = content
    .replace(/\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
  return JSON.parse(stripped);
}

/** 프로필 설정 로드 */
export function loadProfiles(): Record<string, Profile> {
  if (!existsSync(PROFILES_FILE)) {
    return getDefaultProfiles();
  }

  try {
    const content = readFileSync(PROFILES_FILE, "utf-8");
    const config = parseJsonc(content) as { profiles: Record<string, Profile> };
    return config.profiles;
  } catch {
    return getDefaultProfiles();
  }
}

/** 특정 프로필 조회 */
export function getProfile(profileName: string): Profile | null {
  const profiles = loadProfiles();
  return profiles[profileName] ?? null;
}

/** 프로필 목록 */
export function listProfiles(): Array<{ name: string; description: string }> {
  const profiles = loadProfiles();
  return Object.entries(profiles).map(([name, profile]) => ({
    name,
    description: profile.description,
  }));
}

/** 권한 체크: 특정 작업이 허용되는지 */
export function checkPermission(
  profileName: string,
  action: keyof ProfilePermissions,
): boolean {
  const profile = getProfile(profileName);
  if (!profile) return false;

  const value = profile.permissions[action];
  if (typeof value === "boolean") return value;
  // "read-only" 같은 경우 제한적 허용
  return value !== false;
}

/** 디렉토리 접근 체크 */
export function checkDirectoryAccess(
  profileName: string,
  targetPath: string,
): boolean {
  const profile = getProfile(profileName);
  if (!profile) return false;
  if (profile.directories.includes("*")) return true;

  return profile.directories.some((dir) => targetPath.startsWith(dir));
}

/** 명령 실행 체크 */
export function checkCommandAccess(
  profileName: string,
  command: string,
): boolean {
  const profile = getProfile(profileName);
  if (!profile) return false;
  if (!profile.permissions.execute) return false;
  if (profile.allowed_commands.includes("*")) return true;

  return profile.allowed_commands.some((allowed) =>
    command.startsWith(allowed),
  );
}

function getDefaultProfiles(): Record<string, Profile> {
  return {
    admin: {
      description: "전체 관리자",
      permissions: {
        read: true, write: true, execute: true,
        git: true, docker: true, cron: true, settings: true,
      },
      sandbox: false,
      directories: ["*"],
      allowed_commands: ["*"],
      max_timeout_seconds: 600,
    },
    observer: {
      description: "옵저버 — 질문/검색만",
      permissions: {
        read: true, write: false, execute: false,
        git: false, docker: false, cron: true, settings: false,
      },
      sandbox: true,
      directories: ["docs/", "README.md"],
      allowed_commands: [],
      max_timeout_seconds: 60,
    },
  };
}
