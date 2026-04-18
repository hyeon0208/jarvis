#!/usr/bin/env bun

/**
 * 프로젝트 추가 마법사
 *
 * 사용법: jarvis add-project
 */

import { existsSync, mkdirSync } from "node:fs";
import { ask, askYesNo, askMultiChoice } from "./lib/prompt.js";
import {
  loadProjectsJsonc,
  saveProjectsJsonc,
  loadProfilesYml,
  type ProjectConfig,
} from "./lib/config.js";

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const RESET = "\x1b[0m";

async function main(): Promise<void> {
  console.log(`${GREEN}╔══════════════════════════════════════╗${RESET}`);
  console.log(`${GREEN}║    프로젝트 추가 마법사                ║${RESET}`);
  console.log(`${GREEN}╚══════════════════════════════════════╝${RESET}`);

  console.log(`\n${YELLOW}프로젝트는 /dev 워크플로우에서 사용할 git 저장소입니다.${RESET}`);

  const key = await ask("프로젝트 키 (영문, 예: backend):");
  if (!key || !/^[a-z][a-z0-9_-]*$/.test(key)) {
    console.error(`${RED}영문 소문자로 시작해야 합니다.${RESET}`);
    process.exit(1);
  }

  const config = loadProjectsJsonc();
  if (config.projects[key]) {
    console.error(`${RED}이미 존재: ${key}${RESET}`);
    process.exit(1);
  }

  const name = await ask("프로젝트 이름 (표시용):");

  console.log(`\n${YELLOW}로컬 경로 — git clone된 디렉토리 경로${RESET}`);
  const path = await ask("경로:");
  if (!existsSync(path)) {
    if (await askYesNo(`${path}이 없습니다. 생성할까요?`)) {
      mkdirSync(path, { recursive: true });
      console.log(`${GREEN}디렉토리 생성됨${RESET}`);
    }
  }

  console.log(`\n${YELLOW}GitHub 저장소 (PR/이슈 생성용, 선택)${RESET}`);
  const repo = await ask("owner/repo 형식 (생략 가능):");

  const parentBranch = (await ask("부모 브랜치 (기본 dev):")) || "dev";
  const branchPrefix = (await ask("브랜치 접두사 (기본 feature):")) || "feature";

  // 프로필 선택
  const profilesConfig = loadProfilesYml();
  const profileNames = Object.keys(profilesConfig.profiles);
  const selected = await askMultiChoice("이 프로젝트에 접근 가능한 프로필을 선택하세요:", profileNames);
  const allowedProfiles = selected.map((i) => profileNames[i]);

  const project: ProjectConfig = {
    name: name || key,
    path,
    parent_branch: parentBranch,
    repo: repo || undefined,
    allowed_profiles: allowedProfiles,
    branch_prefix: branchPrefix,
  };

  console.log(`\n${GREEN}── 요약 ──${RESET}`);
  console.log(JSON.stringify(project, null, 2));

  if (!(await askYesNo("\n저장할까요?"))) {
    console.log("취소되었습니다.");
    process.exit(0);
  }

  config.projects[key] = project;
  saveProjectsJsonc(config);
  console.log(`${GREEN}프로젝트 추가됨: ${key}${RESET}`);
}

main().catch((err) => {
  console.error(`${RED}오류: ${err.message}${RESET}`);
  process.exit(1);
});
