import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { Database } from "bun:sqlite";
import { DeclarativeMemoryStore } from "./declarative";
import { ProceduralMemoryStore } from "./procedural";
import { SessionStore } from "./session-search";
import { DreamingEngine } from "./dreaming";
import { UserProfileStore } from "./user-profile";

// 테스트용 인메모리 DB 사용
let db: Database;

beforeAll(() => {
  db = new Database(":memory:");
  db.run("PRAGMA journal_mode = WAL");
  db.run("PRAGMA foreign_keys = ON");

  // 마이그레이션 수동 실행 (db.ts의 migrate와 동일)
  // v1: 선언적 메모리
  db.run(`
    CREATE TABLE declarative_memory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT NOT NULL,
      content TEXT NOT NULL,
      tags TEXT DEFAULT '[]',
      user_id TEXT DEFAULT 'owner',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      archived INTEGER DEFAULT 0
    )
  `);
  db.run(`
    CREATE VIRTUAL TABLE declarative_memory_fts USING fts5(
      key, content, tags,
      content='declarative_memory', content_rowid='id'
    )
  `);
  db.run(`CREATE TRIGGER declarative_memory_ai AFTER INSERT ON declarative_memory BEGIN
    INSERT INTO declarative_memory_fts(rowid, key, content, tags) VALUES (new.id, new.key, new.content, new.tags);
  END`);
  db.run(`CREATE TRIGGER declarative_memory_au AFTER UPDATE ON declarative_memory BEGIN
    INSERT INTO declarative_memory_fts(declarative_memory_fts, rowid, key, content, tags) VALUES ('delete', old.id, old.key, old.content, old.tags);
    INSERT INTO declarative_memory_fts(rowid, key, content, tags) VALUES (new.id, new.key, new.content, new.tags);
  END`);
  db.run(`CREATE TRIGGER declarative_memory_ad AFTER DELETE ON declarative_memory BEGIN
    INSERT INTO declarative_memory_fts(declarative_memory_fts, rowid, key, content, tags) VALUES ('delete', old.id, old.key, old.content, old.tags);
  END`);

  // v2: 절차적 메모리
  db.run(`
    CREATE TABLE procedural_memory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      skill_name TEXT NOT NULL UNIQUE,
      skill_path TEXT NOT NULL,
      description TEXT NOT NULL,
      tags TEXT DEFAULT '[]',
      usage_count INTEGER DEFAULT 0,
      last_used_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);
  db.run(`
    CREATE VIRTUAL TABLE procedural_memory_fts USING fts5(
      skill_name, description, tags,
      content='procedural_memory', content_rowid='id'
    )
  `);
  db.run(`CREATE TRIGGER procedural_memory_ai AFTER INSERT ON procedural_memory BEGIN
    INSERT INTO procedural_memory_fts(rowid, skill_name, description, tags) VALUES (new.id, new.skill_name, new.description, new.tags);
  END`);
  db.run(`CREATE TRIGGER procedural_memory_au AFTER UPDATE ON procedural_memory BEGIN
    INSERT INTO procedural_memory_fts(procedural_memory_fts, rowid, skill_name, description, tags) VALUES ('delete', old.id, old.skill_name, old.description, old.tags);
    INSERT INTO procedural_memory_fts(rowid, skill_name, description, tags) VALUES (new.id, new.skill_name, new.description, new.tags);
  END`);

  // v3: 세션
  db.run(`
    CREATE TABLE sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL UNIQUE,
      user_id TEXT DEFAULT 'owner',
      summary TEXT,
      tool_count INTEGER DEFAULT 0,
      file_changes INTEGER DEFAULT 0,
      started_at TEXT DEFAULT (datetime('now')),
      ended_at TEXT,
      tags TEXT DEFAULT '[]'
    )
  `);
  db.run(`
    CREATE TABLE session_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      timestamp TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (session_id) REFERENCES sessions(session_id)
    )
  `);
  db.run(`
    CREATE VIRTUAL TABLE session_messages_fts USING fts5(content, content='session_messages', content_rowid='id')
  `);
  db.run(`CREATE TRIGGER session_messages_ai AFTER INSERT ON session_messages BEGIN
    INSERT INTO session_messages_fts(rowid, content) VALUES (new.id, new.content);
  END`);

  // v4: 프로파일
  db.run(`
    CREATE TABLE user_profiles (
      user_id TEXT PRIMARY KEY,
      name TEXT,
      profile TEXT DEFAULT 'observer',
      channel TEXT,
      paired INTEGER DEFAULT 0,
      paired_at TEXT,
      personality TEXT DEFAULT '{}',
      preferences TEXT DEFAULT '{}',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // v5: Dreaming 로그
  db.run(`
    CREATE TABLE dreaming_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action TEXT NOT NULL,
      details TEXT NOT NULL,
      memories_affected INTEGER DEFAULT 0,
      executed_at TEXT DEFAULT (datetime('now'))
    )
  `);
});

afterAll(() => {
  db.close();
});

// ============================================================
// 선언적 메모리 테스트
// ============================================================

describe("DeclarativeMemoryStore", () => {
  test("Given 메모리 저장 When 같은 키로 조회 Then 저장된 내용 반환", () => {
    const store = new DeclarativeMemoryStore(db);
    const saved = store.save("user_role", "백엔드 개발자", ["backend", "kotlin"]);

    expect(saved.key).toBe("user_role");
    expect(saved.content).toBe("백엔드 개발자");
    expect(saved.tags).toEqual(["backend", "kotlin"]);
  });

  test("Given 동일 키 저장 When 다시 저장 Then 업데이트 (UPSERT)", () => {
    const store = new DeclarativeMemoryStore(db);
    store.save("user_role", "백엔드 개발자", ["backend"]);
    const updated = store.save("user_role", "풀스택 개발자", ["fullstack"]);

    expect(updated.content).toBe("풀스택 개발자");
    expect(updated.tags).toEqual(["fullstack"]);
  });

  test("Given 여러 메모리 저장 When FTS5 검색 Then 관련 결과 반환", () => {
    const store = new DeclarativeMemoryStore(db);
    store.save("tech_stack", "Kotlin Spring Boot 사용", ["kotlin", "spring"]);
    store.save("editor", "IntelliJ IDEA 사용", ["ide"]);

    const results = store.search("Kotlin");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].content).toContain("Kotlin");
  });

  test("Given 메모리 아카이브 When 검색 Then 아카이브된 결과 제외", () => {
    const store = new DeclarativeMemoryStore(db);
    const mem = store.save("temp_data", "임시 데이터", []);
    store.archive(mem.id);

    const result = store.getByKey("temp_data");
    expect(result).toBeNull();
  });
});

// ============================================================
// 절차적 메모리 테스트
// ============================================================

describe("ProceduralMemoryStore", () => {
  test("Given 스킬 등록 When 이름으로 조회 Then 스킬 정보 반환", () => {
    const store = new ProceduralMemoryStore(db);
    const skill = store.register(
      "deploy-workflow",
      "~/.claude/skills/deploy/SKILL.md",
      "배포 자동화 스킬",
      ["deploy", "ci"],
    );

    expect(skill.skill_name).toBe("deploy-workflow");
    expect(skill.usage_count).toBe(0);
  });

  test("Given 스킬 사용 기록 When 조회 Then 사용 횟수 증가", () => {
    const store = new ProceduralMemoryStore(db);
    store.register("test-skill", "/path", "테스트 스킬", []);
    store.recordUsage("test-skill");
    store.recordUsage("test-skill");

    const skill = store.getByName("test-skill");
    expect(skill!.usage_count).toBe(2);
    expect(skill!.last_used_at).not.toBeNull();
  });

  test("Given 여러 스킬 등록 When FTS5 검색 Then 관련 스킬 반환", () => {
    const store = new ProceduralMemoryStore(db);
    store.register("kotlin-expert", "/path", "Kotlin 코드 품질 전문가", ["kotlin"]);

    const results = store.search("Kotlin");
    expect(results.length).toBeGreaterThan(0);
  });
});

// ============================================================
// 세션 검색 테스트
// ============================================================

describe("SessionStore", () => {
  test("Given 세션 시작 When 메시지 추가 후 검색 Then 매칭 결과 반환", () => {
    const store = new SessionStore(db);
    store.startSession("session-001");
    store.addMessage("session-001", "user", "Spring Boot에서 JPA N+1 문제를 해결하고 싶어");
    store.addMessage("session-001", "assistant", "fetch join이나 EntityGraph를 사용하세요");
    store.endSession("session-001", "JPA N+1 문제 해결", 5, 2);

    const results = store.search("JPA");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].session_id).toBe("session-001");
  });

  test("Given 여러 세션 When 최근 목록 조회 Then 시간순 반환", () => {
    const store = new SessionStore(db);
    store.startSession("session-002");
    store.startSession("session-003");

    const recent = store.listRecent(5);
    expect(recent.length).toBeGreaterThanOrEqual(2);
  });
});

// ============================================================
// Dreaming 테스트
// ============================================================

describe("DreamingEngine", () => {
  test("Given Dreaming 실행 When 결과 조회 Then 리포트 반환", () => {
    const engine = new DreamingEngine(db);
    const report = engine.dream("owner", 90);

    expect(report).toHaveProperty("duplicates_merged");
    expect(report).toHaveProperty("stale_archived");
    expect(report).toHaveProperty("total_affected");
    expect(report).toHaveProperty("actions");
  });

  test("Given Dreaming 실행 후 When 히스토리 조회 Then 로그 존재", () => {
    const engine = new DreamingEngine(db);
    engine.dream();
    const history = engine.history(5);

    expect(history.length).toBeGreaterThan(0);
    expect(history[0].action).toBe("full_cycle");
  });
});

// ============================================================
// 유저 프로파일 테스트
// ============================================================

describe("UserProfileStore", () => {
  test("Given Owner 프로파일 When 조회 Then 자동 생성됨", () => {
    const store = new UserProfileStore(db);
    const owner = store.getOwner();

    expect(owner.user_id).toBe("owner");
    expect(owner.profile).toBe("owner");
  });

  test("Given 새 유저 생성 When 개인화 업데이트 Then 반영됨", () => {
    const store = new UserProfileStore(db);
    store.create("telegram:12345", "telegram", "김철수");

    const updated = store.update("telegram:12345", {
      profile: "developer",
      personality: { tone: "casual", nickname: "자비스" },
    });

    expect(updated!.profile).toBe("developer");
    expect(updated!.personality.tone).toBe("casual");
    expect(updated!.personality.nickname).toBe("자비스");
  });

  test("Given 여러 유저 When 프로필별 목록 Then 필터링됨", () => {
    const store = new UserProfileStore(db);
    store.create("discord:111", "discord", "유저A");
    store.update("discord:111", { profile: "reviewer" });

    const reviewers = store.listByProfile("reviewer");
    expect(reviewers.length).toBeGreaterThan(0);
  });
});
