#!/usr/bin/env bun

/**
 * 토큰 사용 감사 — 프로필별 시스템 프롬프트 길이/토큰 추정치를 출력한다.
 *
 * 매 외부 채널 메시지마다 Claude에 주입되는 시스템 프롬프트(고정 규칙 +
 * personality + system_prompt)의 크기를 한 눈에 보이게 해서, 최적화 전후
 * 비용을 비교하거나 과잉 프롬프트가 들어간 프로필을 찾는 용도.
 *
 * Heuristic: 영어 4글자 ≈ 1 token, 한국어는 거의 1자=1 token.
 * 정확한 값은 Claude tokenizer가 내지만 감사용 비교엔 충분.
 *
 * 사용:
 *   bun run scripts/token-audit.ts
 */

import {
  buildPersonalityPrompt,
  mergePersonality,
  listProfileConfigs,
  getProfileConfig,
} from "../packages/gateway-server/src/permissions.js";

const DIM = "\x1b[2m";
const RESET = "\x1b[0m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";

function estimateTokens(text: string): number {
  // 영어 char/4 + 한자/한글 비율 보정.
  // 한글이 들어간 부분은 글자당 1 토큰에 가깝다는 근사.
  const hangul = (text.match(/[\uac00-\ud7a3]/g) ?? []).length;
  const nonHangul = text.length - hangul;
  return Math.ceil(nonHangul / 4 + hangul);
}

function colorFor(tokens: number): string {
  if (tokens >= 400) return YELLOW;
  return GREEN;
}

function audit(): void {
  console.log(`${DIM}# Jarvis 토큰 감사 — 프로필별 시스템 프롬프트 길이 (추정)${RESET}`);
  console.log(`${DIM}# char/4 + 한글 1:1 근사, Claude tokenizer와 다를 수 있음${RESET}`);
  console.log("");

  const header = `  ${DIM}PROFILE${RESET}        ${DIM}CHARS${RESET}   ${DIM}~TOKENS${RESET}   ${DIM}MODEL${RESET}       ${DIM}SYSTEM_PROMPT (프로필 전용)${RESET}`;
  console.log(header);

  let total = 0;
  for (const { name } of listProfileConfigs()) {
    const profile = getProfileConfig(name);
    const merged = mergePersonality(undefined, name);
    // 외부 채널 메시지를 흉내 — channel/userName/userId는 예시값 주입 길이에 큰 영향 없음
    const personalityPrompt = buildPersonalityPrompt(merged, "SampleUser", "external-channel", "sample:123");

    const profileSystemPrompt = profile?.claude?.system_prompt ?? "";
    const total_prompt = `${personalityPrompt} ${profileSystemPrompt}`.trim();

    const chars = total_prompt.length;
    const tokens = estimateTokens(total_prompt);
    total += tokens;

    const color = colorFor(tokens);
    const model = profile?.claude?.model ?? "(기본)";
    const extra = profileSystemPrompt ? `${profileSystemPrompt.slice(0, 50).replace(/\n/g, " ")}...` : "(없음)";
    console.log(
      `  ${name.padEnd(14)} ${String(chars).padStart(5)}   ${color}${String(tokens).padStart(6)}${RESET}   ${model.padEnd(10)}  ${DIM}${extra}${RESET}`,
    );
  }

  console.log("");
  console.log(
    `${DIM}프로필 합계: ${total} tokens. 매 외부 메시지마다 --append-system-prompt로 주입되므로,${RESET}`,
  );
  console.log(
    `${DIM}세션 resume 시에도 Claude가 시스템 프롬프트를 다시 본다는 점을 고려하세요.${RESET}`,
  );
}

audit();
