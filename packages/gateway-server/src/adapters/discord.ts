/**
 * Discord 채널 어댑터
 *
 * Discord 봇과 Jarvis 게이트웨이를 연결합니다.
 * discord.js를 사용하여 메시지를 수신하고 응답합니다.
 *
 * 설정:
 * - DISCORD_BOT_TOKEN 환경변수 필요
 * - Discord Developer Portal에서 봇 생성 후 토큰 발급
 * - Message Content Intent 활성화 필요
 */

export interface DiscordIncoming {
  channel_id: string;
  message_id: string;
  user_id: string;
  display_name: string;
  text: string;
  guild_id?: string;
  is_dm: boolean;
}

/** Discord 유저 ID를 Jarvis 유저 ID로 변환 */
export function toJarvisUserId(discordUserId: string): string {
  return `discord:${discordUserId}`;
}

/** Discord 봇 시작 (독립 프로세스로 실행 시) */
export async function startDiscordBot(
  onMessage: (msg: DiscordIncoming) => Promise<string>,
): Promise<void> {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) {
    console.error("[Discord] DISCORD_BOT_TOKEN이 설정되지 않았습니다.");
    return;
  }

  try {
    const { Client, GatewayIntentBits } = await import("discord.js");

    const client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.MessageContent,
      ],
    });

    client.on("ready", () => {
      console.error(`[Discord] 봇 로그인: ${client.user?.tag}`);
    });

    client.on("messageCreate", async (message) => {
      // 봇 자신의 메시지 무시
      if (message.author.bot) return;

      const incoming: DiscordIncoming = {
        channel_id: message.channelId,
        message_id: message.id,
        user_id: message.author.id,
        display_name: message.author.displayName ?? message.author.username,
        text: message.content,
        guild_id: message.guildId ?? undefined,
        is_dm: !message.guildId,
      };

      const response = await onMessage(incoming);
      if (response) {
        await message.reply(response);
      }
    });

    await client.login(token);
  } catch (err) {
    console.error("[Discord] 봇 시작 실패:", err);
  }
}
