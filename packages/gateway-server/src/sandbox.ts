import { getProfile } from "./profiles.js";

export interface SandboxConfig {
  enabled: boolean;
  timeout_seconds: number;
}

/** 프로필 기반 샌드박스 설정 생성 */
export function buildSandboxConfig(
  profileName: string,
): SandboxConfig {
  const profile = getProfile(profileName);

  if (!profile || !profile.sandbox) {
    return { enabled: false, timeout_seconds: 0 };
  }

  return {
    enabled: true,
    timeout_seconds: profile.timeout,
  };
}
