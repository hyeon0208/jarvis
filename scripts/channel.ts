#!/usr/bin/env bun

/**
 * 채널 CRUD CLI (비대화형)
 *
 * jarvis channel ls
 * jarvis channel enable <name>
 * jarvis channel disable <name>
 * jarvis channel token <name> <value>
 */

import {
  loadChannelsYml,
  saveChannelsYml,
  loadEnvFile,
  upsertEnv,
} from "./lib/config.js";

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

function usage(): void {
  console.log("사용법:");
  console.log("  jarvis channel ls");
  console.log("  jarvis channel enable <name>");
  console.log("  jarvis channel disable <name>");
  console.log("  jarvis channel token <name> <value>");
}

function cmdLs(): void {
  const config = loadChannelsYml();
  const env = loadEnvFile();
  const entries = Object.entries(config.channels ?? {});

  if (entries.length === 0) {
    console.log(`${DIM}등록된 채널이 없습니다.${RESET}`);
    return;
  }

  console.log(`\n채널 목록:\n`);
  for (const [name, cfg] of entries) {
    const enabled = cfg.enabled ? `${GREEN}● 활성${RESET}` : `${DIM}○ 비활성${RESET}`;
    console.log(`  ${enabled}  ${GREEN}${name}${RESET}`);

    const tokenKeys = ["token_env", "bot_token_env", "app_token_env", "auth_token_env"];
    for (const k of tokenKeys) {
      const envKey = cfg[k] as string | undefined;
      if (!envKey) continue;
      const has = !!env[envKey];
      const mark = has ? `${GREEN}✓${RESET}` : `${RED}✗${RESET}`;
      console.log(`    ${mark} ${k}: ${envKey}`);
    }
  }
  console.log("");
}

function setEnabled(name: string, value: boolean): void {
  const config = loadChannelsYml();
  if (!config.channels[name]) {
    console.error(`${RED}존재하지 않는 채널: ${name}${RESET}`);
    process.exit(1);
  }
  config.channels[name].enabled = value;
  saveChannelsYml(config);
  console.log(`${GREEN}${name} ${value ? "활성화" : "비활성화"}됨${RESET}`);
}

function cmdToken(name: string, value: string): void {
  if (!name || !value) {
    console.error(`${RED}채널 이름과 값을 모두 입력하세요.${RESET}`);
    usage();
    process.exit(1);
  }

  const config = loadChannelsYml();
  const cfg = config.channels[name];
  if (!cfg) {
    console.error(`${RED}존재하지 않는 채널: ${name}${RESET}`);
    process.exit(1);
  }

  // 채널의 주 토큰 환경변수 키 찾기 (우선순위: token_env > bot_token_env)
  const tokenKey = (cfg.token_env as string) ?? (cfg.bot_token_env as string);
  if (!tokenKey) {
    console.error(
      `${RED}${name} 채널에는 token_env 필드가 없습니다.${RESET}`,
    );
    console.error(`${DIM}Slack은 bot-token/app-token이 분리되어 있으므로 .env 직접 편집하세요.${RESET}`);
    process.exit(1);
  }

  upsertEnv(tokenKey, value);
  console.log(`${GREEN}.env 업데이트: ${tokenKey}${RESET}`);
  console.log(`${DIM}활성화하려면: jarvis channel enable ${name}${RESET}`);
}

function main(): void {
  const [cmd, ...rest] = process.argv.slice(2);

  if (cmd === "ls" || !cmd) return cmdLs();
  if (cmd === "enable") return setEnabled(rest[0] ?? "", true);
  if (cmd === "disable") return setEnabled(rest[0] ?? "", false);
  if (cmd === "token") return cmdToken(rest[0] ?? "", rest[1] ?? "");

  usage();
  process.exit(1);
}

main();
