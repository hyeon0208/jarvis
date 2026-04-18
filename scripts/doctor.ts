#!/usr/bin/env bun

/**
 * Jarvis 진단 CLI
 *
 * jarvis doctor                 — 전체 진단
 * jarvis doctor --quick         — 네트워크 체크 제외 (빠른 검사)
 * jarvis doctor --skip-network  — --quick와 동일
 * jarvis doctor --silent-ok     — 모두 정상이면 출력 없음 (jarvis chat 진입 등 자동 호출용)
 */

import { runAllChecks, type CheckResult } from "./lib/diagnostics.js";

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

function severityMark(severity: CheckResult["severity"]): string {
  if (severity === "OK") return `${GREEN}✓${RESET}`;
  if (severity === "WARN") return `${YELLOW}⚠${RESET}`;
  return `${RED}✗${RESET}`;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const skipNetwork = args.includes("--quick") || args.includes("--skip-network");
  const silentOk = args.includes("--silent-ok");

  const summary = await runAllChecks({ skipNetwork });

  const hasIssue = summary.hasFail || summary.results.some((r) => r.severity === "WARN");

  // silent-ok 모드: 문제 없으면 조용히 종료
  if (silentOk && !hasIssue) {
    return;
  }

  console.log(`\n${GREEN}Jarvis 진단 시작${RESET}${skipNetwork ? " (네트워크 제외)" : ""}\n`);

  let okCount = 0;
  let warnCount = 0;
  let failCount = 0;

  for (const r of summary.results) {
    if (silentOk && r.severity === "OK") {
      okCount++;
      continue;
    }
    console.log(`  ${severityMark(r.severity)}  ${r.name}: ${r.message}`);
    if (r.hint && r.severity !== "OK") {
      console.log(`      ${DIM}힌트: ${r.hint}${RESET}`);
    }
    if (r.severity === "OK") okCount++;
    else if (r.severity === "WARN") warnCount++;
    else failCount++;
  }

  console.log("");
  console.log(
    `결과: ${GREEN}OK ${okCount}${RESET} / ${YELLOW}WARN ${warnCount}${RESET} / ${RED}FAIL ${failCount}${RESET}`,
  );
  console.log("");

  if (summary.hasFail) process.exit(1);
}

main().catch((err) => {
  console.error(`${RED}진단 실행 실패: ${err.message}${RESET}`);
  process.exit(1);
});
