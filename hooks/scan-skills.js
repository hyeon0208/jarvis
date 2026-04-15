#!/usr/bin/env node

/**
 * Jarvis Skill Scanner
 *
 * ~/.claude/skills/ 아래의 SKILL.md 파일들을 파싱하여
 * 절차적 메모리(SQLite)에 인덱싱합니다.
 *
 * 실행: bun run ~/jarvis/hooks/scan-skills.js
 * (bun:sqlite 사용을 위해 bun으로 실행)
 *
 * SessionStart 훅 또는 수동으로 실행합니다.
 */

const fs = require("fs");
const path = require("path");

const SKILLS_DIRS = [
  path.join(process.env.HOME || "~", ".claude", "skills"),
  path.join(process.env.HOME || "~", "jarvis", "skills"),
];

const OUTPUT_FILE = path.join(
  process.env.HOME || "~",
  ".jarvis",
  "skill-index.json",
);

function parseSkillMd(filePath) {
  try {
    const content = fs.readFileSync(filePath, "utf-8");

    // frontmatter 파싱
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (!fmMatch) return null;

    const frontmatter = fmMatch[1];
    const nameMatch = frontmatter.match(/name:\s*(.+)/);
    const descMatch = frontmatter.match(/description:\s*"?([^"]*)"?/);

    if (!nameMatch) return null;

    return {
      skill_name: nameMatch[1].trim(),
      skill_path: filePath,
      description: descMatch
        ? descMatch[1].trim()
        : `Skill: ${nameMatch[1].trim()}`,
      tags: extractTags(content),
    };
  } catch {
    return null;
  }
}

function extractTags(content) {
  const tags = new Set();

  // 언어/프레임워크 키워드 추출
  const keywords = [
    "kotlin",
    "java",
    "typescript",
    "python",
    "spring",
    "react",
    "ddd",
    "jpa",
    "docker",
    "kubernetes",
    "git",
    "test",
    "refactor",
    "security",
    "api",
    "deploy",
    "ci",
    "cd",
    "performance",
    "debug",
    "review",
    "architecture",
    "migration",
  ];

  const lower = content.toLowerCase();
  for (const kw of keywords) {
    if (lower.includes(kw)) tags.add(kw);
  }

  return [...tags];
}

function scanDirectory(dir) {
  const skills = [];

  if (!fs.existsSync(dir)) return skills;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    // .git, node_modules 등 무시
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;

    const skillFile = path.join(dir, entry.name, "SKILL.md");
    if (fs.existsSync(skillFile)) {
      const parsed = parseSkillMd(skillFile);
      if (parsed) skills.push(parsed);
    }
  }

  return skills;
}

function main() {
  const allSkills = [];

  for (const dir of SKILLS_DIRS) {
    const skills = scanDirectory(dir);
    allSkills.push(...skills);
  }

  // 인덱스 파일 저장 (MCP 서버가 읽어서 DB에 반영)
  const outDir = path.dirname(OUTPUT_FILE);
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  fs.writeFileSync(
    OUTPUT_FILE,
    JSON.stringify(
      {
        scanned_at: new Date().toISOString(),
        directories: SKILLS_DIRS,
        total: allSkills.length,
        skills: allSkills,
      },
      null,
      2,
    ),
  );

  console.log(
    `[Jarvis] 스킬 스캔 완료: ${allSkills.length}개 발견 → ${OUTPUT_FILE}`,
  );

  // 개별 스킬 출력
  for (const skill of allSkills) {
    console.log(`  - ${skill.skill_name} [${skill.tags.join(", ")}]`);
  }
}

try {
  main();
} catch (err) {
  console.error("[Jarvis] 스킬 스캔 실패:", err.message);
}
