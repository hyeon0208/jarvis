import {
  getProfileConfig,
  getDefaultProfile,
  listProfileConfigs,
} from "./permissions.js";

/**
 * 프로필 관리 — profiles.yml에서 읽습니다.
 * permissions.ts가 YAML 파싱을 담당하고, 이 모듈은 래퍼를 제공합니다.
 */

export interface Profile {
  description: string;
  permissions: {
    read: boolean;
    write: boolean;
    execute: boolean;
    cron: boolean;
  };
  sandbox: boolean;
  timeout: number;
}

/** 프로필 조회 (YAML에서) */
export function getProfile(profileName: string): Profile | null {
  const config = getProfileConfig(profileName);
  if (!config) return null;

  const claude = config.claude;
  const allowedTools = claude?.allowed_tools ?? [];

  return {
    description: config.description,
    permissions: {
      read: allowedTools.includes("Read") || !!claude?.skip_permissions,
      write: allowedTools.includes("Write") || !!claude?.skip_permissions,
      execute: allowedTools.some((t) => t.startsWith("Bash(")) || !!claude?.skip_permissions,
      cron: allowedTools.some((t) => t.includes("cron")) || !!claude?.skip_permissions,
    },
    sandbox: !claude?.skip_permissions,
    timeout: config.timeout ?? 300,
  };
}

/** 권한 체크 */
export function checkPermission(
  profileName: string,
  action: keyof Profile["permissions"],
): boolean {
  const profile = getProfile(profileName);
  if (!profile) return false;
  return profile.permissions[action];
}

/** 프로필 목록 */
export function listProfiles(): Array<{ name: string; description: string }> {
  return listProfileConfigs();
}

export { getDefaultProfile };
