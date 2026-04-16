import { getProfile } from "./profiles.js";

/**
 * 프로필 → Claude CLI --allowedTools 매핑
 *
 * 각 프로필의 권한을 Claude Code의 allowedTools 형식으로 변환합니다.
 * 이를 통해 외부 채널 요청 시 프로필 범위 내에서 자동 승인됩니다.
 */

const READ_ONLY_TOOLS = [
  "Read",
  "Glob",
  "Grep",
  "WebSearch",
  "WebFetch",
  // Jarvis MCP (읽기)
  "mcp__jarvis-memory__jarvis_memory_recall",
  "mcp__jarvis-memory__jarvis_memory_list",
  "mcp__jarvis-memory__jarvis_session_search",
  "mcp__jarvis-memory__jarvis_memory_stats",
];

const GIT_READ_TOOLS = [
  "Bash(git status:*)",
  "Bash(git log:*)",
  "Bash(git diff:*)",
  "Bash(git show:*)",
  "Bash(git branch:*)",
  "Bash(git blame:*)",
];

const GIT_WRITE_TOOLS = [
  "Bash(git add:*)",
  "Bash(git commit:*)",
  "Bash(git push:*)",
  "Bash(git checkout:*)",
  "Bash(git switch:*)",
  "Bash(git stash:*)",
  "Bash(git merge:*)",
  "Bash(git pull:*)",
  "Bash(git fetch:*)",
  "Bash(git branch:*)",
  "Bash(gh pr:*)",
];

const WRITE_TOOLS = ["Edit", "Write"];

const EXECUTE_TOOLS = [
  "Bash(bun test:*)",
  "Bash(bun run build:*)",
  "Bash(npm test:*)",
  "Bash(npm run build:*)",
  "Bash(gradle test:*)",
  "Bash(gradle build:*)",
  "Bash(./gradlew test:*)",
  "Bash(./gradlew build:*)",
];

const MEMORY_WRITE_TOOLS = [
  "mcp__jarvis-memory__jarvis_memory_save",
  "mcp__jarvis-memory__jarvis_session_save",
];

const CRON_TOOLS = [
  "mcp__jarvis-gateway__jarvis_cron_manage",
];

/** 프로필별 허용 도구 목록 */
const PROFILE_TOOLS: Record<string, string[]> = {
  admin: [], // 빈 배열 = 제한 없음 (--dangerously-skip-permissions 사용)

  developer: [
    ...READ_ONLY_TOOLS,
    ...GIT_READ_TOOLS,
    ...GIT_WRITE_TOOLS,
    ...WRITE_TOOLS,
    ...EXECUTE_TOOLS,
    ...MEMORY_WRITE_TOOLS,
    ...CRON_TOOLS,
  ],

  reviewer: [
    ...READ_ONLY_TOOLS,
    ...GIT_READ_TOOLS,
    ...CRON_TOOLS,
  ],

  observer: [
    ...READ_ONLY_TOOLS,
    ...CRON_TOOLS,
  ],
};

/** 프로필에 맞는 Claude CLI 인자 생성 */
export function buildClaudeArgs(
  profileName: string,
  prompt: string,
  options?: {
    model?: string;
    systemPrompt?: string;
    maxBudget?: number;
    projectDir?: string;
  },
): string[] {
  const args = ["-p", prompt];

  // 모델
  if (options?.model) {
    args.push("--model", options.model);
  }

  // 출력 형식
  args.push("--output-format", "text");

  // 프로필별 권한
  if (profileName === "admin") {
    args.push("--dangerously-skip-permissions");
  } else {
    const tools = PROFILE_TOOLS[profileName] ?? PROFILE_TOOLS.observer;
    if (tools.length > 0) {
      args.push("--allowedTools", tools.join(","));
    }
  }

  // 시스템 프롬프트 (개인화 반영)
  if (options?.systemPrompt) {
    args.push("--append-system-prompt", options.systemPrompt);
  }

  // 비용 제한
  if (options?.maxBudget) {
    args.push("--max-budget-usd", String(options.maxBudget));
  }

  // 프로젝트 디렉토리
  if (options?.projectDir) {
    args.push("--add-dir", options.projectDir);
  }

  return args;
}

/** 개인화 설정을 시스템 프롬프트로 변환 */
export function buildPersonalityPrompt(
  personality: Record<string, unknown>,
  userName?: string,
  channel?: string,
): string {
  const parts: string[] = [];

  // 채널 컨텍스트 — Claude가 직접 채널로 보내려 하지 않도록
  parts.push(
    "당신은 Jarvis, 개인화된 AI 에이전트입니다.",
    "지금 외부 채널 메시지에 대한 응답을 생성하고 있습니다.",
    "응답 전송은 시스템이 자동으로 처리하므로, 당신은 답변 내용만 작성하세요.",
    "MCP 도구 호출, 채널 전송 시도, 메타 설명은 하지 마세요.",
    "순수한 답변 텍스트만 출력하세요.",
    "응답은 2000자 이내로 간결하게 작성하세요.",
    "Git 규칙: 새 브랜치 생성 시 반드시 dev 또는 main 브랜치에서 git pull을 먼저 실행한 후 브랜치를 생성하세요. git push --force, git reset --hard는 절대 사용하지 마세요.",
  );

  if (userName) {
    parts.push(`사용자 이름: ${userName}`);
  }

  if (channel) {
    parts.push(`채널: ${channel}`);
  }

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
  if (profileName === "admin") return ["(전체 접근)"];
  return PROFILE_TOOLS[profileName] ?? PROFILE_TOOLS.observer;
}
