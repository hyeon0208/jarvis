#!/usr/bin/env bun

/**
 * 채널 추가 마법사
 *
 * 사용법: jarvis add-channel
 *
 * 지원 채널: telegram, discord, slack, webhook
 * 토큰을 입력받아 .env에 저장하고 channels.yml을 활성화합니다.
 */

import { ask, askChoice, askYesNo } from "./lib/prompt.js";
import {
  loadChannelsYml,
  saveChannelsYml,
  upsertEnv,
} from "./lib/config.js";

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

async function verifyTelegramToken(token: string): Promise<string | null> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getMe`);
    const data = (await res.json()) as { ok: boolean; result?: { username: string } };
    return data.ok && data.result ? data.result.username : null;
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  console.log(`${GREEN}╔══════════════════════════════════════╗${RESET}`);
  console.log(`${GREEN}║    채널 추가 마법사                    ║${RESET}`);
  console.log(`${GREEN}╚══════════════════════════════════════╝${RESET}`);

  const config = loadChannelsYml();
  const channelNames = Object.keys(config.channels ?? {});
  if (channelNames.length === 0) {
    console.error(`${RED}channels.yml에 정의된 채널이 없습니다.${RESET}`);
    process.exit(1);
  }

  const idx = await askChoice("활성화할 채널을 선택하세요:", channelNames);
  const name = channelNames[idx];
  const cfg = config.channels[name];

  console.log(`\n${YELLOW}${name} 채널 설정${RESET}`);

  // 토큰 입력 (채널별 env 키 모두 채움)
  const tokenKeys = ["token_env", "bot_token_env", "app_token_env", "auth_token_env"];
  for (const key of tokenKeys) {
    const envKey = cfg[key] as string | undefined;
    if (!envKey) continue;
    const value = await ask(`${envKey} 값:`);
    if (value) {
      upsertEnv(envKey, value);
      console.log(`${GREEN}.env에 저장: ${envKey}${RESET}`);
    }
  }

  // Telegram 라이브 검증
  if (name === "telegram") {
    const { loadEnvFile } = await import("./lib/config.js");
    const env = loadEnvFile();
    const token = env[(cfg.token_env as string) ?? "TELEGRAM_BOT_TOKEN"];
    if (token) {
      process.stdout.write(`${DIM}Telegram 토큰 검증 중...${RESET} `);
      const username = await verifyTelegramToken(token);
      if (username) {
        console.log(`${GREEN}OK (@${username})${RESET}`);
      } else {
        console.log(`${RED}검증 실패${RESET}`);
        if (!(await askYesNo("그래도 활성화할까요?"))) {
          console.log("취소되었습니다.");
          process.exit(0);
        }
      }
    }
  }

  // 활성화
  if (await askYesNo(`${name} 채널을 활성화할까요?`)) {
    config.channels[name].enabled = true;
    saveChannelsYml(config);
    console.log(`${GREEN}${name} 활성화됨${RESET}`);
    console.log(`${DIM}데몬 재시작: jarvis restart${RESET}`);
  }
}

main().catch((err) => {
  console.error(`${RED}오류: ${err.message}${RESET}`);
  process.exit(1);
});
