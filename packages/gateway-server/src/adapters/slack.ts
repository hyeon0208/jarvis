/**
 * Slack 채널 어댑터
 *
 * Slack Bolt와 Jarvis 게이트웨이를 연결합니다.
 *
 * 설정:
 * - SLACK_BOT_TOKEN (xoxb-...) 환경변수 필요
 * - SLACK_APP_TOKEN (xapp-...) 환경변수 필요 (Socket Mode)
 * - Slack API에서 앱 생성 후 토큰 발급
 * - Socket Mode 활성화 + Event Subscriptions (message.im, message.channels)
 */

export interface SlackIncoming {
  channel_id: string;
  message_id: string;
  user_id: string;
  display_name: string;
  text: string;
  team_id?: string;
  is_dm: boolean;
}

/** Slack 유저 ID를 Jarvis 유저 ID로 변환 */
export function toJarvisUserId(slackUserId: string): string {
  return `slack:${slackUserId}`;
}

/** Slack 봇 시작 (독립 프로세스로 실행 시) */
export async function startSlackBot(
  onMessage: (msg: SlackIncoming) => Promise<string>,
): Promise<void> {
  const botToken = process.env.SLACK_BOT_TOKEN;
  const appToken = process.env.SLACK_APP_TOKEN;

  if (!botToken || !appToken) {
    console.error(
      "[Slack] SLACK_BOT_TOKEN과 SLACK_APP_TOKEN이 설정되지 않았습니다.",
    );
    return;
  }

  try {
    const { App } = await import("@slack/bolt");

    const app = new App({
      token: botToken,
      appToken,
      socketMode: true,
    });

    app.message(async ({ message, say }) => {
      // 봇 메시지, 서브타입 메시지 무시
      if (!("text" in message) || !("user" in message)) return;
      if ("subtype" in message) return;

      const incoming: SlackIncoming = {
        channel_id: message.channel,
        message_id: message.ts,
        user_id: message.user as string,
        display_name: message.user as string, // 별도 API 호출로 이름 조회 가능
        text: message.text ?? "",
        is_dm: message.channel_type === "im",
      };

      const response = await onMessage(incoming);
      if (response) {
        await say(response);
      }
    });

    await app.start();
    console.error("[Slack] 봇 시작됨 (Socket Mode)");
  } catch (err) {
    console.error("[Slack] 봇 시작 실패:", err);
  }
}
