#!/usr/bin/env bun

/**
 * 기존 프로필 수정 마법사
 *
 * 사용법: jarvis edit-profile <name>
 *
 * 각 항목을 `[현재값] 새 값?` 형태로 질문합니다.
 * 빈 입력이면 기존 값이 유지됩니다.
 */

import { ask, askPatch, askYesNo, askChoice } from "./lib/prompt.js";
import { loadProfilesYml, saveProfilesYml } from "./lib/config.js";

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

const MODEL_OPTIONS = ["opus", "sonnet", "haiku", ""] as const;
const EFFORT_OPTIONS = ["low", "medium", "high", "xhigh", "max", ""] as const;

async function chooseFromList<T extends string>(
  label: string,
  current: string | undefined,
  options: readonly T[],
  descriptions: string[],
): Promise<T> {
  console.log(`\n${YELLOW}현재 ${label}: ${current ?? "(기본값)"}${RESET}`);
  const idx = await askChoice(
    `${label}을(를) 변경할까요? (현재 유지하려면 마지막 항목)`,
    descriptions,
  );
  return options[idx];
}

async function editList(label: string, current: string[]): Promise<string[]> {
  console.log(`\n${YELLOW}현재 ${label} (${current.length}개):${RESET}`);
  for (const item of current.slice(0, 10)) console.log(`  - ${item}`);
  if (current.length > 10) console.log(`  ${DIM}... ${current.length - 10}개 더${RESET}`);

  const mode = await askChoice(`${label}을(를) 어떻게 수정할까요?`, [
    "현재 유지",
    "항목 추가",
    "항목 제거",
    "전체 재입력 (쉼표 구분)",
  ]);

  if (mode === 0) return current;
  if (mode === 1) {
    const add = await ask("추가할 항목 (쉼표 구분):");
    return [...current, ...add.split(",").map((s) => s.trim()).filter(Boolean)];
  }
  if (mode === 2) {
    const rm = await ask("제거할 항목 (쉼표 구분):");
    const rmSet = new Set(rm.split(",").map((s) => s.trim()));
    return current.filter((x) => !rmSet.has(x));
  }
  const newVal = await ask("전체 항목 (쉼표 구분):");
  return newVal.split(",").map((s) => s.trim()).filter(Boolean);
}

async function main(): Promise<void> {
  const name = process.argv[2];
  if (!name) {
    console.error(`${RED}사용법: jarvis edit-profile <name>${RESET}`);
    process.exit(1);
  }

  const config = loadProfilesYml();
  const profile = config.profiles[name];
  if (!profile) {
    console.error(`${RED}존재하지 않는 프로필: ${name}${RESET}`);
    process.exit(1);
  }

  console.log(`${GREEN}╔══════════════════════════════════════╗${RESET}`);
  console.log(`${GREEN}║  프로필 수정: ${name.padEnd(24)}║${RESET}`);
  console.log(`${GREEN}╚══════════════════════════════════════╝${RESET}`);

  const claude = (profile.claude ?? {}) as Record<string, unknown>;

  // 설명
  const description = await askPatch("설명", String(profile.description ?? ""));

  // 모델
  const model = await chooseFromList("모델", claude.model as string | undefined, MODEL_OPTIONS, [
    "opus   — 강력, 복잡한 코딩/설계",
    "sonnet — 균형",
    "haiku  — 빠르고 저렴",
    "현재 유지",
  ]);

  // Effort
  const effort = await chooseFromList("effort", claude.effort as string | undefined, EFFORT_OPTIONS, [
    "low",
    "medium",
    "high",
    "xhigh (Opus 4.7+)",
    "max",
    "현재 유지",
  ]);

  // 허용/차단 도구
  const allowedTools = await editList("allowed_tools", (claude.allowed_tools as string[]) ?? []);
  const disallowedTools = await editList("disallowed_tools", (claude.disallowed_tools as string[]) ?? []);
  const addDirs = await editList("add_dirs", (claude.add_dirs as string[]) ?? []);

  // 시스템 프롬프트
  console.log(`\n${YELLOW}현재 system_prompt:${RESET}`);
  console.log(`${DIM}${String(claude.system_prompt ?? "(없음)").slice(0, 100)}...${RESET}`);
  const editPrompt = await askYesNo("system_prompt를 수정할까요?");
  const systemPrompt = editPrompt
    ? await ask("새 system_prompt:")
    : (claude.system_prompt as string | undefined);

  // 타임아웃
  const timeoutStr = await askPatch("타임아웃 (초)", String(profile.timeout ?? 300));
  const timeout = Number(timeoutStr) || 300;

  // 확인
  console.log(`\n${GREEN}── 변경 요약 ──${RESET}`);
  console.log(`설명: ${description}`);
  console.log(`모델: ${model || "(기본값)"}`);
  console.log(`effort: ${effort || "(기본값)"}`);
  console.log(`allowed_tools: ${allowedTools.length}개`);
  console.log(`disallowed_tools: ${disallowedTools.length}개`);
  console.log(`add_dirs: ${addDirs.length}개`);
  console.log(`타임아웃: ${timeout}초`);

  if (!(await askYesNo("\n저장할까요?"))) {
    console.log("취소되었습니다.");
    process.exit(0);
  }

  // 저장
  profile.description = description;
  profile.timeout = timeout;
  profile.claude = {
    ...(claude.skip_permissions ? { skip_permissions: true } : {}),
    ...(model ? { model } : {}),
    ...(effort ? { effort } : {}),
    allowed_tools: allowedTools,
    disallowed_tools: disallowedTools,
    ...(addDirs.length > 0 ? { add_dirs: addDirs } : {}),
    ...(systemPrompt ? { system_prompt: systemPrompt } : {}),
  };

  saveProfilesYml(config);
  console.log(`\n${GREEN}프로필 "${name}" 저장 완료${RESET}`);
  console.log(`${DIM}데몬에서 자동 리로드됩니다 (재시작 불필요).${RESET}`);
}

main().catch((err) => {
  console.error(`${RED}오류: ${err.message}${RESET}`);
  process.exit(1);
});
