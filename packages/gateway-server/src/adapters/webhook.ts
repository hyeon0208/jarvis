import type {
  AdapterIncoming,
  AdapterOutgoing,
  ChannelAdapter,
  ChannelAdapterConfig,
} from "./types.js";

/**
 * Webhook 어댑터 (범용 HTTP 수신)
 *
 * 외부 시스템(GitHub, Jira, Notion, 사내 봇 등)이 HTTP POST로
 * Jarvis에게 메시지를 보낼 수 있게 합니다.
 *
 * 설정 (channels.yml):
 *   webhook:
 *     enabled: true
 *     port: 3737
 *     auth_token_env: WEBHOOK_AUTH_TOKEN  # Bearer 인증
 *
 * 요청 형식:
 *   POST http://localhost:3737/webhook
 *   Authorization: Bearer {token}
 *   Content-Type: application/json
 *
 *   {
 *     "user_id": "external:123",
 *     "display_name": "홍길동",
 *     "message": "JPA N+1 해결 방법 알려줘",
 *     "callback_url": "https://example.com/jarvis-callback"  // (선택)
 *   }
 *
 * 응답:
 *   - callback_url 지정 시 → 비동기 처리 후 callback POST
 *   - 없으면 → 동기 응답
 */
export class WebhookAdapter implements ChannelAdapter {
  readonly name = "webhook" as const;
  private port: number;
  private authToken: string;
  private server: any = null;
  private onMessage:
    | ((msg: AdapterIncoming) => Promise<string | null>)
    | null = null;

  constructor(config: ChannelAdapterConfig) {
    this.port = (config.port as number) ?? 3737;
    const tokenEnv = (config.auth_token_env as string) ?? "WEBHOOK_AUTH_TOKEN";
    this.authToken = process.env[tokenEnv] ?? "";
  }

  isAvailable(): boolean {
    // 토큰 없으면 보안상 비활성화
    return Boolean(this.authToken);
  }

  async start(
    onMessage: (msg: AdapterIncoming) => Promise<string | null>,
  ): Promise<void> {
    if (!this.isAvailable()) return;

    this.onMessage = onMessage;

    // Bun.serve 사용
    this.server = Bun.serve({
      port: this.port,
      hostname: "127.0.0.1", // 로컬만 허용
      fetch: async (req) => this.handleRequest(req),
    });
  }

  async send(out: AdapterOutgoing): Promise<void> {
    // chat_id가 callback_url 형식이면 POST로 응답
    if (out.chat_id.startsWith("http")) {
      await fetch(out.chat_id, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message_id: out.reply_to,
          response: out.message,
        }),
      }).catch((err: unknown) =>
        console.error(
          `[webhook] callback POST 실패 (url=${out.chat_id}):`,
          err instanceof Error ? err.message : err,
        ),
      );
    }
  }

  async stop(): Promise<void> {
    if (this.server) this.server.stop();
  }

  private async handleRequest(req: Request): Promise<Response> {
    if (req.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    // 인증
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${this.authToken}`) {
      return new Response("Unauthorized", { status: 401 });
    }

    let body: {
      user_id?: string;
      display_name?: string;
      message?: string;
      callback_url?: string;
    };

    try {
      body = (await req.json()) as typeof body;
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }

    if (!body.user_id || !body.message) {
      return new Response("Missing user_id or message", { status: 400 });
    }

    const incoming: AdapterIncoming = {
      channel: "webhook",
      user_id: body.user_id.startsWith("webhook:")
        ? body.user_id
        : `webhook:${body.user_id}`,
      display_name: body.display_name ?? "Webhook User",
      message: body.message,
      chat_id: body.callback_url ?? body.user_id,
      meta: {},
    };

    // 비동기 처리 (callback_url이 있는 경우)
    if (body.callback_url) {
      this.onMessage!(incoming)
        .then(async (response) => {
          if (response) {
            await this.send({
              chat_id: body.callback_url!,
              message: response,
            });
          }
        })
        .catch((err) => {
          console.error(
            `[webhook] async handleMessage 실패 (user=${incoming.user_id}, msg="${incoming.message.slice(0, 60)}"):`,
            err instanceof Error ? (err.stack ?? err.message) : err,
          );
        });
      return Response.json({ status: "queued" }, { status: 202 });
    }

    // 동기 처리
    try {
      const response = await this.onMessage!(incoming);
      return Response.json({ response: response ?? "" });
    } catch (err) {
      console.error(
        `[webhook] sync handleMessage 실패 (user=${incoming.user_id}, msg="${incoming.message.slice(0, 60)}"):`,
        err instanceof Error ? (err.stack ?? err.message) : err,
      );
      return Response.json({ response: "", error: "internal error" }, { status: 500 });
    }
  }
}
