#!/usr/bin/env bun

/**
 * jarvis chat 진입 시 owner의 personality를 시스템 프롬프트 문자열로 변환합니다.
 *
 * 출력: 단일 라인 시스템 프롬프트 (jarvis.sh가 받아서 --append-system-prompt에 붙임)
 * owner.json이 없거나 personality가 비어 있으면 빈 문자열 출력 (잘 처리됨).
 *
 * 외부 채널 데몬이 사용하는 buildPersonalityPrompt와 같은 매핑 규칙을 따르되,
 * 터미널 모드에 맞춰 "외부 채널" 관련 지시는 제외합니다.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const OWNER_JSON = join(process.env.HOME ?? "~", ".jarvis", "users", "owner.json");

interface Personality {
  tone?: string;
  language?: string;
  verbosity?: string;
  nickname?: string;
}

function buildPrompt(p: Personality, name?: string): string {
  const parts: string[] = [];

  if (name) parts.push(`사용자 이름: ${name}.`);

  const toneMap: Record<string, string> = {
    formal: "정중하고 격식 있는 톤으로 응답하세요.",
    casual: "편안하고 친근한 톤으로 응답하세요.",
    friendly: "밝고 친절한 톤으로 응답하세요.",
    technical: "기술적이고 정확한 톤으로 응답하세요.",
  };
  if (p.tone && toneMap[p.tone]) parts.push(toneMap[p.tone]);

  const langMap: Record<string, string> = {
    ko: "한국어로 응답하세요.",
    en: "Respond in English.",
    ja: "日本語で応答してください。",
  };
  if (p.language) parts.push(langMap[p.language] ?? `${p.language}로 응답하세요.`);

  if (p.verbosity === "concise") parts.push("응답은 간결하게 핵심만 전달하세요.");
  else if (p.verbosity === "detailed") parts.push("응답은 상세하게 설명을 포함하세요.");

  if (p.nickname) parts.push(`당신의 이름은 "${p.nickname}"입니다.`);

  return parts.filter(Boolean).join(" ");
}

function main(): void {
  if (!existsSync(OWNER_JSON)) {
    process.stdout.write("");
    return;
  }

  try {
    const data = JSON.parse(readFileSync(OWNER_JSON, "utf-8")) as {
      name?: string;
      personality?: Personality;
    };

    const personality = data.personality ?? {};
    const out = buildPrompt(personality, data.name);
    process.stdout.write(out);
  } catch {
    process.stdout.write("");
  }
}

main();
