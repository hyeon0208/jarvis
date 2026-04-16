#!/usr/bin/env bun

/**
 * Jarvis 프로필 생성 마법사
 *
 * 인터랙티브하게 프로필을 생성하고 profiles.yml에 추가합니다.
 *
 * 실행: bun run ~/jarvis/scripts/create-profile.ts
 * 또는: jarvis create-profile
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

const PROFILES_YML = join(process.env.HOME ?? "~", "jarvis", "config", "profiles.yml");

// --- 프롬프트 유틸 ---

async function ask(question: string): Promise<string> {
  process.stdout.write(`\x1b[36m${question}\x1b[0m `);
  for await (const line of console) {
    return line.trim();
  }
  return "";
}

async function askChoice(question: string, options: string[]): Promise<number> {
  console.log(`\n\x1b[36m${question}\x1b[0m`);
  options.forEach((opt, i) => console.log(`  ${i + 1}. ${opt}`));
  const answer = await ask("번호:");
  const idx = Number(answer) - 1;
  if (isNaN(idx) || idx < 0 || idx >= options.length) {
    console.log("\x1b[33m잘못된 번호입니다. 다시 선택하세요.\x1b[0m");
    return askChoice(question, options);
  }
  return idx;
}

async function askMultiChoice(question: string, options: string[]): Promise<number[]> {
  console.log(`\n\x1b[36m${question}\x1b[0m (쉼표로 여러 개 선택, 예: 1,3,5)`);
  options.forEach((opt, i) => console.log(`  ${i + 1}. ${opt}`));
  const answer = await ask("번호:");
  const indices = answer
    .split(",")
    .map((s) => Number(s.trim()) - 1)
    .filter((i) => !isNaN(i) && i >= 0 && i < options.length);
  if (indices.length === 0) {
    console.log("\x1b[33m최소 1개를 선택하세요.\x1b[0m");
    return askMultiChoice(question, options);
  }
  return indices;
}

async function askYesNo(question: string): Promise<boolean> {
  const answer = await ask(`${question} (y/n):`);
  return answer.toLowerCase().startsWith("y");
}

// --- 도구 카탈로그 ---

const TOOL_CATEGORIES = {
  "파일 읽기": ["Read", "Glob", "Grep"],
  "파일 쓰기": ["Edit", "Write"],
  "웹 검색": ["WebSearch", "WebFetch"],
  "Git 조회": [
    "Bash(git status:*)", "Bash(git log:*)", "Bash(git diff:*)",
    "Bash(git show:*)", "Bash(git branch:*)", "Bash(git blame:*)",
  ],
  "Git 작업": [
    "Bash(git add:*)", "Bash(git commit:*)", "Bash(git push:*)",
    "Bash(git checkout:*)", "Bash(git switch:*)", "Bash(git pull:*)",
    "Bash(git fetch:*)", "Bash(git merge:*)", "Bash(git stash:*)",
    "Bash(gh pr:*)",
  ],
  "빌드/테스트": [
    "Bash(bun test:*)", "Bash(bun run build:*)",
    "Bash(npm test:*)", "Bash(npm run build:*)",
    "Bash(gradle test:*)", "Bash(gradle build:*)",
    "Bash(./gradlew test:*)", "Bash(./gradlew build:*)",
  ],
  "Jarvis 메모리": [
    "mcp__jarvis-memory__jarvis_memory_recall",
    "mcp__jarvis-memory__jarvis_memory_list",
    "mcp__jarvis-memory__jarvis_memory_save",
    "mcp__jarvis-memory__jarvis_session_search",
    "mcp__jarvis-memory__jarvis_memory_stats",
    "mcp__jarvis-gateway__jarvis_cron_manage",
  ],
};

const DANGEROUS_PRESETS = [
  "Bash(rm -rf:*)", "Bash(rm -r:*)",
  "Bash(sudo:*)", "Bash(su :*)",
  "Bash(chmod:*)", "Bash(chown:*)",
  "Bash(ssh:*)", "Bash(scp:*)",
  "Bash(cat ~/.ssh:*)", "Bash(cat ~/.env:*)", "Bash(cat /etc:*)",
  "Bash(open :*)", "Bash(osascript:*)",
  "Bash(kill:*)", "Bash(killall:*)",
  "Bash(launchctl:*)", "Bash(defaults:*)",
  "Bash(networksetup:*)",
  "Bash(git push --force:*)", "Bash(git reset --hard:*)",
];

// --- 메인 ---

async function main() {
  console.log("\x1b[32m");
  console.log("╔══════════════════════════════════════╗");
  console.log("║    Jarvis 프로필 생성 마법사          ║");
  console.log("╚══════════════════════════════════════╝");
  console.log("\x1b[0m");

  // 1. 프로필 이름
  console.log("\x1b[33m프로필은 팀원의 권한 등급입니다.");
  console.log("팀원 등록 시 이 이름으로 프로필을 지정합니다.");
  console.log("예: /jarvis-telegram pair approve A1B2C3 intern\x1b[0m\n");
  const name = await ask("프로필 이름 (영문, 예: developer, intern):");
  if (!name || !/^[a-z][a-z0-9_-]*$/.test(name)) {
    console.log("\x1b[31m영문 소문자로 시작하는 이름을 입력하세요.\x1b[0m");
    process.exit(1);
  }

  // 기존 프로필 확인
  const config = loadConfig();
  if (config.profiles[name]) {
    const overwrite = await askYesNo(`"${name}" 프로필이 이미 존재합니다. 덮어쓸까요?`);
    if (!overwrite) process.exit(0);
  }

  // 2. 설명
  console.log("\n\x1b[33m이 프로필의 역할을 설명하세요. 팀원 목록에서 표시됩니다.\x1b[0m");
  const description = await ask("프로필 설명 (한글 가능):");

  // 3. 허용 도구 선택
  console.log("\n\x1b[32m── 허용 도구 선택 ──\x1b[0m");
  console.log("\x1b[33m이 프로필의 팀원이 사용할 수 있는 도구를 선택합니다.");
  console.log("선택하지 않은 도구는 Claude가 호출할 수 없으므로,");
  console.log("팀원이 요청해도 해당 작업이 수행되지 않습니다.\x1b[0m\n");
  const categoryNames = Object.keys(TOOL_CATEGORIES);
  const selectedCategories = await askMultiChoice(
    "허용할 도구 카테고리를 선택하세요:",
    categoryNames,
  );

  const allowedTools: string[] = [];
  for (const idx of selectedCategories) {
    const catName = categoryNames[idx];
    allowedTools.push(...TOOL_CATEGORIES[catName as keyof typeof TOOL_CATEGORIES]);
  }

  // 커스텀 도구 추가
  if (await askYesNo("추가로 허용할 도구가 있나요?")) {
    const custom = await ask('도구 목록 (쉼표 구분, 예: "Bash(docker ps:*),Bash(curl:*)")');
    allowedTools.push(...custom.split(",").map((s) => s.trim()).filter(Boolean));
  }

  // 4. 차단 도구
  console.log("\n\x1b[32m── 차단 도구 설정 ──\x1b[0m");
  console.log("\x1b[33m허용 도구에 포함되어 있더라도 여기서 차단하면 실행되지 않습니다.");
  console.log("예: 파일 쓰기는 허용하되 rm -rf는 차단하는 식으로 세밀하게 제어합니다.");
  console.log("Owner의 로컬 보안을 위해 기본 차단 목록 사용을 권장합니다.\x1b[0m\n");
  console.log("기본 차단 목록:");
  DANGEROUS_PRESETS.forEach((t) => console.log(`  ✗ ${t}`));

  const useDefaults = await askYesNo("\n기본 차단 목록을 사용할까요? (권장: y)");
  let disallowedTools = useDefaults ? [...DANGEROUS_PRESETS] : [];

  if (!useDefaults) {
    console.log("차단할 명령어를 직접 입력하세요:");
    const custom = await ask('차단 목록 (쉼표 구분, 예: "Bash(rm -rf:*),Bash(sudo:*)")');
    disallowedTools = custom.split(",").map((s) => s.trim()).filter(Boolean);
  }

  if (await askYesNo("추가로 차단할 도구가 있나요?")) {
    const extra = await ask("추가 차단 (쉼표 구분):");
    disallowedTools.push(...extra.split(",").map((s) => s.trim()).filter(Boolean));
  }

  // 5. 접근 디렉토리
  console.log("\n\x1b[32m── 접근 디렉토리 설정 ──\x1b[0m");
  console.log("\x1b[33m이 프로필의 팀원이 접근할 수 있는 디렉토리를 제한합니다.");
  console.log("여기서 지정한 디렉토리 외에는 파일을 읽거나 수정할 수 없습니다.");
  console.log("Owner의 ~/.ssh, ~/.env 등 민감한 파일을 보호하는 핵심 설정입니다.\x1b[0m\n");
  const addDirs: string[] = [];

  console.log("\x1b[33mconfig/projects.jsonc에 등록된 프로젝트 저장소의 경로를 자동으로 허용합니다.");
  console.log("예: vingle-backend → /Users/.../vingle-backend 자동 추가\x1b[0m");
  if (await askYesNo("등록된 프로젝트 디렉토리를 자동 허용할까요? (권장: y)")) {
    addDirs.push("from_projects");
  }

  console.log("\n\x1b[33m프로젝트 외에 추가로 접근을 허용할 디렉토리를 지정합니다.");
  console.log("예: /Users/.../docs, /tmp/workspace 등\x1b[0m");
  if (await askYesNo("추가 디렉토리를 지정할까요?")) {
    while (true) {
      const dir = await ask("디렉토리 경로 (빈 줄이면 종료):");
      if (!dir) break;

      // 디렉토리 없으면 생성
      if (!existsSync(dir)) {
        const create = await askYesNo(`"${dir}"이 없습니다. 생성할까요?`);
        if (create) {
          mkdirSync(dir, { recursive: true });
          console.log(`\x1b[32m  디렉토리 생성됨: ${dir}\x1b[0m`);
        }
      }
      addDirs.push(dir);
    }
  }

  // 6. 시스템 프롬프트
  console.log("\n\x1b[32m── 시스템 프롬프트 ──\x1b[0m");
  console.log("\x1b[33mClaude에게 전달할 추가 지시사항입니다.");
  console.log("이 프로필의 팀원이 요청할 때마다 Claude가 이 규칙을 따릅니다.");
  console.log("예: '한국어로만 응답', '시스템 파일 접근 금지' 등\x1b[0m\n");
  let systemPrompt = "";
  const promptChoice = await askChoice("시스템 프롬프트를 어떻게 설정할까요?", [
    "기본 보안 규칙 사용 (권장 — 시스템 파일 접근 차단)",
    "직접 입력",
    "없음",
  ]);

  if (promptChoice === 0) {
    systemPrompt =
      "보안 규칙: ~/.ssh, ~/.env, /etc 등 시스템 파일에 절대 접근하지 마세요.\n" +
      "프로젝트 디렉토리 내 파일만 읽고 수정하세요.";
  } else if (promptChoice === 1) {
    systemPrompt = await ask("시스템 프롬프트:");
  }

  // 7. 타임아웃
  console.log("\n\x1b[33mClaude가 한 요청을 처리하는 최대 시간입니다.");
  console.log("초과하면 자동 중단됩니다. (60=1분, 300=5분, 600=10분)\x1b[0m");
  const timeoutStr = await ask("타임아웃 (초, 기본 300):");
  const timeout = Number(timeoutStr) || 300;

  // 8. 확인
  console.log("\n\x1b[32m── 프로필 요약 ──\x1b[0m");
  console.log(`이름:       ${name}`);
  console.log(`설명:       ${description}`);
  console.log(`허용 도구:  ${allowedTools.length}개`);
  console.log(`차단 도구:  ${disallowedTools.length}개`);
  console.log(`디렉토리:   ${addDirs.length > 0 ? addDirs.join(", ") : "(제한 없음)"}`);
  console.log(`프롬프트:   ${systemPrompt ? systemPrompt.slice(0, 50) + "..." : "(없음)"}`);
  console.log(`타임아웃:   ${timeout}초`);

  const confirm = await askYesNo("\n이 프로필을 저장할까요?");
  if (!confirm) {
    console.log("취소되었습니다.");
    process.exit(0);
  }

  // 9. 저장
  const profile: Record<string, unknown> = {
    description,
    claude: {
      allowed_tools: allowedTools,
      disallowed_tools: disallowedTools,
      ...(addDirs.length > 0 ? { add_dirs: addDirs } : {}),
      ...(systemPrompt ? { system_prompt: systemPrompt } : {}),
    },
    timeout,
  };

  config.profiles[name] = profile;
  writeFileSync(PROFILES_YML, stringifyYaml(config, { lineWidth: 120 }));

  console.log(`\n\x1b[32m프로필 "${name}"이 profiles.yml에 저장되었습니다.\x1b[0m`);
  console.log("데몬을 재시작하면 적용됩니다: jarvis restart");
}

function loadConfig(): { profiles: Record<string, Record<string, unknown>>; default_profile: string } {
  if (!existsSync(PROFILES_YML)) {
    return { default_profile: "observer", profiles: {} };
  }
  const content = readFileSync(PROFILES_YML, "utf-8");
  return parseYaml(content) as { profiles: Record<string, Record<string, unknown>>; default_profile: string };
}

main().catch((err) => {
  console.error("\x1b[31m오류:\x1b[0m", err.message);
  process.exit(1);
});
