/**
 * 사용자별 메모리 격리 통합 테스트
 *
 * 검증 포인트:
 * 1. resolveUserId — explicit > env JARVIS_USER_ID > "owner" 우선순위
 * 2. DeclarativeMemoryStore.search — user_id로 결과 분리
 * 3. SessionStore.search — user_id로 결과 분리
 * 4. DreamingEngine.dream — user_id별 독립 정리
 */

import { describe, test, expect, beforeAll, beforeEach, afterAll } from "bun:test";
import { Database } from "bun:sqlite";
import { DeclarativeMemoryStore } from "./declarative";
import { SessionStore } from "./session-search";
import { DreamingEngine } from "./dreaming";
import { resolveUserId } from "./memory-config";

let db: Database;

beforeAll(() => {
  db = new Database(":memory:");
  db.run("PRAGMA journal_mode = WAL");
  db.run("PRAGMA foreign_keys = ON");

  // declarative_memory + FTS
  db.run(`CREATE TABLE declarative_memory (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT NOT NULL,
    content TEXT NOT NULL,
    tags TEXT DEFAULT '[]',
    user_id TEXT DEFAULT 'owner',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    archived INTEGER DEFAULT 0
  )`);
  db.run(`CREATE VIRTUAL TABLE declarative_memory_fts USING fts5(
    key, content, tags,
    content='declarative_memory', content_rowid='id'
  )`);
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

  // sessions + session_messages + FTS
  db.run(`CREATE TABLE sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL UNIQUE,
    user_id TEXT DEFAULT 'owner',
    summary TEXT,
    tool_count INTEGER DEFAULT 0,
    file_changes INTEGER DEFAULT 0,
    started_at TEXT DEFAULT (datetime('now')),
    ended_at TEXT,
    tags TEXT DEFAULT '[]'
  )`);
  db.run(`CREATE TABLE session_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    timestamp TEXT DEFAULT (datetime('now'))
  )`);
  db.run(`CREATE VIRTUAL TABLE session_messages_fts USING fts5(
    content,
    content='session_messages', content_rowid='id'
  )`);
  db.run(`CREATE TRIGGER session_messages_ai AFTER INSERT ON session_messages BEGIN
    INSERT INTO session_messages_fts(rowid, content) VALUES (new.id, new.content);
  END`);

  // dreaming_log
  db.run(`CREATE TABLE dreaming_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    action TEXT NOT NULL,
    details TEXT NOT NULL,
    memories_affected INTEGER DEFAULT 0,
    executed_at TEXT DEFAULT (datetime('now'))
  )`);
});

beforeEach(() => {
  // 각 테스트 전에 데이터 정리
  db.run("DELETE FROM declarative_memory");
  db.run("DELETE FROM session_messages");
  db.run("DELETE FROM sessions");
  db.run("DELETE FROM dreaming_log");
  delete process.env.JARVIS_USER_ID;
});

afterAll(() => {
  db.close();
});

describe("resolveUserId 우선순위", () => {
  test("explicit 인자가 최우선", () => {
    process.env.JARVIS_USER_ID = "slack:UENV";
    expect(resolveUserId("telegram:9999")).toBe("telegram:9999");
  });

  test("explicit 없으면 환경변수 사용", () => {
    process.env.JARVIS_USER_ID = "slack:U07ABC";
    expect(resolveUserId()).toBe("slack:U07ABC");
  });

  test("explicit이 빈 문자열이면 환경변수 fallback", () => {
    process.env.JARVIS_USER_ID = "discord:12345";
    expect(resolveUserId("")).toBe("discord:12345");
    expect(resolveUserId("   ")).toBe("discord:12345");
  });

  test("환경변수도 없으면 owner default", () => {
    expect(resolveUserId()).toBe("owner");
  });

  test("환경변수가 빈 문자열이면 owner default", () => {
    process.env.JARVIS_USER_ID = "";
    expect(resolveUserId()).toBe("owner");
  });
});

describe("선언적 메모리 user_id 격리", () => {
  test("같은 key지만 user_id가 다르면 별개 레코드", () => {
    const store = new DeclarativeMemoryStore(db);
    store.save("tech_stack", "Kotlin", [], "owner");
    store.save("tech_stack", "Python", [], "telegram:9999");
    store.save("tech_stack", "TypeScript", [], "slack:U07ABC");

    expect(store.count("owner")).toBe(1);
    expect(store.count("telegram:9999")).toBe(1);
    expect(store.count("slack:U07ABC")).toBe(1);
    expect(store.count()).toBe(3); // 전체
  });

  test("search는 user_id로 격리", () => {
    const store = new DeclarativeMemoryStore(db);
    store.save("tech_stack", "Kotlin Spring", [], "owner");
    store.save("tech_stack", "Python Django", [], "telegram:9999");

    const ownerResults = store.search("Spring", "owner");
    const telegramResults = store.search("Django", "telegram:9999");

    expect(ownerResults).toHaveLength(1);
    expect(ownerResults[0].content).toBe("Kotlin Spring");
    expect(telegramResults).toHaveLength(1);
    expect(telegramResults[0].content).toBe("Python Django");

    // owner가 telegram의 키워드로 검색해도 결과 없음
    expect(store.search("Django", "owner")).toHaveLength(0);
  });

  test("listByUser는 해당 유저 것만", () => {
    const store = new DeclarativeMemoryStore(db);
    store.save("a", "owner-a", [], "owner");
    store.save("b", "owner-b", [], "owner");
    store.save("a", "slack-a", [], "slack:U07ABC");

    expect(store.listByUser("owner")).toHaveLength(2);
    expect(store.listByUser("slack:U07ABC")).toHaveLength(1);
  });
});

describe("세션 검색 user_id 격리", () => {
  test("search(query, limit, userId)로 분리", () => {
    const store = new SessionStore(db);
    store.startSession("sess-owner", "owner");
    store.addMessage("sess-owner", "user", "JPA N+1 문제 해결법");

    store.startSession("sess-telegram", "telegram:9999");
    store.addMessage("sess-telegram", "user", "JPA fetch join 적용");

    const ownerHits = store.search("JPA", 5, "owner");
    const telegramHits = store.search("JPA", 5, "telegram:9999");

    expect(ownerHits).toHaveLength(1);
    expect(ownerHits[0].session_id).toBe("sess-owner");
    expect(telegramHits).toHaveLength(1);
    expect(telegramHits[0].session_id).toBe("sess-telegram");

    // userId 미지정 시 전체 검색 (기존 동작 유지)
    expect(store.search("JPA", 5)).toHaveLength(2);
  });
});

describe("Dreaming user_id별 독립 처리", () => {
  test("user_id별 중복 병합이 다른 유저에게 영향 없음", () => {
    const store = new DeclarativeMemoryStore(db);
    // owner의 같은 key 중복 2개
    store.save("dup_key", "v1", [], "owner");
    db.run(
      "INSERT INTO declarative_memory (key, content, user_id) VALUES (?, ?, ?)",
      ["dup_key", "v2", "owner"],
    );
    // telegram의 같은 key (owner 중복과 무관해야 함)
    store.save("dup_key", "telegramvalue", [], "telegram:9999");

    expect(store.count("owner")).toBe(2);
    expect(store.count("telegram:9999")).toBe(1);

    const dreaming = new DreamingEngine(db);
    const ownerReport = dreaming.dream("owner", 9999);

    expect(ownerReport.duplicates_merged).toBeGreaterThanOrEqual(1);
    expect(store.count("owner")).toBe(1);
    // telegram은 건드리지 않음
    expect(store.count("telegram:9999")).toBe(1);
    expect(store.search("telegramvalue", "telegram:9999")[0]?.content).toBe("telegramvalue");
  });
});
