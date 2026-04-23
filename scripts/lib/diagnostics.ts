/**
 * 진단 체크 함수 모음
 *
 * doctor.ts와 daemon.ts에서 공통으로 사용합니다.
 * 각 체크는 CheckResult를 반환하며, runAllChecks로 집계합니다.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  PATHS,
  loadProfilesYml,
  loadChannelsYml,
  loadProjectsJsonc,
  loadEnvFile,
  loadClaudeSettings,
  loadMemoryYml,
  listAllUsers,
} from "./config.js";

export type Severity = "OK" | "WARN" | "FAIL";

export interface CheckResult {
  name: string;
  severity: Severity;
  message: string;
  hint?: string;
}

export interface DiagnosticsOptions {
  skipNetwork?: boolean;
  failFast?: boolean;
}

export interface DiagnosticsSummary {
  results: CheckResult[];
  hasFail: boolean;
  hasWarn: boolean;
}

// ============================================================
// 개별 체크
// ============================================================

function checkDirectories(): CheckResult[] {
  const required = [
    { path: join(process.env.HOME ?? "~", ".jarvis", "data"), name: "데이터 디렉토리" },
    { path: join(process.env.HOME ?? "~", ".jarvis", "users"), name: "유저 디렉토리" },
    { path: join(process.env.HOME ?? "~", "jarvis", "config"), name: "설정 디렉토리" },
  ];

  return required.map((r) => ({
    name: r.name,
    severity: existsSync(r.path) ? "OK" : "FAIL",
    message: r.path,
    hint: existsSync(r.path) ? undefined : `mkdir -p ${r.path}`,
  }));
}

function checkProfilesYml(): CheckResult {
  if (!existsSync(PATHS.profilesYml)) {
    return {
      name: "profiles.yml 파일",
      severity: "FAIL",
      message: "파일이 없습니다",
      hint: `기본 파일이 누락되었습니다: ${PATHS.profilesYml}`,
    };
  }
  try {
    const config = loadProfilesYml();
    const count = Object.keys(config.profiles ?? {}).length;
    if (count === 0) {
      return {
        name: "profiles.yml 파싱",
        severity: "WARN",
        message: "프로필이 하나도 정의되지 않았습니다",
        hint: "jarvis create-profile로 프로필을 생성하세요",
      };
    }
    return { name: "profiles.yml 파싱", severity: "OK", message: `${count}개 프로필` };
  } catch (err) {
    return {
      name: "profiles.yml 파싱",
      severity: "FAIL",
      message: `YAML 파싱 실패: ${(err as Error).message}`,
      hint: PATHS.profilesYml,
    };
  }
}

function checkChannelsYml(): CheckResult {
  if (!existsSync(PATHS.channelsYml)) {
    return {
      name: "channels.yml 파일",
      severity: "WARN",
      message: "파일이 없습니다 (채널 사용 시 필요)",
      hint: PATHS.channelsYml,
    };
  }
  try {
    const config = loadChannelsYml();
    const count = Object.keys(config.channels ?? {}).length;
    return { name: "channels.yml 파싱", severity: "OK", message: `${count}개 채널 정의됨` };
  } catch (err) {
    return {
      name: "channels.yml 파싱",
      severity: "FAIL",
      message: `YAML 파싱 실패: ${(err as Error).message}`,
    };
  }
}

function checkProjectsJsonc(): CheckResult {
  if (!existsSync(PATHS.projectsJsonc)) {
    return {
      name: "projects.jsonc 파일",
      severity: "WARN",
      message: "파일이 없습니다 (/dev 워크플로우 사용 시 필요)",
    };
  }
  try {
    const config = loadProjectsJsonc();
    const count = Object.keys(config.projects ?? {}).length;
    return { name: "projects.jsonc 파싱", severity: "OK", message: `${count}개 프로젝트` };
  } catch (err) {
    return {
      name: "projects.jsonc 파싱",
      severity: "FAIL",
      message: `JSON 파싱 실패: ${(err as Error).message}`,
    };
  }
}

/** 프로젝트의 path가 실제 존재하는지 + allowed_profiles 참조가 유효한지 */
function checkProjectsSchema(): CheckResult[] {
  if (!existsSync(PATHS.projectsJsonc)) return [];
  try {
    const config = loadProjectsJsonc();
    const profiles = existsSync(PATHS.profilesYml) ? loadProfilesYml().profiles : {};

    const results: CheckResult[] = [];
    for (const [key, project] of Object.entries(config.projects ?? {})) {
      if (!existsSync(project.path)) {
        results.push({
          name: `project[${key}].path`,
          severity: "FAIL",
          message: `디렉토리 없음: ${project.path}`,
          hint: `경로를 수정하거나 git clone 하세요`,
        });
      }
      for (const profileName of project.allowed_profiles ?? []) {
        if (!profiles[profileName]) {
          results.push({
            name: `project[${key}].allowed_profiles`,
            severity: "FAIL",
            message: `존재하지 않는 프로필 참조: ${profileName}`,
            hint: `profiles.yml에 ${profileName} 프로필을 추가하세요`,
          });
        }
      }
    }

    if (results.length === 0) {
      return [{ name: "projects 스키마", severity: "OK", message: "모든 참조 유효" }];
    }
    return results;
  } catch {
    return [];
  }
}

/** enabled 채널의 token_env가 .env에 있는지 */
function checkChannelTokens(): CheckResult[] {
  if (!existsSync(PATHS.channelsYml)) return [];
  try {
    const config = loadChannelsYml();
    const env = loadEnvFile();

    const results: CheckResult[] = [];
    const tokenKeys = ["token_env", "bot_token_env", "app_token_env", "auth_token_env"];

    for (const [name, cfg] of Object.entries(config.channels ?? {})) {
      if (!cfg.enabled) continue;
      for (const key of tokenKeys) {
        const envKey = cfg[key] as string | undefined;
        if (!envKey) continue;
        if (!env[envKey]) {
          results.push({
            name: `channel[${name}].${key}`,
            severity: "FAIL",
            message: `.env에 ${envKey} 누락`,
            hint: `jarvis channel token ${name} <값>`,
          });
        }
      }
    }

    if (results.length === 0) {
      return [{ name: "채널 토큰", severity: "OK", message: "활성 채널 토큰 모두 있음" }];
    }
    return results;
  } catch {
    return [];
  }
}

async function checkTokensLive(): Promise<CheckResult[]> {
  const env = loadEnvFile();
  const results: CheckResult[] = [];

  // Telegram — getMe
  const telegramToken = env.TELEGRAM_BOT_TOKEN;
  if (telegramToken) {
    try {
      const res = await fetch(`https://api.telegram.org/bot${telegramToken}/getMe`);
      const data = (await res.json()) as { ok: boolean; result?: { username: string } };
      if (data.ok && data.result) {
        results.push({
          name: "Telegram 토큰",
          severity: "OK",
          message: `@${data.result.username}`,
        });
      } else {
        results.push({
          name: "Telegram 토큰",
          severity: "FAIL",
          message: "인증 실패",
          hint: "토큰이 잘못되었거나 revoke 되었습니다",
        });
      }
    } catch {
      results.push({
        name: "Telegram 토큰",
        severity: "WARN",
        message: "네트워크 오류로 검증 불가",
      });
    }
  }

  // Slack — auth.test (Bot Token + App Token)
  const slackBotToken = env.SLACK_BOT_TOKEN;
  if (slackBotToken) {
    try {
      const res = await fetch("https://slack.com/api/auth.test", {
        method: "POST",
        headers: { Authorization: `Bearer ${slackBotToken}` },
      });
      const data = (await res.json()) as {
        ok: boolean;
        team?: string;
        user?: string;
        error?: string;
      };
      if (data.ok) {
        results.push({
          name: "Slack Bot 토큰",
          severity: "OK",
          message: `${data.team ?? "?"} / ${data.user ?? "?"}`,
        });
      } else {
        results.push({
          name: "Slack Bot 토큰",
          severity: "FAIL",
          message: `인증 실패: ${data.error ?? "unknown"}`,
          hint: "xoxb-... 토큰 재발급 또는 OAuth Scope 점검 (chat:write, im:history 등)",
        });
      }
    } catch {
      results.push({
        name: "Slack Bot 토큰",
        severity: "WARN",
        message: "네트워크 오류로 검증 불가",
      });
    }

    // App Token은 별도 API 검증이 까다로워 (Socket Mode 연결 시도가 필요)
    // 존재 여부만 빠르게 확인
    if (!env.SLACK_APP_TOKEN) {
      results.push({
        name: "Slack App 토큰",
        severity: "WARN",
        message: "SLACK_APP_TOKEN 미설정 — Socket Mode 동작 불가",
        hint: "api.slack.com/apps → Socket Mode → xapp- 토큰 발급 후 .env에 추가",
      });
    } else if (!env.SLACK_APP_TOKEN.startsWith("xapp-")) {
      results.push({
        name: "Slack App 토큰",
        severity: "FAIL",
        message: "SLACK_APP_TOKEN 형식 오류 (xapp- 으로 시작해야 함)",
      });
    } else {
      results.push({
        name: "Slack App 토큰",
        severity: "OK",
        message: "xapp- 형식 (실제 연결은 데몬 시작 시 검증)",
      });
    }
  }

  // Discord — /users/@me
  const discordToken = env.DISCORD_BOT_TOKEN;
  if (discordToken) {
    try {
      const res = await fetch("https://discord.com/api/v10/users/@me", {
        headers: { Authorization: `Bot ${discordToken}` },
      });
      if (res.ok) {
        const data = (await res.json()) as { username?: string; discriminator?: string };
        const tag = data.discriminator && data.discriminator !== "0"
          ? `${data.username}#${data.discriminator}`
          : data.username ?? "?";
        results.push({
          name: "Discord 토큰",
          severity: "OK",
          message: tag,
        });
      } else {
        results.push({
          name: "Discord 토큰",
          severity: "FAIL",
          message: `인증 실패 (HTTP ${res.status})`,
          hint: "discord.com/developers → Bot → Reset Token",
        });
      }
    } catch {
      results.push({
        name: "Discord 토큰",
        severity: "WARN",
        message: "네트워크 오류로 검증 불가",
      });
    }
  }

  return results;
}

function checkDaemon(): CheckResult {
  if (!existsSync(PATHS.daemonPid)) {
    return {
      name: "데몬 상태",
      severity: "WARN",
      message: "데몬이 실행 중이 아닙니다",
      hint: "jarvis start",
    };
  }

  const pid = Number(readFileSync(PATHS.daemonPid, "utf-8").trim());
  try {
    process.kill(pid, 0);
    return { name: "데몬 상태", severity: "OK", message: `실행 중 (PID ${pid})` };
  } catch {
    return {
      name: "데몬 상태",
      severity: "WARN",
      message: "PID 파일은 있지만 프로세스가 없음",
      hint: `rm ${PATHS.daemonPid} && jarvis start`,
    };
  }
}

function checkMcpRegistration(): CheckResult[] {
  if (!existsSync(PATHS.claudeSettings)) {
    return [
      {
        name: "Claude Code settings.json",
        severity: "FAIL",
        message: "파일이 없습니다",
        hint: "Claude Code를 먼저 설치하세요",
      },
    ];
  }

  try {
    const settings = loadClaudeSettings();
    const required = ["jarvis-memory", "jarvis-gateway"];
    const missing = required.filter((name) => !settings.mcpServers?.[name]);

    if (missing.length === 0) {
      return [{ name: "MCP 서버 등록", severity: "OK", message: "jarvis-memory, jarvis-gateway" }];
    }
    return [
      {
        name: "MCP 서버 등록",
        severity: "FAIL",
        message: `누락: ${missing.join(", ")}`,
        hint: "jarvis install-mcp",
      },
    ];
  } catch (err) {
    return [
      {
        name: "Claude Code settings.json",
        severity: "FAIL",
        message: `파싱 실패: ${(err as Error).message}`,
      },
    ];
  }
}

/**
 * 프로필별 접근 가능 디렉토리 가시화 + 위험 패턴 탐지
 *
 * 검증:
 * - add_dirs에 상대 경로(test, src 등)가 있으면 WARN — cwd 의존이라 위험
 * - from_projects가 있는데 projects.jsonc 매치가 0개면 INFO/WARN
 *   (의도된 격리일 수 있어 실패는 아니지만 가시화)
 * - Read/Glob/Grep 권한이 있는데 add_dirs가 모두 비면 WARN
 *   (cwd 샌드박스 외 접근 불가하므로 의도와 다를 수 있음)
 */
function checkProfileDirectories(): CheckResult[] {
  if (!existsSync(PATHS.profilesYml)) return [];
  try {
    const profilesDoc = loadProfilesYml();
    const projectsDoc = existsSync(PATHS.projectsJsonc)
      ? loadProjectsJsonc()
      : { projects: {} };

    const results: CheckResult[] = [];

    for (const [name, profile] of Object.entries(profilesDoc.profiles ?? {})) {
      const claude = (profile as Record<string, unknown>).claude as
        | Record<string, unknown>
        | undefined;
      if (!claude) continue;

      // owner는 skip_permissions로 우회되므로 검사 제외
      if (claude.skip_permissions) continue;

      const addDirs = (claude.add_dirs as string[] | undefined) ?? [];
      const allowedTools = (claude.allowed_tools as string[] | undefined) ?? [];
      const hasReadTool = allowedTools.some(
        (t) => t === "Read" || t === "Glob" || t === "Grep",
      );

      // 1. 상대 경로 검출
      const relativePaths = addDirs.filter(
        (d) => d !== "from_projects" && !d.startsWith("/") && !d.startsWith("~"),
      );
      if (relativePaths.length > 0) {
        results.push({
          name: `profile[${name}].add_dirs`,
          severity: "WARN",
          message: `상대 경로: ${relativePaths.join(", ")}`,
          hint: "상대 경로는 cwd 의존이라 격리가 무의미. 절대 경로 또는 from_projects 사용 권장",
        });
      }

      // 2. from_projects 매치 검사
      if (addDirs.includes("from_projects")) {
        const matched: string[] = [];
        for (const [key, project] of Object.entries(projectsDoc.projects ?? {})) {
          if ((project.allowed_profiles ?? []).includes(name)) {
            matched.push(`${key} (${project.path})`);
          }
        }
        if (matched.length === 0) {
          results.push({
            name: `profile[${name}].from_projects`,
            severity: hasReadTool ? "WARN" : "OK",
            message: hasReadTool
              ? `매치 0개 — Read 권한 있지만 접근 가능 디렉토리 없음 (cwd 샌드박스만)`
              : `매치 0개 (Read 권한도 없으므로 의도된 격리로 간주)`,
            hint: hasReadTool
              ? `projects.jsonc에 "${name}"을 allowed_profiles에 추가하거나, 의도라면 무시`
              : undefined,
          });
        } else {
          results.push({
            name: `profile[${name}].from_projects`,
            severity: "OK",
            message: `매치 ${matched.length}개: ${matched.join(", ")}`,
          });
        }
      }

      // 3. Read 도구가 있는데 add_dirs가 비어있는 경우
      if (hasReadTool && addDirs.length === 0) {
        results.push({
          name: `profile[${name}].격리 검토`,
          severity: "WARN",
          message: "Read/Glob/Grep 권한 있으나 add_dirs 비어있음",
          hint: "cwd 샌드박스 외 접근 불가 (의도된 동작이면 무시). reviewer/developer는 from_projects 권장",
        });
      }
    }

    return results;
  } catch {
    return [];
  }
}

/**
 * 프로필의 `claude.model` 필드가 알려진 모델 이름인지 확인.
 *
 * 허용: `opus`, `sonnet`, `haiku`(별칭) 또는 `claude-{opus|sonnet|haiku}-*`(정식).
 * 그 외 값은 오타 가능성 → WARN.
 * model 필드 미지정은 CLI 기본값 사용이라 경고 X.
 */
function checkProfileModels(): CheckResult[] {
  if (!existsSync(PATHS.profilesYml)) return [];
  try {
    const doc = loadProfilesYml();
    const known = /^(opus|sonnet|haiku|claude-(opus|sonnet|haiku)-[a-z0-9.-]+)$/i;
    const results: CheckResult[] = [];
    for (const [name, profile] of Object.entries(doc.profiles ?? {})) {
      const claude = (profile as Record<string, unknown>).claude as
        | Record<string, unknown>
        | undefined;
      const model = claude?.model as string | undefined;
      if (!model) continue;
      if (!known.test(model)) {
        results.push({
          name: `profile[${name}].claude.model`,
          severity: "WARN",
          message: `알 수 없는 모델 이름: "${model}"`,
          hint: `허용: opus/sonnet/haiku 또는 claude-{opus|sonnet|haiku}-YYYYMMDD 형태`,
        });
      }
    }
    if (results.length === 0) {
      return [{ name: "프로필 모델 이름", severity: "OK", message: "모두 유효" }];
    }
    return results;
  } catch {
    return [];
  }
}

/**
 * channels.yml의 auto_pair 관련 필드 정합성.
 *
 * - `auto_pair_profile`이 `profiles.yml`에 정의된 프로필인지 (고아 참조 방지)
 * - `auto_pair_scope`가 `mention_only|all` 중 하나인지 (enum 오타 방지)
 * auto_pair가 true인 채널만 검사.
 */
function checkChannelAutoPair(): CheckResult[] {
  if (!existsSync(PATHS.channelsYml)) return [];
  try {
    const channels = loadChannelsYml();
    const profiles = existsSync(PATHS.profilesYml) ? loadProfilesYml().profiles : {};
    const validScopes = new Set(["mention_only", "all"]);
    const results: CheckResult[] = [];

    for (const [name, cfg] of Object.entries(channels.channels ?? {})) {
      if (cfg.auto_pair !== true) continue;

      const profile = cfg.auto_pair_profile as string | undefined;
      if (profile && !profiles[profile]) {
        results.push({
          name: `channel[${name}].auto_pair_profile`,
          severity: "FAIL",
          message: `존재하지 않는 프로필 참조: "${profile}"`,
          hint: `profiles.yml에 ${profile}를 추가하거나 auto_pair_profile 값을 수정`,
        });
      }

      const scope = cfg.auto_pair_scope as string | undefined;
      if (scope && !validScopes.has(scope)) {
        results.push({
          name: `channel[${name}].auto_pair_scope`,
          severity: "WARN",
          message: `알 수 없는 값: "${scope}"`,
          hint: `허용: mention_only | all`,
        });
      }
    }

    if (results.length === 0) {
      return [{ name: "채널 auto_pair 설정", severity: "OK", message: "유효" }];
    }
    return results;
  } catch {
    return [];
  }
}

function checkMemoryUsage(): CheckResult {
  if (!existsSync(PATHS.memoryDb)) {
    return { name: "메모리 DB 크기", severity: "OK", message: "DB 미생성 (0 MB)" };
  }
  try {
    const policy = loadMemoryYml();
    const sizeMb = Number((statSync(PATHS.memoryDb).size / (1024 * 1024)).toFixed(2));
    const limits = `soft ${policy.soft_limit_mb} MB / hard ${policy.hard_limit_mb} MB`;

    if (sizeMb >= policy.hard_limit_mb) {
      return {
        name: "메모리 DB 크기",
        severity: "FAIL",
        message: `${sizeMb} MB — hard 리밋 초과 (${limits})`,
        hint: "bun run ~/jarvis/hooks/dreaming-cron.js 로 즉시 정리하세요",
      };
    }
    if (sizeMb >= policy.soft_limit_mb) {
      return {
        name: "메모리 DB 크기",
        severity: "WARN",
        message: `${sizeMb} MB — soft 리밋 초과 (${limits})`,
        hint: "곧 자동 Dreaming이 트리거됩니다. 또는 jarvis_memory_dream 호출",
      };
    }
    return {
      name: "메모리 DB 크기",
      severity: "OK",
      message: `${sizeMb} MB / soft ${policy.soft_limit_mb} MB`,
    };
  } catch (err) {
    return {
      name: "메모리 DB 크기",
      severity: "WARN",
      message: `크기 측정 실패: ${(err as Error).message}`,
    };
  }
}

function checkJarvisSymlink(): CheckResult {
  const jarvisBin = join(process.env.HOME ?? "~", ".local", "bin", "jarvis");
  if (!existsSync(jarvisBin)) {
    return {
      name: "jarvis 글로벌 명령",
      severity: "WARN",
      message: `${jarvisBin} 심볼릭 링크 없음`,
      hint: "setup.sh를 재실행하세요",
    };
  }
  return { name: "jarvis 글로벌 명령", severity: "OK", message: jarvisBin };
}

// ============================================================
// 집계
// ============================================================

export async function runAllChecks(opts: DiagnosticsOptions = {}): Promise<DiagnosticsSummary> {
  const results: CheckResult[] = [];

  results.push(...checkDirectories());
  results.push(checkProfilesYml());
  results.push(checkChannelsYml());
  results.push(checkProjectsJsonc());
  results.push(...checkProjectsSchema());
  results.push(...checkChannelTokens());
  results.push(...checkProfileDirectories());
  results.push(...checkProfileModels());
  results.push(...checkChannelAutoPair());

  if (!opts.skipNetwork) {
    results.push(...(await checkTokensLive()));
  }

  results.push(checkDaemon());
  results.push(...checkMcpRegistration());
  results.push(checkJarvisSymlink());
  results.push(checkMemoryUsage());

  return {
    results,
    hasFail: results.some((r) => r.severity === "FAIL"),
    hasWarn: results.some((r) => r.severity === "WARN"),
  };
}

/** 데몬 시작 시 간단 체크 (네트워크 X, 빠른 실패 용) */
export function runStartupChecks(): DiagnosticsSummary {
  const results: CheckResult[] = [
    checkProfilesYml(),
    checkChannelsYml(),
    checkProjectsJsonc(),
    ...checkProjectsSchema(),
    ...checkChannelTokens(),
    ...checkProfileDirectories(),
    ...checkProfileModels(),
    ...checkChannelAutoPair(),
    checkMemoryUsage(),
  ];

  return {
    results,
    hasFail: results.some((r) => r.severity === "FAIL"),
    hasWarn: results.some((r) => r.severity === "WARN"),
  };
}
