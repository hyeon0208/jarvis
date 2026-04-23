#!/usr/bin/env bun

/**
 * 유저 관리 CLI
 *
 * jarvis user ls
 * jarvis user show <user_id>
 * jarvis user profile <user_id> <profile>
 * jarvis user rename <user_id> <new_name>
 * jarvis user rm <user_id>
 */

import { existsSync, unlinkSync } from "node:fs";
import {
  loadUserConfig,
  updateUserConfig,
} from "../packages/gateway-server/src/auth.js";
import { listAllUsers, userFilePath } from "./lib/config.js";

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

function usage(): void {
  console.log("사용법:");
  console.log("  jarvis user ls");
  console.log("  jarvis user show <user_id>");
  console.log("  jarvis user profile <user_id> <profile>");
  console.log("  jarvis user rename <user_id> <new_name>");
  console.log("  jarvis user rm <user_id>");
}

function cmdLs(): void {
  const users = listAllUsers();
  if (users.length === 0) {
    console.log(`${DIM}등록된 유저가 없습니다.${RESET}`);
    return;
  }
  console.log(`\n유저 (${users.length}명):`);
  console.log(`${DIM}  P    AUTO  USER_ID                        NAME              PROFILE${RESET}`);
  for (const u of users) {
    const paired = u.paired ? `${GREEN}✓${RESET}` : `${RED}✗${RESET}`;
    // auto_paired=true면 채널 자동 페어링(Slack 멘션 등)으로 등록된 유저
    const auto = u.auto_paired === true ? `${GREEN}✓${RESET}` : `${DIM}-${RESET}`;
    const userId = String(u.user_id ?? "-").padEnd(30);
    const name = String(u.name ?? "-").padEnd(16);
    const profile = String(u.profile ?? "-");
    console.log(`  ${paired}    ${auto}     ${userId} ${name} ${profile}`);
  }
  console.log("");
}

function cmdShow(userId: string): void {
  if (!userId) {
    console.error(`${RED}user_id를 입력하세요.${RESET}`);
    process.exit(1);
  }
  const cfg = loadUserConfig(userId);
  if (!cfg) {
    console.error(`${RED}존재하지 않는 유저: ${userId}${RESET}`);
    process.exit(1);
  }
  console.log(JSON.stringify(cfg, null, 2));
}

function cmdProfile(userId: string, profile: string): void {
  if (!userId || !profile) {
    console.error(`${RED}user_id와 profile을 입력하세요.${RESET}`);
    process.exit(1);
  }
  const ok = updateUserConfig(userId, { profile });
  if (!ok) {
    console.error(`${RED}유저를 찾을 수 없습니다: ${userId}${RESET}`);
    process.exit(1);
  }
  console.log(`${GREEN}${userId} → 프로필 변경: ${profile}${RESET}`);
}

function cmdRename(userId: string, name: string): void {
  if (!userId || !name) {
    console.error(`${RED}user_id와 새 이름을 입력하세요.${RESET}`);
    process.exit(1);
  }
  const ok = updateUserConfig(userId, { name });
  if (!ok) {
    console.error(`${RED}유저를 찾을 수 없습니다: ${userId}${RESET}`);
    process.exit(1);
  }
  console.log(`${GREEN}${userId} → 이름 변경: ${name}${RESET}`);
}

function cmdRm(userId: string): void {
  if (!userId) {
    console.error(`${RED}user_id를 입력하세요.${RESET}`);
    process.exit(1);
  }
  const path = userFilePath(userId);
  if (!existsSync(path)) {
    console.error(`${RED}존재하지 않는 유저: ${userId}${RESET}`);
    process.exit(1);
  }
  unlinkSync(path);
  console.log(`${GREEN}유저 삭제됨: ${userId}${RESET}`);
}

function main(): void {
  const [cmd, ...rest] = process.argv.slice(2);

  if (cmd === "ls" || !cmd) return cmdLs();
  if (cmd === "show") return cmdShow(rest[0] ?? "");
  if (cmd === "profile") return cmdProfile(rest[0] ?? "", rest[1] ?? "");
  if (cmd === "rename") return cmdRename(rest[0] ?? "", rest[1] ?? "");
  if (cmd === "rm") return cmdRm(rest[0] ?? "");

  usage();
  process.exit(1);
}

main();
