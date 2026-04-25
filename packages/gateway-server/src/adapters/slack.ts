import type {
  AdapterIncoming,
  AdapterOutgoing,
  ChannelAdapter,
  ChannelAdapterConfig,
} from "./types.js";
import { maskTokens } from "../log-safe.js";

/**
 * Slack 어댑터 (DM + 채널 멘션)
 *
 * 설정 (channels.yml):
 *   slack:
 *     enabled: true
 *     bot_token_env: SLACK_BOT_TOKEN     # xoxb-...
 *     app_token_env: SLACK_APP_TOKEN     # xapp-... (Socket Mode)
 *     listen_dm: true                    # DM 수신
 *     listen_mention: true               # @bot 멘션 수신
 *     thread_replies: true               # 채널 멘션은 스레드로 응답
 *
 * Slack App 설정 필요:
 *   - Socket Mode 활성화
 *   - Event Subscriptions: message.im, app_mention
 *   - OAuth Scopes: chat:write, im:history, app_mentions:read, reactions:write
 *
 * 수신 ACK:
 *   - 메시지를 받으면 Claude 실행 전에 원문에 `:thug-life:` 이모지를 붙여
 *     사용자가 "읽었다"를 즉각 인지할 수 있게 한다.
 *   - 워크스페이스에 해당 커스텀 이모지가 없으면 `invalid_name` 경고만 남기고 진행.
 */
const ACK_REACTION = "thug-life";
export class SlackAdapter implements ChannelAdapter {
  readonly name = "slack" as const;
  private botToken: string;
  private appToken: string;
  private listenDm: boolean;
  private listenMention: boolean;
  private threadReplies: boolean;
  private app: any = null;

  constructor(config: ChannelAdapterConfig) {
    const botEnv = (config.bot_token_env as string) ?? "SLACK_BOT_TOKEN";
    const appEnv = (config.app_token_env as string) ?? "SLACK_APP_TOKEN";
    this.botToken = process.env[botEnv] ?? "";
    this.appToken = process.env[appEnv] ?? "";
    this.listenDm = config.listen_dm !== false;
    this.listenMention = config.listen_mention !== false;
    this.threadReplies = config.thread_replies !== false;
  }

  isAvailable(): boolean {
    return Boolean(this.botToken && this.appToken);
  }

  async start(
    onMessage: (msg: AdapterIncoming) => Promise<string | null>,
  ): Promise<void> {
    if (!this.isAvailable()) return;

    const { App } = await import("@slack/bolt");

    this.app = new App({
      token: this.botToken,
      appToken: this.appToken,
      socketMode: true,
    });

    // DM 메시지
    if (this.listenDm) {
      this.app.message(async ({ message, say }: any) => {
        if (!("text" in message) || !("user" in message)) return;
        if ("subtype" in message) return;
        if (message.channel_type !== "im") return; // DM만

        const incoming: AdapterIncoming = {
          channel: "slack",
          user_id: `slack:${message.user}`,
          display_name: message.user,
          message: message.text ?? "",
          message_id: message.ts,
          chat_id: message.channel,
          meta: { is_dm: true },
        };

        await this.ackReaction(message.channel, message.ts);

        try {
          const response = await onMessage(incoming);
          if (response) {
            await say(response).catch((err: unknown) =>
              console.error(
                `[slack] DM say 실패 (user=${message.user}): ${maskTokens(err)}`,
              ),
            );
          }
        } catch (err) {
          console.error(
            `[slack] DM handleMessage 실패 (user=${incoming.user_id}, msg="${incoming.message.slice(0, 60)}"): ${maskTokens(err)}`,
          );
        }
      });
    }

    // 채널에서 @멘션
    if (this.listenMention) {
      this.app.event("app_mention", async ({ event, say }: any) => {
        // 멘션 텍스트에서 봇 멘션 부분 제거
        const text = (event.text ?? "").replace(/<@[A-Z0-9]+>\s*/g, "").trim();

        const incoming: AdapterIncoming = {
          channel: "slack",
          user_id: `slack:${event.user}`,
          display_name: event.user,
          message: text,
          message_id: event.ts,
          chat_id: event.channel,
          meta: { is_dm: false, thread_ts: event.thread_ts ?? event.ts },
        };

        await this.ackReaction(event.channel, event.ts);

        try {
          const response = await onMessage(incoming);
          if (response) {
            // 스레드로 답변
            await say({
              text: response,
              thread_ts: this.threadReplies ? (event.thread_ts ?? event.ts) : undefined,
            }).catch((err: unknown) =>
              console.error(
                `[slack] mention say 실패 (user=${event.user}): ${maskTokens(err)}`,
              ),
            );
          }
        } catch (err) {
          console.error(
            `[slack] mention handleMessage 실패 (user=${incoming.user_id}, msg="${incoming.message.slice(0, 60)}"): ${maskTokens(err)}`,
          );
        }
      });
    }

    await this.app.start();
  }

  async send(out: AdapterOutgoing): Promise<void> {
    if (!this.app) return;
    await this.app.client.chat.postMessage({
      channel: out.chat_id,
      text: out.message,
      ...(out.reply_to ? { thread_ts: out.reply_to } : {}),
    }).catch((err: unknown) =>
      console.error(
        `[slack] send 실패 (channel=${out.chat_id}): ${maskTokens(err)}`,
      ),
    );
  }

  async stop(): Promise<void> {
    if (this.app) await this.app.stop();
  }

  // 수신 ACK — Claude 실행 전에 원문에 이모지를 붙여 "읽음"을 표시.
  // 실패해도 메시지 처리는 계속 진행해야 하므로 내부에서 에러를 삼키고 로그만 남긴다.
  private async ackReaction(channel: string, ts: string): Promise<void> {
    if (!this.app) return;
    try {
      await this.app.client.reactions.add({
        channel,
        timestamp: ts,
        name: ACK_REACTION,
      });
    } catch (err: any) {
      const code = err?.data?.error;
      // 같은 메시지에 이미 동일 이모지 반응이 있으면 정상 (재처리/재시작 후 흔함)
      if (code === "already_reacted") return;
      console.error(
        `[slack] ack 반응 실패 (channel=${channel}, ts=${ts}, name=${ACK_REACTION}, code=${code}): ${maskTokens(err)}`,
      );
    }
  }
}
