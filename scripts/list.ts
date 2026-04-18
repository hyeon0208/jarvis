#!/usr/bin/env bun

/**
 * 조회 CLI
 *
 * jarvis list profiles    — profiles.yml 정의 목록
 * jarvis list users       — 등록된 유저 목록
 * jarvis list channels    — channels.yml 채널 목록 + 상태
 * jarvis list pending     — 페어링 대기 (= jarvis pair list)
 */

import {
  loadProfilesYml,
  loadChannelsYml,
  loadEnvFile,
  listAllUsers,
} from "./lib/config.js";
import { listPendingPairings } from "../packages/gateway-server/src/auth.js";

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

function usage(): void {
  console.log("사용법:");
  console.log("  jarvis list profiles");
  console.log("  jarvis list users");
  console.log("  jarvis list channels");
  console.log("  jarvis list pending");
}

function listProfiles(): void {
  const config = loadProfilesYml();
  const entries = Object.entries(config.profiles);
  if (entries.length === 0) {
    console.log(`${DIM}등록된 프로필이 없습니다.${RESET}`);
    return;
  }

  console.log(`\n프로필 목록 (${entries.length}개):\n`);
  for (const [name, profile] of entries) {
    const claude = (profile.claude ?? {}) as Record<string, unknown>;
    const isDefault = config.default_profile === name;
    const marker = isDefault ? `${YELLOW}[기본]${RESET} ` : "";
    const model = claude.model ?? "(기본값)";
    const effort = claude.effort ?? "(기본값)";
    const tools = (claude.allowed_tools as string[] | undefined)?.length ?? 0;
    const skip = claude.skip_permissions ? `${RED}[skip_permissions]${RESET} ` : "";

    console.log(`  ${marker}${skip}${GREEN}${name}${RESET}`);
    console.log(`    설명: ${profile.description ?? "-"}`);
    console.log(`    모델: ${model} / effort: ${effort} / 도구: ${tools}개`);
    console.log(`    타임아웃: ${profile.timeout ?? 300}초`);
    console.log("");
  }
}

function listUsers(): void {
  const users = listAllUsers();
  if (users.length === 0) {
    console.log(`${DIM}등록된 유저가 없습니다.${RESET}`);
    return;
  }

  console.log(`\n유저 목록 (${users.length}명):\n`);
  for (const u of users) {
    const name = u.name ?? "(이름 없음)";
    const profile = u.profile ?? "observer";
    const paired = u.paired ? `${GREEN}✓${RESET}` : `${RED}✗${RESET}`;
    const channel = u.channel ?? "-";
    const pairedAt = u.paired_at
      ? new Date(String(u.paired_at)).toLocaleString("ko-KR")
      : "-";

    console.log(`  ${paired} ${GREEN}${u.user_id}${RESET}`);
    console.log(`    이름: ${name} / 프로필: ${profile} / 채널: ${channel}`);
    console.log(`    페어링: ${pairedAt}`);
    console.log("");
  }
}

function listChannels(): void {
  const config = loadChannelsYml();
  const env = loadEnvFile();
  const entries = Object.entries(config.channels ?? {});

  if (entries.length === 0) {
    console.log(`${DIM}등록된 채널이 없습니다.${RESET}`);
    return;
  }

  console.log(`\n채널 목록 (${entries.length}개):\n`);
  for (const [name, cfg] of entries) {
    const enabled = cfg.enabled
      ? `${GREEN}● 활성${RESET}`
      : `${DIM}○ 비활성${RESET}`;

    const tokenStatus = checkTokens(cfg, env);
    console.log(`  ${enabled}  ${GREEN}${name}${RESET}  ${tokenStatus}`);
  }
  console.log("");
}

function checkTokens(cfg: Record<string, unknown>, env: Record<string, string>): string {
  const tokenKeys = ["token_env", "bot_token_env", "app_token_env", "auth_token_env"];
  const required = tokenKeys
    .filter((k) => typeof cfg[k] === "string")
    .map((k) => cfg[k] as string);

  if (required.length === 0) return `${DIM}(토큰 불필요)${RESET}`;

  const missing = required.filter((key) => !env[key]);
  if (missing.length === 0) return `${GREEN}토큰 OK${RESET}`;
  return `${RED}토큰 누락: ${missing.join(", ")}${RESET}`;
}

function listPending(): void {
  const pending = listPendingPairings();
  if (pending.length === 0) {
    console.log(`${DIM}대기 중인 페어링이 없습니다.${RESET}`);
    return;
  }

  console.log(`\n대기 중인 페어링 (${pending.length}건):\n`);
  for (const p of pending) {
    const expiresAt = new Date(p.expires_at).toLocaleString("ko-KR");
    console.log(`  ${YELLOW}${p.code}${RESET}  ${p.channel}  ${p.display_name}`);
    console.log(`    user_id: ${p.user_id}`);
    console.log(`    만료: ${expiresAt}`);
    console.log("");
  }
}

function main(): void {
  const [target] = process.argv.slice(2);

  if (target === "profiles") return listProfiles();
  if (target === "users") return listUsers();
  if (target === "channels") return listChannels();
  if (target === "pending") return listPending();

  usage();
  process.exit(target ? 1 : 0);
}

main();
