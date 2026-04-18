import type {
  AdapterIncoming,
  AdapterOutgoing,
  ChannelAdapter,
  ChannelAdapterConfig,
} from "./types.js";

/**
 * Discord 어댑터 (DM + 서버 멘션)
 *
 * 설정 (channels.yml):
 *   discord:
 *     enabled: true
 *     token_env: DISCORD_BOT_TOKEN
 *     listen_dm: true       # DM 수신
 *     listen_mention: true  # 서버에서 @멘션 시 응답
 */
export class DiscordAdapter implements ChannelAdapter {
  readonly name = "discord" as const;
  private token: string;
  private listenDm: boolean;
  private listenMention: boolean;
  private client: any = null;

  constructor(config: ChannelAdapterConfig) {
    const tokenEnv = (config.token_env as string) ?? "DISCORD_BOT_TOKEN";
    this.token = process.env[tokenEnv] ?? "";
    this.listenDm = config.listen_dm !== false;
    this.listenMention = config.listen_mention !== false;
  }

  isAvailable(): boolean {
    return Boolean(this.token);
  }

  async start(
    onMessage: (msg: AdapterIncoming) => Promise<string | null>,
  ): Promise<void> {
    if (!this.isAvailable()) return;

    const { Client, GatewayIntentBits } = await import("discord.js");

    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.MessageContent,
      ],
    });

    this.client.on("messageCreate", async (message: any) => {
      if (message.author.bot) return;

      const isDm = !message.guildId;
      const botId = this.client.user?.id;
      const isMention = botId && message.mentions.has(botId);

      // DM 또는 멘션만 처리
      if (isDm && !this.listenDm) return;
      if (!isDm && !isMention) return;
      if (!isDm && !this.listenMention) return;

      // 멘션인 경우 봇 멘션 부분 제거
      let text = message.content;
      if (isMention && botId) {
        text = text.replace(new RegExp(`<@!?${botId}>`, "g"), "").trim();
      }

      const incoming: AdapterIncoming = {
        channel: "discord",
        user_id: `discord:${message.author.id}`,
        display_name: message.author.displayName ?? message.author.username,
        message: text,
        message_id: message.id,
        chat_id: message.channelId,
        meta: { is_dm: isDm, guild_id: message.guildId },
      };

      onMessage(incoming)
        .then(async (response) => {
          if (response) {
            await message.reply(response).catch(() => { /* ignore */ });
          }
        })
        .catch(() => { /* ignore */ });
    });

    await this.client.login(this.token);
  }

  async send(out: AdapterOutgoing): Promise<void> {
    if (!this.client) return;
    const channel = await this.client.channels.fetch(out.chat_id);
    if (channel?.isTextBased()) {
      await channel.send(out.message);
    }
  }

  async stop(): Promise<void> {
    if (this.client) await this.client.destroy();
  }
}
