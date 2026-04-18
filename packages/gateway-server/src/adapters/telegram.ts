import type {
  AdapterIncoming,
  AdapterOutgoing,
  ChannelAdapter,
  ChannelAdapterConfig,
} from "./types.js";

/**
 * Telegram 어댑터
 *
 * 동작:
 *  - long polling으로 새 메시지 수신
 *  - DM(1:1)만 처리 (그룹 채팅은 향후 확장)
 *  - 응답은 sendMessage API로 전송
 *
 * 설정 (channels.yml):
 *   telegram:
 *     enabled: true
 *     token_env: TELEGRAM_BOT_TOKEN   # 환경 변수명
 *     poll_interval_ms: 1000          # (선택) 폴링 간격
 */
export class TelegramAdapter implements ChannelAdapter {
  readonly name = "telegram" as const;
  private token: string;
  private pollInterval: number;
  private offset = 0;
  private running = false;

  constructor(config: ChannelAdapterConfig) {
    const tokenEnv = (config.token_env as string) ?? "TELEGRAM_BOT_TOKEN";
    this.token = process.env[tokenEnv] ?? "";
    this.pollInterval = (config.poll_interval_ms as number) ?? 1000;
  }

  isAvailable(): boolean {
    return Boolean(this.token);
  }

  async start(
    onMessage: (msg: AdapterIncoming) => Promise<string | null>,
  ): Promise<void> {
    if (!this.isAvailable()) return;

    this.running = true;
    void this.pollLoop(onMessage);
  }

  async send(out: AdapterOutgoing): Promise<void> {
    if (!this.token) return;
    await fetch(`https://api.telegram.org/bot${this.token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: out.chat_id,
        text: out.message,
        ...(out.reply_to ? { reply_to_message_id: Number(out.reply_to) } : {}),
      }),
    });
  }

  async registerCommands(
    commands: Array<{ command: string; description: string }>,
  ): Promise<void> {
    if (!this.token) return;
    await fetch(`https://api.telegram.org/bot${this.token}/setMyCommands`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ commands }),
    });
  }

  async stop(): Promise<void> {
    this.running = false;
  }

  private async pollLoop(
    onMessage: (msg: AdapterIncoming) => Promise<string | null>,
  ): Promise<void> {
    while (this.running) {
      try {
        await this.pollOnce(onMessage);
      } catch {
        // 네트워크 일시 오류 무시
      }
      await new Promise((r) => setTimeout(r, this.pollInterval));
    }
  }

  private async pollOnce(
    onMessage: (msg: AdapterIncoming) => Promise<string | null>,
  ): Promise<void> {
    const url = `https://api.telegram.org/bot${this.token}/getUpdates?offset=${this.offset}&timeout=30`;
    const res = await fetch(url);
    const data = (await res.json()) as {
      ok: boolean;
      result: Array<{
        update_id: number;
        message?: {
          message_id: number;
          chat: { id: number };
          from?: { id: number; first_name: string };
          text?: string;
        };
      }>;
    };

    if (!data.ok || !data.result) return;

    for (const update of data.result) {
      this.offset = update.update_id + 1;
      const msg = update.message;
      if (!msg?.text || !msg.from) continue;

      const incoming: AdapterIncoming = {
        channel: "telegram",
        user_id: `telegram:${msg.chat.id}`,
        display_name: msg.from.first_name,
        message: msg.text,
        message_id: String(msg.message_id),
        chat_id: String(msg.chat.id),
      };

      // 비동기로 처리 (다음 폴링 차단하지 않음)
      onMessage(incoming)
        .then(async (response) => {
          if (response) {
            await this.send({ chat_id: incoming.chat_id!, message: response });
          }
        })
        .catch(() => { /* 응답 실패 무시 */ });
    }
  }
}
