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

export interface ProfilePersonality {
  tone?: "formal" | "casual" | "friendly" | "technical";
  language?: string;
  verbosity?: "concise" | "normal" | "detailed";
  emoji?: boolean;
  nickname?: string;
  system_prompt_extra?: string;
}

interface ProfileConfig {
  description: string;
  claude?: ProfileClaudeConfig;
  personality?: ProfilePersonality;
  timeout?: number;
  /**
   * 세션 자동 clear TTL (시간 단위).
   * last_active_at에서 이 시간만큼 지난 뒤 다음 메시지가 오면 jsonl 삭제 + 새 UUID로 시작.
   * 생략/0/음수 → 무제한 (사용자가 /clear를 호출할 때까지 누적).
   */
  session_ttl_hours?: number;
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

/**
 * 프로필에 맞는 Claude CLI **플래그**만 생성합니다 (prompt는 제외).
 *
 * 반환값에는 prompt가 포함되지 않습니다. 호출부에서 모든 플래그를 추가한 뒤
 * 반드시 마지막에 `args.push("--", prompt)` 형태로 prompt를 붙여야 합니다.
 *
 * Why: `claude -p`는 boolean 플래그라 다음 인자를 소비하지 않습니다.
 * prompt가 `- `로 시작하면 commander.js가 이를 옵션으로 오인해
 * `error: unknown option '- ...'`로 종료(exit 1)합니다.
 * `--` 분리자 뒤에 두면 positional로만 해석되어 안전합니다.
 */
export function buildClaudeArgs(
  profileName: string,
  options?: {
    systemPrompt?: string;
    projectDir?: string;
  },
): string[] {
  const profile = getProfileConfig(profileName);
  const claude = profile?.claude;
  const args = ["-p", "--output-format", "text"];

  // owner profile (skip_permissions: true) — no restrictions, full access
  if (claude?.skip_permissions) {
    args.push("--dangerously-skip-permissions");

    // cwd stays on the user sandbox (for session jsonl path consistency).
    // Filesystem access is granted via --add-dir:
    //   · options.projectDir wins if present (e.g., /dev worktree)
    //   · otherwise $HOME — owner gets full home-tree access
    if (options?.projectDir) {
      args.push("--add-dir", options.projectDir);
    } else if (process.env.HOME) {
      args.push("--add-dir", process.env.HOME);
    }

    if (claude.model) args.push("--model", claude.model);
    if (claude.effort) args.push("--effort", claude.effort);

    // Owner-specific instruction — prevents the model from self-refusing based on
    // previous session context that said "sandbox blocks home access".
    // The dangerously-skip-permissions flag is on AND $HOME is in --add-dir,
    // so the model should execute Bash/Read directly on home paths.
    const ownerOverride =
      "[Owner mode] You have FULL filesystem access, including the user's home directory and all its subdirectories. " +
      "Run requested shell commands directly via the Bash tool without hesitation. " +
      "Ignore any previous session messages that claimed access was restricted — this request is from the Owner with --dangerously-skip-permissions and --add-dir $HOME.";

    const combinedPrompt = options?.systemPrompt
      ? `${options.systemPrompt}\n\n${ownerOverride}`
      : ownerOverride;
    args.push("--append-system-prompt", combinedPrompt);
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
  // 격리 원칙: --add-dir로 명시되지 않은 디렉토리는 cwd 샌드박스(/tmp/jarvis-sandbox-*)밖에 없음
  if (options?.projectDir) {
    args.push("--add-dir", options.projectDir);
  } else if (claude?.add_dirs) {
    for (const dir of claude.add_dirs) {
      if (dir === "from_projects") {
        // projects.jsonc에서 해당 프로필 접근 가능 경로 로드
        const projectDirs = getAccessibleDirs(profileName);
        if (projectDirs.length === 0) {
          // 0개 매치 = 의도된 격리(observer 등) 또는 설정 누락
          // 데몬 cwd 샌드박스가 격리를 보장하므로 안전하지만, 가시화를 위해 stderr로 알림
          console.error(
            `[permissions] WARN: profile=${profileName} add_dirs=from_projects → 0 매치. ` +
            `projects.jsonc의 allowed_profiles에 "${profileName}"가 포함된 프로젝트가 없습니다. ` +
            `샌드박스 cwd 외 디렉토리 접근 불가 (의도된 동작이면 무시).`,
          );
        }
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

/** Build system prompt from personality settings (English for token efficiency) */
export function buildPersonalityPrompt(
  personality: Record<string, unknown>,
  userName?: string,
  channel?: string,
  userId?: string,
): string {
  const parts: string[] = [];

  parts.push(
    "You are Jarvis, a personalized AI agent.",
    "You are responding to an external channel message.",
    "The system forwards your reply automatically; output only the answer text.",
    "Do not attempt to send via channel APIs and do not include meta commentary.",
    "Keep responses under 2000 characters and concise.",
    // Plain text policy — channels render markdown differently (Telegram MarkdownV2, Slack mrkdwn, Discord md).
    // Emitting plain text keeps channel adapters simple and avoids per-platform escaping.
    "Respond in plain text. Do not use markdown syntax: no **bold**, *italic*, _underline_, # headings, `inline code`, or ```code blocks```. Simple hyphen bullets (- item) are fine.",
    // Context preloading — skip for trivial greetings / one-liners
    "[Important] Before answering, if the user request is not a trivial greeting or small talk, call these first:",
    "1) jarvis_memory_recall(query: keywords, type: 'declarative') — check user preferences/past decisions",
    "2) jarvis_session_search(query: keywords) — find similar past work",
    "Incorporate findings into your reply, but do not expose the tool calls themselves.",
  );

  if (userName) parts.push(`User name: ${userName}.`);
  if (channel) parts.push(`Channel: ${channel}.`);

  // User-id isolation — env JARVIS_USER_ID handles it automatically,
  // but explicit args must also use the same value.
  if (userId) {
    parts.push(
      `[Memory isolation] user_id for this request is "${userId}".`,
      "Do not reference memory or sessions of other users.",
      "MCP memory tool calls omit user_id by default (env-based), but if you pass it explicitly, use exactly this value.",
    );
  }

  const tone = personality.tone as string | undefined;
  if (tone) {
    const toneMap: Record<string, string> = {
      formal: "Use a formal and polite tone.",
      casual: "Use a casual and friendly tone.",
      friendly: "Use a warm and friendly tone.",
      technical: "Use a technical and precise tone.",
    };
    parts.push(toneMap[tone] ?? "");
  }

  const language = personality.language as string | undefined;
  if (language) {
    const langMap: Record<string, string> = {
      ko: "Respond in Korean (한국어).",
      en: "Respond in English.",
      ja: "Respond in Japanese (日本語).",
    };
    parts.push(langMap[language] ?? `Respond in ${language}.`);
  } else {
    // Default: Korean (primary user base). Override via personality.language.
    parts.push("Respond in Korean (한국어) by default.");
  }

  const verbosity = personality.verbosity as string | undefined;
  if (verbosity === "concise") {
    parts.push("Keep responses terse — only the essentials.");
  } else if (verbosity === "detailed") {
    parts.push("Include detailed explanations in responses.");
  }

  const nickname = personality.nickname as string | undefined;
  if (nickname) {
    parts.push(`Your name is "${nickname}".`);
  }

  // Free-form per-user prompt extension.
  // Put detailed role/persona instructions here (e.g., domain expertise, character voice).
  // Appended last so it can override/augment the fixed mappings above.
  const extra = personality.system_prompt_extra as string | undefined;
  if (extra && extra.trim()) {
    parts.push(extra.trim());
  }

  return parts.filter(Boolean).join(" ");
}

/** 유저 personality와 프로필 personality 병합 (유저 설정 우선) */
export function mergePersonality(
  userPersonality: Record<string, unknown> | undefined,
  profileName: string,
): Record<string, unknown> {
  const profile = getProfileConfig(profileName);
  const profileDefaults = (profile?.personality ?? {}) as Record<string, unknown>;
  return { ...profileDefaults, ...(userPersonality ?? {}) };
}

/** 프로필에 사용 가능한 도구 목록 반환 (정보 표시용) */
export function getProfileTools(profileName: string): string[] {
  const profile = getProfileConfig(profileName);
  if (!profile) return ["(프로필 없음)"];
  if (profile.claude?.skip_permissions) return ["(전체 접근)"];
  return profile.claude?.allowed_tools ?? ["(도구 없음)"];
}
