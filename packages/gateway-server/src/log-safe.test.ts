import { describe, test, expect } from "bun:test";
import { maskTokens } from "./log-safe.js";

describe("log-safe: maskTokens", () => {
  test("Given Slack xoxb 토큰이 포함된 문자열 When mask Then 토큰만 마스킹", () => {
    const input = "auth_failed: https://slack.com/api/auth.test with xoxb-12345-67890-abcdefg";
    expect(maskTokens(input)).toBe(
      "auth_failed: https://slack.com/api/auth.test with {TOKEN_MASKED}",
    );
  });

  test("Given Slack xapp 토큰 When mask Then 마스킹", () => {
    const input = "token=xapp-1-A0123-BCDEFG-xyz";
    expect(maskTokens(input)).toBe("token={TOKEN_MASKED}");
  });

  test("Given Telegram 봇 토큰 형태 URL When mask Then 토큰만 치환", () => {
    const input =
      "fetch failed: https://api.telegram.org/bot1234567890:ABCdef-GhIjKlMnOpQrStUvWxYz1234567/getUpdates";
    expect(maskTokens(input)).toContain("{TOKEN_MASKED}");
    expect(maskTokens(input)).not.toContain("ABCdef-GhIjKlMnOpQrStUvWxYz1234567");
  });

  test("Given Discord Bot 토큰 When mask Then 마스킹", () => {
    // 명백한 가짜 토큰 — GitHub Secret Scanning 오탐 회피용으로 하이픈 구분 사용
    const fakeDiscordToken = "fake-discord-token-for-unit-test-0011223344-aabbcc";
    const input = `Authorization: "Bot ${fakeDiscordToken}"`;
    expect(maskTokens(input)).toBe('Authorization: "Bot {TOKEN_MASKED}"');
    expect(maskTokens(input)).not.toContain(fakeDiscordToken);
  });

  test("Given 토큰 없는 일반 에러 When mask Then 원문 유지", () => {
    const input = "ENOENT: no such file or directory, open '/foo/bar.json'";
    expect(maskTokens(input)).toBe(input);
  });

  test("Given Error 객체 When mask Then stack 에서 토큰 제거", () => {
    const err = new Error(
      "fetch https://api.telegram.org/bot1234567890:XXXX1234567890abcdefghij1234567/getMe",
    );
    const masked = maskTokens(err);
    expect(masked).toContain("{TOKEN_MASKED}");
    expect(masked).not.toContain("XXXX1234567890abcdefghij1234567");
  });
});
