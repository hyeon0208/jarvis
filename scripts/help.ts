#!/usr/bin/env bun

/**
 * `jarvis help [카테고리]` 출력.
 * 단일 소스는 scripts/lib/commands.ts:BUILTIN_COMMANDS.
 */

import {
  BUILTIN_COMMANDS,
  CATEGORY_LABELS,
  listCommands,
  type CommandCategory,
  type CommandSpec,
} from "./lib/commands.js";

const GREEN = "\x1b[32m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

const CATEGORY_ORDER: CommandCategory[] = [
  "conversation",
  "daemon",
  "launchd",
  "wizard",
  "admin",
  "cron",
  "query",
  "channel_sys",
  "channel_dev",
  "channel_cron",
];

function printBanner(): void {
  console.log(`${GREEN}Jarvis${RESET} — 개인화 AI 에이전트 + 채널 게이트웨이`);
  console.log("");
}

function printCategory(category: CommandCategory, commands: CommandSpec[]): void {
  if (commands.length === 0) return;
  console.log(`${GREEN}${CATEGORY_LABELS[category]}${RESET}`);
  for (const cmd of commands) {
    const usage = cmd.usage.padEnd(55);
    console.log(`  ${usage} ${DIM}${cmd.description}${RESET}`);
  }
  console.log("");
}

function printUsageHint(): void {
  console.log(`${DIM}카테고리 필터: jarvis help <${CATEGORY_ORDER.join("|")}>${RESET}`);
  console.log(`${DIM}상세 문서:    docs/07-commands.md${RESET}`);
}

function main(): void {
  const arg = process.argv[2];

  if (arg === "--json") {
    // 외부 도구 파이핑용 (예: 자동화 스크립트, 문서 생성)
    console.log(JSON.stringify(BUILTIN_COMMANDS, null, 2));
    return;
  }

  printBanner();

  // 인자가 카테고리 이름이면 해당 카테고리만 출력
  if (arg && CATEGORY_ORDER.includes(arg as CommandCategory)) {
    const cat = arg as CommandCategory;
    printCategory(cat, listCommands({ categories: [cat] }));
    return;
  }

  if (arg && arg !== "help") {
    console.log(`${DIM}알 수 없는 카테고리: "${arg}"${RESET}`);
    console.log("");
  }

  // 전체 출력 — 카테고리 순서대로
  for (const cat of CATEGORY_ORDER) {
    printCategory(cat, listCommands({ categories: [cat] }));
  }
  printUsageHint();
}

main();
