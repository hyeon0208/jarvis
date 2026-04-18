import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import type { ChannelAdapter, ChannelAdapterConfig } from "./types.js";
import { TelegramAdapter } from "./telegram.js";
import { DiscordAdapter } from "./discord.js";
import { SlackAdapter } from "./slack.js";
import { WebhookAdapter } from "./webhook.js";

const CHANNELS_YML = join(
  process.env.HOME ?? "~",
  "jarvis",
  "config",
  "channels.yml",
);

/** 빌트인 어댑터 팩토리 */
type AdapterFactory = (config: ChannelAdapterConfig) => ChannelAdapter;

const BUILTIN_ADAPTERS: Record<string, AdapterFactory> = {
  telegram: (c) => new TelegramAdapter(c),
  discord: (c) => new DiscordAdapter(c),
  slack: (c) => new SlackAdapter(c),
  webhook: (c) => new WebhookAdapter(c),
};

/** 사용자 정의 어댑터 등록 (런타임 추가용) */
const customAdapters: Record<string, AdapterFactory> = {};

export function registerAdapter(name: string, factory: AdapterFactory): void {
  customAdapters[name] = factory;
}

/** channels.yml 로드 */
interface ChannelsYml {
  channels: Record<string, ChannelAdapterConfig>;
}

function loadChannelsConfig(): ChannelsYml {
  if (!existsSync(CHANNELS_YML)) {
    return { channels: {} };
  }
  try {
    const content = readFileSync(CHANNELS_YML, "utf-8");
    return parseYaml(content) as ChannelsYml;
  } catch {
    return { channels: {} };
  }
}

/** 활성화된 모든 어댑터 인스턴스 생성 */
export function createEnabledAdapters(): ChannelAdapter[] {
  const config = loadChannelsConfig();
  const adapters: ChannelAdapter[] = [];

  for (const [name, channelConfig] of Object.entries(config.channels)) {
    if (!channelConfig.enabled) continue;

    const factory = BUILTIN_ADAPTERS[name] ?? customAdapters[name];
    if (!factory) {
      console.error(`[registry] 알 수 없는 채널 어댑터: ${name}`);
      continue;
    }

    const adapter = factory(channelConfig);
    if (adapter.isAvailable()) {
      adapters.push(adapter);
    }
  }

  return adapters;
}

/** 어댑터 종류 목록 */
export function listAdapterKinds(): string[] {
  return [...Object.keys(BUILTIN_ADAPTERS), ...Object.keys(customAdapters)];
}
