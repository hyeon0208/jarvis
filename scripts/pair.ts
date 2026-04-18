#!/usr/bin/env bun

/**
 * 페어링 관리 CLI
 *
 * 사용법:
 *   jarvis pair list                       — 대기 중인 페어링 코드 목록
 *   jarvis pair approve <code> [profile]   — 페어링 승인 (기본 프로필: observer)
 *   jarvis pair reject <user_id>           — 페어링 거부
 */

import {
  listPendingPairings,
  approvePairing,
  rejectPairing,
} from "../packages/gateway-server/src/auth.js";

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

function usage(): void {
  console.log("사용법:");
  console.log("  jarvis pair list");
  console.log("  jarvis pair approve <code> [profile]");
  console.log("  jarvis pair reject <user_id>");
}

function cmdList(): void {
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

  console.log(`${DIM}승인: jarvis pair approve <code> <profile>${RESET}`);
}

function cmdApprove(code: string, profile: string): void {
  if (!code) {
    console.error(`${RED}페어링 코드를 입력하세요.${RESET}`);
    process.exit(1);
  }

  const result = approvePairing(code, profile);
  if (!result.success) {
    console.error(`${RED}승인 실패: ${result.error}${RESET}`);
    process.exit(1);
  }

  console.log(`${GREEN}승인 완료${RESET}`);
  console.log(`  user_id: ${result.userId}`);
  console.log(`  profile: ${profile}`);
}

function cmdReject(userId: string): void {
  if (!userId) {
    console.error(`${RED}user_id를 입력하세요.${RESET}`);
    process.exit(1);
  }

  const ok = rejectPairing(userId);
  if (!ok) {
    console.error(`${RED}거부 실패: 해당 페어링을 찾을 수 없습니다.${RESET}`);
    process.exit(1);
  }

  console.log(`${GREEN}거부 완료: ${userId}${RESET}`);
}

function main(): void {
  const [cmd, ...rest] = process.argv.slice(2);

  if (cmd === "list") {
    cmdList();
    return;
  }
  if (cmd === "approve") {
    cmdApprove(rest[0] ?? "", rest[1] ?? "observer");
    return;
  }
  if (cmd === "reject") {
    cmdReject(rest[0] ?? "");
    return;
  }

  usage();
  process.exit(cmd ? 1 : 0);
}

main();
