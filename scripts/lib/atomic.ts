/**
 * 원자적 파일 쓰기 유틸.
 *
 * 왜 필요한가:
 *   `writeFileSync(path, data)`는 내부적으로 open → write → close 3단계인데,
 *   중간에 프로세스가 kill되거나 디스크가 가득 차면 **반쪽 JSON**이 디스크에 남는다.
 *   다음 읽기 시 JSON.parse 실패 → 유저 세션/페어링/크론 정보 손실.
 *   또한 두 프로세스가 동시에 같은 파일에 write하면 한쪽 결과가 날아간다(lost update).
 *
 * 해결:
 *   POSIX `rename(2)`은 원자적. `path.tmp`에 완전히 쓴 뒤 `rename(path.tmp → path)`하면
 *   리더는 **항상 이전 파일** 또는 **완성된 새 파일** 중 하나만 본다. 반쪽 상태 불가.
 *
 * 적용 대상 파일:
 *   - ~/.jarvis/users/*.json (유저 세션/페어링/크론/personality)
 *   - ~/.jarvis/data/thread-sessions.json (스레드 세션 UUID)
 *   - ~/.jarvis/data/pending-pairings.json (페어링 대기)
 *   - ~/jarvis/config/*.yml, projects.jsonc, .env (설정 파일)
 */

import { renameSync, writeFileSync, unlinkSync, existsSync } from "node:fs";

/**
 * 임시 파일을 거쳐 원자적으로 파일을 교체한다.
 *
 * @param path 최종 경로
 * @param data 기록할 문자열
 *
 * 실패 시: 임시 파일을 정리한 뒤 원본 에러를 그대로 throw.
 * 호출자는 기존 동기 writeFileSync와 동일하게 catch 가능.
 */
export function atomicWriteFile(path: string, data: string): void {
  const tmp = `${path}.tmp.${process.pid}.${Date.now()}`;
  try {
    writeFileSync(tmp, data);
    renameSync(tmp, path);
  } catch (err) {
    // 임시 파일이 남았으면 제거
    if (existsSync(tmp)) {
      try {
        unlinkSync(tmp);
      } catch {
        // 정리 실패는 조용히 — 원본 에러가 더 중요
      }
    }
    throw err;
  }
}

/**
 * JSON 직렬화 + 원자적 쓰기를 한 번에. 들여쓰기 2 기본값.
 */
export function atomicWriteJson(
  path: string,
  data: unknown,
  indent: number = 2,
): void {
  atomicWriteFile(path, JSON.stringify(data, null, indent));
}
