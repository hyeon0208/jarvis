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

  if (!opts.skipNetwork) {
    results.push(...(await checkTokensLive()));
  }

  results.push(checkDaemon());
  results.push(...checkMcpRegistration());
  results.push(checkJarvisSymlink());

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
  ];

  return {
    results,
    hasFail: results.some((r) => r.severity === "FAIL"),
    hasWarn: results.some((r) => r.severity === "WARN"),
  };
}
