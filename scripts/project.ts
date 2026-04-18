#!/usr/bin/env bun

/**
 * 프로젝트 CRUD CLI (비대화형)
 *
 * jarvis project ls
 * jarvis project add <name> --path <p> --repo <r> --profiles <a,b> [--branch dev] [--prefix feature]
 * jarvis project rm <name>
 */

import { existsSync } from "node:fs";
import {
  loadProjectsJsonc,
  saveProjectsJsonc,
  type ProjectConfig,
} from "./lib/config.js";

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

function usage(): void {
  console.log("사용법:");
  console.log("  jarvis project ls");
  console.log("  jarvis project add <name> --path <p> --repo <r> --profiles <a,b> [--branch dev] [--prefix feature]");
  console.log("  jarvis project rm <name>");
}

function cmdLs(): void {
  const config = loadProjectsJsonc();
  const entries = Object.entries(config.projects ?? {});
  if (entries.length === 0) {
    console.log(`${DIM}등록된 프로젝트가 없습니다.${RESET}`);
    return;
  }
  console.log(`\n프로젝트 목록 (${entries.length}개):\n`);
  for (const [key, p] of entries) {
    const pathMark = existsSync(p.path) ? `${GREEN}✓${RESET}` : `${RED}✗${RESET}`;
    console.log(`  ${GREEN}${key}${RESET}`);
    console.log(`    이름: ${p.name}`);
    console.log(`    ${pathMark} 경로: ${p.path}`);
    console.log(`    repo: ${p.repo ?? "(없음)"}`);
    console.log(`    부모 브랜치: ${p.parent_branch}`);
    console.log(`    접두사: ${p.branch_prefix}`);
    console.log(`    프로필: ${p.allowed_profiles.join(", ")}`);
    console.log("");
  }
}

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      args[a.slice(2)] = argv[i + 1] ?? "";
      i++;
    }
  }
  return args;
}

function cmdAdd(name: string, argv: string[]): void {
  if (!name) {
    console.error(`${RED}프로젝트 키를 입력하세요.${RESET}`);
    usage();
    process.exit(1);
  }

  const args = parseArgs(argv);
  if (!args.path || !args.profiles) {
    console.error(`${RED}--path, --profiles는 필수입니다.${RESET}`);
    usage();
    process.exit(1);
  }

  const config = loadProjectsJsonc();
  if (config.projects[name]) {
    console.error(`${RED}이미 존재하는 프로젝트: ${name}${RESET}`);
    process.exit(1);
  }

  const project: ProjectConfig = {
    name: args.name ?? name,
    path: args.path,
    parent_branch: args.branch ?? "dev",
    repo: args.repo,
    allowed_profiles: args.profiles.split(",").map((s) => s.trim()).filter(Boolean),
    branch_prefix: args.prefix ?? "feature",
  };

  config.projects[name] = project;
  saveProjectsJsonc(config);

  console.log(`${GREEN}프로젝트 추가됨: ${name}${RESET}`);
  if (!existsSync(project.path)) {
    console.log(`${DIM}경고: ${project.path} 디렉토리가 존재하지 않습니다.${RESET}`);
  }
}

function cmdRm(name: string): void {
  if (!name) {
    console.error(`${RED}프로젝트 키를 입력하세요.${RESET}`);
    process.exit(1);
  }

  const config = loadProjectsJsonc();
  if (!config.projects[name]) {
    console.error(`${RED}존재하지 않는 프로젝트: ${name}${RESET}`);
    process.exit(1);
  }

  delete config.projects[name];
  saveProjectsJsonc(config);
  console.log(`${GREEN}프로젝트 삭제됨: ${name}${RESET}`);
}

function main(): void {
  const [cmd, ...rest] = process.argv.slice(2);

  if (cmd === "ls" || !cmd) return cmdLs();
  if (cmd === "add") return cmdAdd(rest[0] ?? "", rest.slice(1));
  if (cmd === "rm") return cmdRm(rest[0] ?? "");

  usage();
  process.exit(1);
}

main();
