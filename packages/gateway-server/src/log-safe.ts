/**
 * 로그 기록 전 토큰 마스킹 유틸.
 *
 * 어댑터들이 fetch URL에 토큰을 직접 삽입하는 구조라
 * (`https://api.telegram.org/bot{TOKEN}/getUpdates` 등) 네트워크 에러
 * stack/cause에 URL이 포함돼 daemon.log로 흘러들 수 있다.
 * daemon.log는 상황에 따라 공유/전송될 수 있으므로 기록 직전 한 번 필터.
 *
 * 적용 지점:
 *   - daemon.ts:log() — 모든 데몬 로그의 마지막 게이트
 *   - adapters/*.ts의 console.error — 에러 stack에 URL 포함 가능
 *
 * Object calisthenics: 한 함수 한 책임 (마스킹만).
 */

/**
 * 알려진 토큰 패턴을 `{TOKEN_MASKED}`로 치환한다.
 *
 * - Slack Bot: `xoxb-...` (숫자/문자/하이픈)
 * - Slack App: `xapp-...`
 * - Telegram Bot: `\d+:[A-Za-z0-9_-]{35,}` (BotFather 발급 형식)
 * - Discord Bot: `Bot <token>` Authorization 헤더 또는 본문 내 64자 이상 alnum 문자열 후보
 *
 * 과도 마스킹은 지양 — 실제 토큰으로 보이는 패턴만.
 */
export function maskTokens(input: unknown): string {
  const text = input instanceof Error ? (input.stack ?? input.message) : String(input ?? "");

  // Note: \b 단어 경계는 `bot1234567890:...` 같은 Telegram URL에서는 작동하지 않는다
  // (t-1 사이에 단어 경계 없음). 숫자/콜론 패턴 자체의 유일성에 의존해 마스킹.
  return text
    .replace(/xoxb-[A-Za-z0-9-]+/g, "{TOKEN_MASKED}")
    .replace(/xapp-[A-Za-z0-9-]+/g, "{TOKEN_MASKED}")
    .replace(/\d{6,}:[A-Za-z0-9_-]{30,}/g, "{TOKEN_MASKED}")
    .replace(/Bot\s+[A-Za-z0-9._-]{40,}/g, "Bot {TOKEN_MASKED}");
}
