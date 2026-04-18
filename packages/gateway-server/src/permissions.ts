import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { loadProjects } from "./workflow.js";

/**
 * 프로필별 Claude CLI 인자를 config/profiles.yml에서 읽어 생성합니다.
 *
 * YAML 설정으로 관리하므로 코드 수정 없이 프로필을 추가/변경할 수 있습니다.
 */

const PROFILES_YML = join(
  process.env.HOME ?? "~",
  "jarvis",
  "config",
  "profiles.yml",
);

// --- 타입 ---

interface ProfileClaudeConfig {
  allowed_tools?: string[];
  disallowed_tools?: string[];
  add_dirs?: string[];
  system_prompt?: string;
  model?: string;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  skip_permissions?: boolean;
}

interface ProfileConfig {
  description: string;
  claude?: ProfileClaudeConfig;
  timeout?: number;
}

interface ProfilesYml {
  default_profile: string;
  profiles: Record<string, ProfileConfig>;
}

// --- 캐시 ---

let cachedConfig: ProfilesYml | null = null;
let cachedMtime = 0;

/** YAML 설정 로드 (파일 변경 시 자동 리로드) */
function loadProfilesYml(): ProfilesYml {
  if (!existsSync(PROFILES_YML)) {
    return { default_profile: "observer", profiles: {} };
  }

  const stat = Bun.file(PROFILES_YML);
  const mtime = stat.lastModified;

  if (cachedConfig && mtime === cachedMtime) {
    return cachedConfig;
  }

  const content = readFileSync(PROFILES_YML, "utf-8");
  cachedConfig = parseYaml(content) as ProfilesYml;
  cachedMtime = mtime;
  return cachedConfig;
}

/** 프로필 설정 조회 */
export function getProfileConfig(profileName: string): ProfileConfig | null {
  const config = loadProfilesYml();
  return config.profiles[profileName] ?? null;
}

/** 기본 프로필 이름 */
export function getDefaultProfile(): string {
  return loadProfilesYml().default_profile;
}

/** 프로필 목록 */
export function listProfileConfigs(): Array<{ name: string; description: string }> {
  const config = loadProfilesYml();
  return Object.entries(config.profiles).map(([name, p]) => ({
    name,
    description: p.description,
  }));
}

/** 프로필에 맞는 Claude CLI 인자 생성 */
export function buildClaudeArgs(
  profileName: string,
  prompt: string,
  options?: {
    systemPrompt?: string;
    projectDir?: string;
  },
): string[] {
  const profile = getProfileConfig(profileName);
  const claude = profile?.claude;
  const args = ["-p", prompt, "--output-format", "text"];

  // admin (skip_permissions)
  if (claude?.skip_permissions) {
    args.push("--dangerously-skip-permissions");

    if (claude.model) args.push("--model", claude.model);
    if (claude.effort) args.push("--effort", claude.effort);

    if (options?.systemPrompt) {
      args.push("--append-system-prompt", options.systemPrompt);
    }
    return args;
  }

  // 허용 도구
  if (claude?.allowed_tools && claude.allowed_tools.length > 0) {
    args.push("--allowedTools", claude.allowed_tools.join(","));
  }

  // 차단 도구
  if (claude?.disallowed_tools && claude.disallowed_tools.length > 0) {
    args.push("--disallowedTools", claude.disallowed_tools.join(","));
  }

  // 디렉토리 제한
  if (options?.projectDir) {
    args.push("--add-dir", options.projectDir);
  } else if (claude?.add_dirs) {
    for (const dir of claude.add_dirs) {
      if (dir === "from_projects") {
        // projects.jsonc에서 해당 프로필 접근 가능 경로 로드
        const projectDirs = getAccessibleDirs(profileName);
        for (const d of projectDirs) {
          args.push("--add-dir", d);
        }
      } else {
        args.push("--add-dir", dir);
      }
    }
  }

  // 모델
  if (claude?.model) {
    args.push("--model", claude.model);
  }

  // Effort (low/medium/high/max)
  if (claude?.effort) {
    args.push("--effort", claude.effort);
  }

  // 시스템 프롬프트 (YAML 설정 + 런타임 추가)
  const prompts: string[] = [];
  if (claude?.system_prompt) {
    prompts.push(claude.system_prompt.trim());
  }
  if (options?.systemPrompt) {
    prompts.push(options.systemPrompt);
  }
  if (prompts.length > 0) {
    args.push("--append-system-prompt", prompts.join(" "));
  }

  return args;
}

/** 프로필이 접근 가능한 디렉토리 목록 */
function getAccessibleDirs(profileName: string): string[] {
  const projects = loadProjects();
  const dirs: string[] = [];

  for (const config of Object.values(projects)) {
    if (config.allowed_profiles.includes(profileName)) {
      dirs.push(config.path);
    }
  }

  return dirs;
}

/** 개인화 설정을 시스템 프롬프트로 변환 */
export function buildPersonalityPrompt(
  personality: Record<string, unknown>,
  userName?: string,
  channel?: string,
): string {
  const parts: string[] = [];

  parts.push(
    "당신은 Jarvis, 개인화된 AI 에이전트입니다.",
    "지금 외부 채널 메시지에 대한 응답을 생성하고 있습니다.",
    "응답 전송은 시스템이 자동으로 처리하므로, 당신은 답변 내용만 작성하세요.",
    "MCP 도구 호출, 채널 전송 시도, 메타 설명은 하지 마세요.",
    "순수한 답변 텍스트만 출력하세요.",
    "응답은 2000자 이내로 간결하게 작성하세요.",
  );

  if (userName) parts.push(`사용자 이름: ${userName}`);
  if (channel) parts.push(`채널: ${channel}`);

  const tone = personality.tone as string | undefined;
  if (tone) {
    const toneMap: Record<string, string> = {
      formal: "정중하고 격식 있는 톤으로 응답하세요.",
      casual: "편안하고 친근한 톤으로 응답하세요.",
      friendly: "밝고 친절한 톤으로 응답하세요.",
      technical: "기술적이고 정확한 톤으로 응답하세요.",
    };
    parts.push(toneMap[tone] ?? "");
  }

  const language = personality.language as string | undefined;
  if (language) {
    const langMap: Record<string, string> = {
      ko: "한국어로 응답하세요.",
      en: "Respond in English.",
      ja: "日本語で応答してください。",
    };
    parts.push(langMap[language] ?? `${language}로 응답하세요.`);
  }

  const verbosity = personality.verbosity as string | undefined;
  if (verbosity === "concise") {
    parts.push("응답은 간결하게 핵심만 전달하세요.");
  } else if (verbosity === "detailed") {
    parts.push("응답은 상세하게 설명을 포함하세요.");
  }

  const nickname = personality.nickname as string | undefined;
  if (nickname) {
    parts.push(`당신의 이름은 "${nickname}"입니다.`);
  }

  return parts.filter(Boolean).join(" ");
}

/** 프로필에 사용 가능한 도구 목록 반환 (정보 표시용) */
export function getProfileTools(profileName: string): string[] {
  const profile = getProfileConfig(profileName);
  if (!profile) return ["(프로필 없음)"];
  if (profile.claude?.skip_permissions) return ["(전체 접근)"];
  return profile.claude?.allowed_tools ?? ["(도구 없음)"];
}
