#!/usr/bin/env bun

/**
 * Jarvis IntentGate Hook (UserPromptSubmit)
 *
 * 사용자 프롬프트를 분석해 카테고리/복잡도를 판정하고,
 * standard/deep 복잡도면 메모리·세션을 미리 검색해 컨텍스트로 주입합니다.
 *
 * 동작:
 * 1. stdin에서 사용자 프롬프트 읽기 (Claude Code가 JSON으로 전달)
 * 2. 정규식 키워드 매칭으로 빠른 분류 (LLM 호출 X, latency 거의 0)
 * 3. quick(인사/한 줄 잡담)이면 통과
 * 4. standard/deep이면 SQLite FTS5 직접 조회 → additionalContext 생성
 * 5. JSON 응답을 stdout으로 (Claude Code가 모델 컨텍스트에 주입)
 *
 * 실패 시 안전 통과 (stderr만 찍고 빈 응답).
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { Database } from "bun:sqlite";

const HOME = process.env.HOME ?? "~";
const DB_PATH = join(HOME, ".jarvis", "data", "memory.db");

// ---- 카테고리/복잡도 분류 (키워드 기반) ----

const CATEGORY_KEYWORDS = {
  coding: /구현|만들어|만들|추가|개발|작성|코드|기능/,
  debugging: /버그|에러|오류|안됨|왜|수정|고쳐|문제|이상/,
  refactoring: /리팩토링|개선|정리|클린|구조|간결/,
  research: /찾아|조사|어떻게|뭐가|뭐야|알려|설명|차이|비교/,
  review: /리뷰|검토|PR|코드리뷰|분석/,
  design: /설계|아키텍처|ERD|다이어그램/,
  devops: /배포|CI|CD|도커|쿠버|파이프라인/,
  test: /테스트|검증|TDD|커버리지/,
};

const QUICK_PATTERNS = [
  /^(안녕|hi|hello|ㅎㅇ|반가워|고마워|땡큐|thanks|ok|okay|네|예|응|어|아니|아뇨)\b/i,
  /^[!-~ㄱ-ㅎㅏ-ㅣ]{1,8}$/, // 매우 짧은 입력
];

function classify(prompt) {
  const text = (prompt || "").trim();
  if (!text) return { category: "unknown", complexity: "quick" };

  // 인사/짧은 잡담은 quick
  for (const pat of QUICK_PATTERNS) {
    if (pat.test(text)) return { category: "smalltalk", complexity: "quick" };
  }

  // 카테고리 매칭
  let category = "question";
  let matched = false;
  for (const [cat, pat] of Object.entries(CATEGORY_KEYWORDS)) {
    if (pat.test(text)) {
      category = cat;
      matched = true;
      break;
    }
  }

  // 복잡도 추정 — 길이 + 키워드 수
  const wordCount = text.split(/\s+/).length;
  const heavyKeywords = /구현|개발|리팩토링|아키텍처|마이그레이션|배포|시스템|전체|모든/;

  let complexity = "standard";
  if (wordCount > 30 || heavyKeywords.test(text)) complexity = "deep";
  // 매우 짧으면서 카테고리 매칭도 안 된 경우만 quick
  else if (wordCount <= 3 && !matched) complexity = "quick";

  return { category, complexity };
}

// ---- FTS5 검색 헬퍼 ----

function ftsEscape(query) {
  // 한국어/영문 토큰만 추출, 따옴표 처리
  const tokens = query
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2)
    .slice(0, 6);
  if (tokens.length === 0) return null;
  return tokens.map((t) => `"${t}"`).join(" OR ");
}

// 호출 컨텍스트의 user_id로 메모리를 격리합니다.
// - Owner 로컬 chat: jarvis.sh가 JARVIS_USER_ID="owner"를 주입
// - 외부 채널 (Telegram/Slack/Discord): 데몬이 spawn 시 "slack:U123" 같은 값 주입
// - 환경변수가 없으면 안전하게 owner로 fallback
const SCOPE_USER_ID = process.env.JARVIS_USER_ID || "owner";

function searchDeclarative(db, query, limit = 3) {
  const fts = ftsEscape(query);
  if (!fts) return [];
  try {
    return db
      .query(
        `SELECT m.key, m.content
         FROM declarative_memory_fts f
         JOIN declarative_memory m ON m.id = f.rowid
         WHERE declarative_memory_fts MATCH ?
           AND m.user_id = ?
           AND m.archived = 0
         ORDER BY rank LIMIT ?`,
      )
      .all(fts, SCOPE_USER_ID, limit);
  } catch {
    return [];
  }
}

function searchSessions(db, query, limit = 2) {
  const fts = ftsEscape(query);
  if (!fts) return [];
  try {
    return db
      .query(
        `SELECT s.session_id, s.summary
         FROM session_messages_fts f
         JOIN session_messages sm ON sm.id = f.rowid
         JOIN sessions s ON s.session_id = sm.session_id
         WHERE session_messages_fts MATCH ?
           AND s.user_id = ?
         GROUP BY s.session_id
         LIMIT ?`,
      )
      .all(fts, SCOPE_USER_ID, limit);
  } catch {
    return [];
  }
}

function searchProcedural(db, query, limit = 3) {
  const fts = ftsEscape(query);
  if (!fts) return [];
  try {
    return db
      .query(
        `SELECT skill_name, description
         FROM procedural_memory_fts f
         JOIN procedural_memory m ON m.id = f.rowid
         WHERE procedural_memory_fts MATCH ?
         ORDER BY rank LIMIT ?`,
      )
      .all(fts, limit);
  } catch {
    return [];
  }
}

// ---- 컨텍스트 빌더 ----

function buildContext(prompt, intent) {
  if (!existsSync(DB_PATH)) return null;

  const db = new Database(DB_PATH, { readonly: true });
  try {
    const decl = searchDeclarative(db, prompt);
    const sess = searchSessions(db, prompt);
    const proc = searchProcedural(db, prompt);

    if (decl.length === 0 && sess.length === 0 && proc.length === 0) return null;

    const lines = [
      `[Jarvis IntentGate] user_id=${SCOPE_USER_ID}, 카테고리=${intent.category}, 복잡도=${intent.complexity}. 다음 컨텍스트가 메모리에서 자동 로딩되었습니다 (해당 유저 격리):`,
    ];

    if (decl.length > 0) {
      lines.push("\n## 관련 사실/선호도 (선언적 메모리)");
      for (const r of decl) lines.push(`- ${r.key}: ${r.content}`);
    }
    if (sess.length > 0) {
      lines.push("\n## 유사한 과거 작업 (세션)");
      for (const r of sess) lines.push(`- ${r.session_id}: ${r.summary ?? "(요약 없음)"}`);
    }
    if (proc.length > 0) {
      lines.push("\n## 관련 스킬 (절차적 메모리)");
      for (const r of proc) lines.push(`- ${r.skill_name}: ${r.description}`);
    }

    return lines.join("\n");
  } finally {
    db.close();
  }
}

// ---- 메인 ----

function readStdin() {
  try {
    return readFileSync(0, "utf-8");
  } catch {
    return "";
  }
}

function main() {
  const raw = readStdin();
  if (!raw) {
    process.stdout.write(JSON.stringify({}));
    return;
  }

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    process.stdout.write(JSON.stringify({}));
    return;
  }

  const prompt = payload.prompt ?? payload.user_prompt ?? "";
  const intent = classify(prompt);

  // quick은 컨텍스트 주입 없이 통과 (latency 0)
  if (intent.complexity === "quick") {
    process.stdout.write(JSON.stringify({}));
    return;
  }

  const context = buildContext(prompt, intent);
  if (!context) {
    process.stdout.write(JSON.stringify({}));
    return;
  }

  // Claude Code UserPromptSubmit 훅 응답 형식: hookSpecificOutput.additionalContext
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "UserPromptSubmit",
        additionalContext: context,
      },
    }),
  );
}

try {
  main();
} catch (err) {
  // 훅 실패가 사용자 입력을 막지 않도록 안전 통과
  process.stderr.write(`[Jarvis IntentGate] 실패: ${err?.message ?? err}\n`);
  process.stdout.write(JSON.stringify({}));
}
