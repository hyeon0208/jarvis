import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { atomicWriteFile, atomicWriteJson } from "./atomic.js";

const WORK_DIR = join(tmpdir(), `jarvis-atomic-test-${process.pid}`);

describe("atomic: atomicWriteFile / atomicWriteJson", () => {
  beforeEach(() => {
    if (existsSync(WORK_DIR)) rmSync(WORK_DIR, { recursive: true });
    mkdirSync(WORK_DIR, { recursive: true });
  });
  afterEach(() => {
    if (existsSync(WORK_DIR)) rmSync(WORK_DIR, { recursive: true });
  });

  test("Given 새 경로 When atomicWriteFile Then 파일이 생성되고 내용 일치", () => {
    const path = join(WORK_DIR, "sample.txt");
    atomicWriteFile(path, "hello world");
    expect(readFileSync(path, "utf-8")).toBe("hello world");
  });

  test("Given 기존 파일 When atomicWriteFile Then 내용이 완전 교체", () => {
    const path = join(WORK_DIR, "replace.txt");
    writeFileSync(path, "old content");
    atomicWriteFile(path, "new content");
    expect(readFileSync(path, "utf-8")).toBe("new content");
  });

  test("Given 연속 10회 write When atomicWriteJson Then 마지막 값만 보이고 JSON.parse 성공", () => {
    const path = join(WORK_DIR, "rapid.json");
    for (let i = 0; i < 10; i++) {
      atomicWriteJson(path, { counter: i, payload: "x".repeat(100) });
    }
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as { counter: number };
    expect(parsed.counter).toBe(9);
  });

  test("Given atomicWriteJson 후 디렉토리 When 조회 Then 임시 파일이 남지 않음", () => {
    const path = join(WORK_DIR, "cleanup.json");
    atomicWriteJson(path, { ok: true });
    const files = readdirSync(WORK_DIR);
    // 최종 파일만 있어야 함
    expect(files).toEqual(["cleanup.json"]);
  });

  test("Given 쓸 수 없는 경로 When atomicWriteFile Then 에러 throw + 최종 파일 미생성", () => {
    const path = join(WORK_DIR, "nested", "missing", "file.txt");
    expect(() => atomicWriteFile(path, "data")).toThrow();
    expect(existsSync(path)).toBe(false);
  });
});
