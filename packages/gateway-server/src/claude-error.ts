/**
 * claude CLI 비정상 종료를 사용자/로그용 한국어 메시지로 변환.
 *
 * 왜 필요한가:
 *   exit code 숫자만으로는 원인 파악이 불가능하다.
 *   특히 silent failure(빈 stderr + exit 1)가 자주 발생하는데,
 *   진짜 단서가 stdout에 들어 있는 경우가 있어 양쪽을 모두 본다.
 */

export interface ClaudeErrorContext {
  code: number | null;
  stderr: string;
  stdout: string;
}

export interface ClaudeErrorResult {
  /** 채널/사용자에게 그대로 전달할 한국어 메시지 */
  userMessage: string;
  /** 데몬 로그에 남길 한 줄 요약 (사유 + 단서) */
  logSummary: string;
}

const KNOWN_PATTERNS: Array<{
  test: RegExp;
  describe: (m: RegExpMatchArray) => string;
}> = [
  {
    test: /Session ID .* is already in use/i,
    describe: () => "같은 세션에서 다른 작업이 이미 진행 중입니다 (잠시 후 다시 시도하세요)",
  },
  {
    test: /No conversation found with session ID: ([\w-]+)/i,
    describe: (m) =>
      `이전 대화 세션(${m[1].slice(0, 8)}...)을 찾을 수 없습니다. /clear 후 다시 시도하면 새 세션으로 시작됩니다`,
  },
  {
    test: /unknown option '(.+?)'/i,
    describe: (m) =>
      `프롬프트가 CLI 옵션으로 오인되었습니다: ${m[1]} (관리자 확인 필요)`,
  },
  {
    test: /401|unauthor/i,
    describe: () => "Claude 인증 실패 — API 키 또는 구독 상태를 확인하세요",
  },
  {
    test: /rate.?limit|\b429\b/i,
    describe: () => "Claude API 호출 한도 초과 — 잠시 후 다시 시도하세요",
  },
  {
    test: /quota|usage limit/i,
    describe: () => "Claude 사용량 한도에 도달했습니다",
  },
  {
    test: /ENOENT|command not found/i,
    describe: () => "claude 실행 파일을 찾지 못했습니다 (PATH/설치 상태 확인)",
  },
  {
    test: /ECONNREFUSED|ENETUNREACH|ETIMEDOUT/i,
    describe: () => "외부 호출 네트워크 오류",
  },
];

const EXIT_CODE_MESSAGES: Record<number, string> = {
  124: "응답 시간이 너무 길어 강제 종료되었습니다 (timeout)",
  130: "사용자가 중단했습니다 (Ctrl+C)",
  137: "메모리 부족으로 종료되었습니다 (SIGKILL/OOM)",
  139: "프로세스 충돌 (segmentation fault)",
  143: "외부 신호로 강제 종료되었습니다 (SIGTERM, 데몬 재시작 등)",
};

function pickFirstMeaningfulLine(text: string, max = 200): string {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("Warning:"));
  return (lines[0] ?? "").slice(0, max);
}

export function formatClaudeError(ctx: ClaudeErrorContext): ClaudeErrorResult {
  const { code, stderr, stdout } = ctx;
  const combined = `${stderr}\n${stdout}`;

  for (const pattern of KNOWN_PATTERNS) {
    const match = combined.match(pattern.test);
    if (match) {
      const reason = pattern.describe(match);
      return {
        userMessage: `claude 호출 실패 — ${reason}`,
        logSummary: `code=${code}, 사유=${reason}, snippet=${pickFirstMeaningfulLine(combined, 120)}`,
      };
    }
  }

  if (code !== null && EXIT_CODE_MESSAGES[code]) {
    const reason = EXIT_CODE_MESSAGES[code];
    return {
      userMessage: `claude 호출 실패 — ${reason}`,
      logSummary: `code=${code}, 사유=${reason}`,
    };
  }

  const stderrLine = pickFirstMeaningfulLine(stderr);
  const stdoutLine = pickFirstMeaningfulLine(stdout);
  const detail = stderrLine || stdoutLine;
  if (detail) {
    return {
      userMessage: `claude 호출 실패 (코드: ${code}) — ${detail}`,
      logSummary: `code=${code}, stderr=${stderrLine.slice(0, 80)}, stdout=${stdoutLine.slice(0, 80)}`,
    };
  }

  return {
    userMessage:
      `claude가 사유 없이 종료되었습니다 (코드: ${code}). ` +
      `같은 요청을 한 번 더 시도해 보고, 반복되면 'jarvis logs 30'으로 데몬 로그를 확인하세요.`,
    logSummary: `code=${code}, stderr=<empty>, stdout=<empty>`,
  };
}
