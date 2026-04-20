#!/usr/bin/env bun

/**
 * Convert owner's personality (from owner.json) into a system prompt string.
 *
 * Output: a single-line system prompt (consumed by jarvis.sh via --append-system-prompt).
 * If owner.json is missing or personality is empty, outputs an empty string (safe).
 *
 * Follows the same mapping rules as daemon's buildPersonalityPrompt (in permissions.ts)
 * but omits external-channel-specific instructions (terminal mode).
 *
 * English for LLM token efficiency — actual response language is controlled by
 * personality.language (default: Korean).
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const OWNER_JSON = join(process.env.HOME ?? "~", ".jarvis", "users", "owner.json");

interface Personality {
  tone?: string;
  language?: string;
  verbosity?: string;
  nickname?: string;
  system_prompt_extra?: string;
}

function buildPrompt(p: Personality, name?: string): string {
  const parts: string[] = [];

  if (name) parts.push(`User name: ${name}.`);

  const toneMap: Record<string, string> = {
    formal: "Use a formal and polite tone.",
    casual: "Use a casual and friendly tone.",
    friendly: "Use a warm and friendly tone.",
    technical: "Use a technical and precise tone.",
  };
  if (p.tone && toneMap[p.tone]) parts.push(toneMap[p.tone]);

  const langMap: Record<string, string> = {
    ko: "Respond in Korean (한국어).",
    en: "Respond in English.",
    ja: "Respond in Japanese (日本語).",
  };
  if (p.language) {
    parts.push(langMap[p.language] ?? `Respond in ${p.language}.`);
  } else {
    parts.push("Respond in Korean (한국어) by default.");
  }

  if (p.verbosity === "concise") parts.push("Keep responses terse — only the essentials.");
  else if (p.verbosity === "detailed") parts.push("Include detailed explanations.");

  if (p.nickname) parts.push(`Your name is "${p.nickname}".`);

  // Free-form extension (detailed role/persona instructions)
  if (p.system_prompt_extra && p.system_prompt_extra.trim()) {
    parts.push(p.system_prompt_extra.trim());
  }

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
