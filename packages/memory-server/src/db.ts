import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const DATA_DIR = join(process.env.HOME ?? "~", ".jarvis", "data");
const DB_PATH = join(DATA_DIR, "memory.db");

function ensureDir(): void {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
}

export function openDatabase(): Database {
  ensureDir();
  const db = new Database(DB_PATH);

  // WAL 모드: 동시 읽기 성능 향상
  db.run("PRAGMA journal_mode = WAL");
  db.run("PRAGMA foreign_keys = ON");

  migrate(db);
  return db;
}

function migrate(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY
    )
  `);

  const row = db.query("SELECT MAX(version) as v FROM schema_version").get() as
    | { v: number | null }
    | null;
  const currentVersion = row?.v ?? 0;

  const migrations: Array<() => void> = [
    // v1: 선언적 메모리 테이블
    () => {
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
      db.run(
        "CREATE INDEX idx_decl_key ON declarative_memory(key)",
      );
      db.run(
        "CREATE INDEX idx_decl_user ON declarative_memory(user_id)",
      );

      // FTS5 인덱스: 선언적 메모리 전문 검색
      db.run(`
        CREATE VIRTUAL TABLE declarative_memory_fts USING fts5(
          key, content, tags,
          content='declarative_memory',
          content_rowid='id'
        )
      `);

      // 자동 동기화 트리거
      db.run(`
        CREATE TRIGGER declarative_memory_ai AFTER INSERT ON declarative_memory BEGIN
          INSERT INTO declarative_memory_fts(rowid, key, content, tags)
          VALUES (new.id, new.key, new.content, new.tags);
        END
      `);
      db.run(`
        CREATE TRIGGER declarative_memory_au AFTER UPDATE ON declarative_memory BEGIN
          INSERT INTO declarative_memory_fts(declarative_memory_fts, rowid, key, content, tags)
          VALUES ('delete', old.id, old.key, old.content, old.tags);
          INSERT INTO declarative_memory_fts(rowid, key, content, tags)
          VALUES (new.id, new.key, new.content, new.tags);
        END
      `);
      db.run(`
        CREATE TRIGGER declarative_memory_ad AFTER DELETE ON declarative_memory BEGIN
          INSERT INTO declarative_memory_fts(declarative_memory_fts, rowid, key, content, tags)
          VALUES ('delete', old.id, old.key, old.content, old.tags);
        END
      `);
    },

    // v2: 절차적 메모리 (스킬 인덱스)
    () => {
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
          content='procedural_memory',
          content_rowid='id'
        )
      `);

      db.run(`
        CREATE TRIGGER procedural_memory_ai AFTER INSERT ON procedural_memory BEGIN
          INSERT INTO procedural_memory_fts(rowid, skill_name, description, tags)
          VALUES (new.id, new.skill_name, new.description, new.tags);
        END
      `);
      db.run(`
        CREATE TRIGGER procedural_memory_au AFTER UPDATE ON procedural_memory BEGIN
          INSERT INTO procedural_memory_fts(procedural_memory_fts, rowid, skill_name, description, tags)
          VALUES ('delete', old.id, old.skill_name, old.description, old.tags);
          INSERT INTO procedural_memory_fts(rowid, skill_name, description, tags)
          VALUES (new.id, new.skill_name, new.description, new.tags);
        END
      `);
    },

    // v3: 세션 기록
    () => {
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
        CREATE VIRTUAL TABLE session_messages_fts USING fts5(
          content,
          content='session_messages',
          content_rowid='id'
        )
      `);

      db.run(`
        CREATE TRIGGER session_messages_ai AFTER INSERT ON session_messages BEGIN
          INSERT INTO session_messages_fts(rowid, content)
          VALUES (new.id, new.content);
        END
      `);
    },

    // v4: 사용자 프로파일
    () => {
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
    },

    // v5: Dreaming 로그
    () => {
      db.run(`
        CREATE TABLE dreaming_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          action TEXT NOT NULL,
          details TEXT NOT NULL,
          memories_affected INTEGER DEFAULT 0,
          executed_at TEXT DEFAULT (datetime('now'))
        )
      `);
    },
  ];

  for (let i = currentVersion; i < migrations.length; i++) {
    db.transaction(() => {
      migrations[i]();
      db.run("INSERT INTO schema_version (version) VALUES (?)", [i + 1]);
    })();
  }
}
