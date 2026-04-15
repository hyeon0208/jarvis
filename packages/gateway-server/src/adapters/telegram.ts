/**
 * Telegram 채널 어댑터
 *
 * Claude Code의 기존 telegram 플러그인(mcp__plugin_telegram_telegram__reply)과
 * Jarvis 게이트웨이를 연결합니다.
 *
 * 동작 방식:
 * 1. Telegram 메시지가 <channel source="telegram" ...> 태그로 Claude Code에 도착
 * 2. Claude Code가 jarvis_gateway_route를 호출하여 인증/권한 체크
 * 3. 결과에 따라 mcp__plugin_telegram_telegram__reply로 응답
 *
 * 이 파일은 메시지 파싱/포맷팅 유틸리티를 제공합니다.
 */

export interface TelegramIncoming {
  chat_id: string;
  message_id: string;
  user: string;
  user_id?: string;
  text: string;
  timestamp: string;
  has_image?: boolean;
  image_path?: string;
  attachment_file_id?: string;
}

/** <channel> 태그에서 Telegram 메시지 정보 추출 */
export function parseTelegramChannel(channelTag: string): TelegramIncoming | null {
  const chatIdMatch = channelTag.match(/chat_id="([^"]+)"/);
  const messageIdMatch = channelTag.match(/message_id="([^"]+)"/);
  const userMatch = channelTag.match(/user="([^"]+)"/);
  const tsMatch = channelTag.match(/ts="([^"]+)"/);
  const imagePathMatch = channelTag.match(/image_path="([^"]+)"/);
  const attachmentMatch = channelTag.match(/attachment_file_id="([^"]+)"/);

  if (!chatIdMatch || !messageIdMatch || !userMatch) return null;

  // 태그 내부 텍스트 추출
  const textMatch = channelTag.match(/>([^<]*)</);

  return {
    chat_id: chatIdMatch[1],
    message_id: messageIdMatch[1],
    user: userMatch[1],
    user_id: `telegram:${chatIdMatch[1]}`,
    text: textMatch ? textMatch[1].trim() : "",
    timestamp: tsMatch?.[1] ?? new Date().toISOString(),
    has_image: !!imagePathMatch,
    image_path: imagePathMatch?.[1],
    attachment_file_id: attachmentMatch?.[1],
  };
}

/** Jarvis 게이트웨이 라우팅 결과를 Telegram 응답 포맷으로 변환 */
export function formatTelegramResponse(
  routeResult: { action: string; response?: string },
  personality?: { nickname?: string; emoji?: boolean },
): string {
  const prefix = personality?.nickname ? `[${personality.nickname}] ` : "[Jarvis] ";

  switch (routeResult.action) {
    case "pairing_required":
      return routeResult.response ?? "페어링이 필요합니다.";

    case "permission_denied":
      return `${prefix}${routeResult.response ?? "권한이 없습니다."}`;

    case "respond":
      return `${prefix}${routeResult.response ?? ""}`;

    case "execute":
      // 실행 결과는 별도로 처리됨
      return "";

    default:
      return `${prefix}알 수 없는 응답입니다.`;
  }
}

/** 크론잡 결과를 사용자 친화적 메시지로 포맷 */
export function formatCronResult(result: Record<string, unknown>): string {
  if (result.success === false) {
    return `크론잡 오류: ${result.error ?? "알 수 없는 오류"}`;
  }

  if (result.job) {
    const job = result.job as Record<string, unknown>;
    return [
      "크론잡이 등록되었습니다:",
      `  ID: ${job.id}`,
      `  스케줄: ${job.schedule}`,
      `  작업: ${job.prompt}`,
    ].join("\n");
  }

  if (result.jobs) {
    const jobs = result.jobs as Array<Record<string, unknown>>;
    if (jobs.length === 0) return "등록된 크론잡이 없습니다.";

    const lines = ["등록된 크론잡:"];
    for (const job of jobs) {
      const status = job.enabled ? "활성" : "비활성";
      lines.push(`  [${status}] ${job.id}: ${job.schedule} → ${job.prompt}`);
    }
    return lines.join("\n");
  }

  if (result.success === true) {
    return "크론잡이 처리되었습니다.";
  }

  return JSON.stringify(result);
}
