# 메모리 시스템

## 개요

Jarvis는 **3계층 메모리**로 세션 간 맥락을 유지합니다.
과거에 했던 작업, 사용자 선호도, 자주 쓰는 스킬을 기억하여 더 나은 응답을 제공합니다.

## 사용자별 메모리 격리

장기기억은 **요청자 user_id로 격리**됩니다. 같은 DB를 쓰지만 채널별/유저별 데이터는 서로 보이지 않습니다.

### user_id 형식

| 출처 | user_id 예시 |
|------|-------------|
| Owner 로컬 (`jarvis chat`, `jarvis ask`) | `owner` |
| Telegram | `telegram:1613476146` |
| Slack | `slack:U07ABCDEF` |
| Discord | `discord:123456789012345678` |
| Webhook | `webhook:{외부 시스템 ID}` |

각 채널 어댑터가 메시지 수신 시 자동으로 `${channel}:${external_id}` 형식을 만듭니다.

### 격리 메커니즘 (3중 안전장치)

1. **OS 환경변수 (가장 강함)**
   - 데몬이 `claude` 자식 프로세스 spawn 시 `JARVIS_USER_ID=slack:U123` 주입
   - 환경변수는 자식 프로세스(MCP 서버, 훅)에 자동 상속
   - LLM이 잊을 수 없음 — OS 레벨 보장

2. **MCP 도구 자동 fallback**
   - `jarvis_memory_save/recall/list/dream`, `jarvis_session_save/search` 모두
   - `user_id` 파라미터 누락 시 `process.env.JARVIS_USER_ID` 사용
   - 구현: `packages/memory-server/src/memory-config.ts:resolveUserId()`

3. **시스템 프롬프트 명시 (이중 안전)**
   - 데몬이 `permissions.ts:buildPersonalityPrompt`로 user_id 정보를 시스템 프롬프트에 포함
   - Claude가 명시 인자를 사용해도 정확한 값을 쓰도록

> **메모리 격리와 별개로, 파일시스템 격리도 같은 user_id 기반으로 동작합니다.** 데몬은 spawn 시 `cwd: ~/.jarvis/sandboxes/{safe-user-id}/` (빈 디렉토리)를 강제해서 Read 도구가 홈/시스템을 탐색하지 못하게 합니다. 자세히는 [04. 팀원 — 격리 메커니즘](04-team-members.md#격리-메커니즘-한눈에).

### 격리 범위 (메모리 종류별)

| 메모리 | user_id 분리? | 이유 |
|--------|------------|------|
| 선언적 메모리 (선호도/사실) | ✅ | 김철수 선호 ≠ 박영희 선호 |
| 세션 (대화 기록) | ✅ | 다른 유저 대화는 보이지 않음 |
| 절차적 메모리 (스킬) | ❌ 글로벌 | 스킬은 도구처럼 모두가 공유 |
| 유저 프로파일 | ✅ (PK) | 각자 personality/cron 분리 |

### Dreaming도 user_id별 순회

`hooks/dreaming-cron.js`는 등록된 모든 user_id를 DB에서 조회 후 각각 `dreaming.dream(uid)`를 호출합니다. 즉 owner 메모리, telegram:NNN 메모리, slack:UXXX 메모리가 각각 독립적으로 정리됩니다.

### 통계로 격리 확인

```
jarvis_memory_stats
```

응답 필드:
- `per_user_declarative`: `[{user_id, count}, ...]`
- `per_user_sessions`: `[{user_id, count}, ...]`
- `current_user_id`: 지금 호출자의 user_id (owner / channel:id)

---

## 3계층 구조

```
┌──────────────────────────────────────────┐
│ 1. 선언적 메모리 (사실/선호도)             │
│    "이 프로젝트는 Kotlin + Spring Boot"   │
│    "테스트는 BDD 패턴 선호"               │
├──────────────────────────────────────────┤
│ 2. 절차적 메모리 (스킬 인덱스)             │
│    kotlin-expert, kt-spring-boot-expert  │
│    ddd-context-loader, skill-generator   │
├──────────────────────────────────────────┤
│ 3. 세션 검색 (과거 대화)                   │
│    "3일 전 JPA N+1 문제를 fetch join으로   │
│     해결한 세션이 있음"                    │
└──────────────────────────────────────────┘
           +
┌──────────────────────────────────────────┐
│ Dreaming (메모리 정리)                     │
│  중복 병합, 오래된 사실 아카이브             │
└──────────────────────────────────────────┘
```

## 1. 선언적 메모리

사용자에 대한 **사실과 선호도**를 저장합니다.

### 저장

```
/jarvis 대화 중:
  jarvis_memory_save(
    type: "declarative",
    key: "tech_stack",
    content: "Kotlin + Spring Boot + JPA + QueryDSL",
    tags: ["kotlin", "spring", "jpa"]
  )
```

### 검색

```
jarvis_memory_recall(
  query: "어떤 프레임워크 사용",
  type: "declarative"
)

# 결과:
{
  "results": [
    {
      "type": "declarative",
      "data": {
        "key": "tech_stack",
        "content": "Kotlin + Spring Boot + JPA + QueryDSL",
        "tags": ["kotlin", "spring", "jpa"]
      }
    }
  ]
}
```

### 자동 추적

`auto-memory` 훅이 세션 중 도구 사용을 자동으로 추적합니다:
- 어떤 도구를 몇 번 사용했는지
- 어떤 파일을 수정했는지
- 세션 시작/종료 시각

저장 위치: `~/.jarvis/sessions/{session-id}.json`

## 2. 절차적 메모리 (스킬 인덱스)

`~/.claude/skills/` 아래의 모든 스킬을 **SQLite FTS5로 인덱싱**합니다.

### 스캔

```bash
node ~/jarvis/hooks/scan-skills.js
```

```
[Jarvis] 스킬 스캔 완료: 13개 발견
  - kotlin-expert [kotlin, spring, ddd, jpa]
  - kt-spring-boot-expert [kotlin, spring, jpa, test]
  - ddd-context-loader [kotlin, spring, ddd]
  - jarvis [refactor, debug, review]
  - skill-generator [git, api]
  ...
```

### 동기화 (DB에 반영)

```
/jarvis sync
```

또는 MCP 도구:

```
jarvis_sync_skills
```

### 스킬 매칭

요청에 관련된 스킬을 자동으로 찾습니다:

```
jarvis_memory_recall(
  query: "Kotlin JPA 성능",
  type: "procedural"
)

# 결과: kt-spring-boot-expert, kotlin-expert
```

## 3. 세션 검색 (FTS5)

과거 대화 세션을 **전문 검색**하여 유사한 작업의 접근법을 회상합니다.

### 검색

```
jarvis_session_search(query: "JPA N+1 문제")

# 결과:
{
  "results": [
    {
      "session_id": "session-001",
      "summary": "JPA N+1 문제 해결 — fetch join 적용",
      "matched_content": "...>>>fetch join<<<을 사용하여 N+1 문제를 해결..."
    }
  ]
}
```

### 세션 동기화

훅이 기록한 세션 로그를 DB에 반영합니다:

```
jarvis_sync_sessions
```

### 현재 적재 상태 확인

```bash
sqlite3 ~/.jarvis/data/memory.db "SELECT COUNT(*) FROM sessions; SELECT COUNT(*) FROM session_messages;"
```

> ⚠️ **주의**: 세션 자동 적재 파이프라인은 **`auto-memory` 훅 → `~/.jarvis/sessions/*.json` → `jarvis_sync_sessions` MCP 호출** 3단계입니다. 마지막 sync 단계는 자동이 아니므로, `jarvis_session_search`가 빈 결과만 반환한다면 위 SQL로 0건인지 먼저 확인하고 수동 sync가 필요합니다.

## IntentGate 자동화 (UserPromptSubmit 훅)

`/jarvis` 명시 호출 없이도 **모든 사용자 입력**을 자동 분석해 메모리를 프리로딩합니다.

### 동작 흐름

```
사용자 입력
    │
    ▼
~/jarvis/hooks/intent-gate.js (UserPromptSubmit 훅)
    │
    ├─ 1. 키워드 매칭으로 카테고리/복잡도 분류 (LLM 호출 X, latency ~수 ms)
    │
    ├─ 2. quick(짧은 인사/잡담)이면 통과
    │
    ├─ 3. standard/deep이면 SQLite FTS5 직접 조회
    │     ├─ declarative_memory   (사실/선호도)
    │     ├─ session_messages     (유사 과거 작업)
    │     └─ procedural_memory    (관련 스킬)
    │
    └─ 4. 결과를 hookSpecificOutput.additionalContext로 출력
              → Claude Code가 모델 컨텍스트에 자동 주입
```

### 등록

`jarvis install-mcp`가 `~/.claude/settings.json`의 `hooks.UserPromptSubmit`에 자동 등록합니다.
수동 확인:

```bash
jq '.hooks.UserPromptSubmit' ~/.claude/settings.json
```

### `/jarvis` 명시 호출과의 차이

| 항목 | UserPromptSubmit 훅 (자동) | `/jarvis` (수동) |
|------|--------------------------|-----------------|
| 발동 | 모든 사용자 입력 | `/jarvis`로 시작할 때만 |
| 분류 | 키워드 매칭 (결정적) | LLM이 SKILL.md 절차 따라 판단 |
| 메모리 검색 | FTS5 직접 호출 | `jarvis_memory_recall` MCP 도구 |
| 컨텍스트 주입 | additionalContext로 자동 | 모델이 결과를 응답에 반영 |
| 적합한 경우 | 일상 사용 (모든 요청) | deep 분석 + 작업 분해 필요할 때 |

## IntentGate와 메모리 연동 (수동 호출 시)

`/jarvis` 커맨드로 요청하면 **자동으로 메모리를 프리로딩**합니다:

```
사용자: /jarvis Spring Boot에서 캐시 적용해줘

Jarvis 내부 동작:
  1. 카테고리 분류: coding
  2. 복잡도 추정: standard
  3. 스킬 매칭: jarvis_memory_recall("Spring Boot 캐시", type: "procedural")
     → kt-spring-boot-expert 발견
  4. 메모리 회상: jarvis_memory_recall("캐시", type: "declarative")
     → "Redis를 사용 중" 발견
  5. 세션 검색: jarvis_session_search("캐시")
     → "지난주 Redis 캐시 설정한 세션" 발견

→ 이 모든 컨텍스트를 활용하여 응답
```

## Dreaming (메모리 정리)

주기적으로 메모리를 정리합니다. 트리거는 3가지입니다.

### 트리거 방식

| 트리거 | 발동 조건 | 비고 |
|-------|---------|------|
| 수동 | `/jarvis dream` 또는 `bun run ~/jarvis/hooks/dreaming-cron.js` | 즉시 실행 |
| 자동 (용량 기반) | DB 크기가 `soft_limit_mb` 초과 시 | `auto-memory` 훅이 백그라운드 spawn |
| 정기 (크론) | launchd/cron으로 스케줄 등록 시 | 선택사항 |

### 메모리 정책 (`config/memory.yml`)

```yaml
memory:
  soft_limit_mb: 1024      # 초과 시 백그라운드 Dreaming 자동 실행
  hard_limit_mb: 2048      # 초과 시 즉시 강제 + 더 짧은 archive_days로 추가 정리
  archive_days: 30         # 마지막 사용 후 N일 지난 메모리 아카이브
  auto_dream_cooldown_seconds: 300  # 자동 트리거 최소 간격
```

핫 리로드: 데몬 재시작 없이 매 호출마다 다시 읽습니다 (mtime 캐시).

### 정리 내용

| 동작 | 설명 |
|------|------|
| 중복 병합 | 같은 키로 여러 개 존재 시 최신만 유지 |
| 오래된 아카이브 | `archive_days`(기본 30일) 이상 미사용 메모리 아카이브 |
| hard 초과 시 | `archive_days`를 절반으로 줄여 더 공격적으로 아카이브 |

### 결과 예시

```
{
  "duplicates_merged": 3,
  "stale_archived": 5,
  "total_affected": 8,
  "actions": [
    "중복 병합: \"tech_stack\" (3개 → 1개)",
    "오래된 메모리 아카이브: 5건 (90일 이상)"
  ]
}
```

### Dreaming 히스토리

```
jarvis_dream_history
```

## 자율 스킬 생성

복잡한 작업 완수 후 Jarvis가 **스킬 생성을 제안**합니다:

### 트리거 조건

- 도구 호출 15회 이상
- 파일 변경 5개 이상
- 경과 시간 30분 이상

### 넛지 메시지

```
[Jarvis] 복잡한 작업이 감지되었습니다 (도구 23회, 파일 변경 8건, 45분 경과).
이 작업을 스킬로 저장하면 다음에 재사용할 수 있습니다.
/skill-generator 를 실행해보세요.
```

### 생성 절차

```
/skill-generator

1. 세션 분석 — 사용한 도구, 수정한 파일, 패턴 분석
2. 사용자 확인 — 스킬 이름/설명 제시 후 승인
3. SKILL.md 작성 — Claude Code 스킬 형식
4. 보안 스캔 — 시크릿, 파괴적 명령 차단
5. 저장 — ~/.claude/skills/{name}/SKILL.md
6. 인덱싱 — 절차적 메모리에 등록
```

### 보안 스캔

| 차단 (자동) | 경고 (확인 필요) |
|------------|----------------|
| API 키 하드코딩 | 외부 URL |
| `rm -rf`, `DROP TABLE` | 하드코딩된 경로 |
| `eval()`, `exec()` | 특정 버전 번호 |
| `curl \| sh` | 특정 포트 번호 |

## 통계

```
/jarvis stats

{
  "declarative_memories": 15,
  "procedural_memories": 13,
  "sessions": 42,
  "session_messages": 1280,
  "paired_users": 3,
  "total_users": 4,
  "db_size_mb": 12.34,
  "memory_policy": {
    "soft_limit_mb": 1024,
    "hard_limit_mb": 2048,
    "archive_days": 30
  },
  "usage_status": "normal"   // normal | soft_exceeded | hard_exceeded
}
```

## 데이터 위치

| 항목 | 경로 |
|------|------|
| SQLite DB | `~/.jarvis/data/memory.db` |
| 세션 로그 | `~/.jarvis/sessions/` |
| 스킬 인덱스 | `~/.jarvis/skill-index.json` |

## 컨텍스트/메모리 초기화

상황별 초기화 옵션입니다. 아래로 갈수록 강한 초기화이며 복구 불가능합니다.

| 명령 | 무엇이 초기화되나 | 무엇이 남나 |
|------|-----------------|-----------|
| `/clear` (Claude Code 슬래시) | 현재 대화의 컨텍스트 | 시스템 프롬프트, MCP 서버, 모든 영구 데이터 |
| `/compact` (Claude Code 슬래시) | 현재 대화를 요약본으로 압축 | 요약 + 시스템 프롬프트 |
| `Ctrl+C` 후 `claude` 재실행 | 현재 transcript 종료, 새 세션 | `~/.claude/projects/.../*.jsonl` 모든 과거 transcript |
| `jarvis_memory_forget` (MCP) | 특정 메모리 항목 1개 | 그 외 모든 데이터 |
| `rm -rf ~/.jarvis/sessions/` | auto-memory 훅이 기록한 임시 JSON | DB, 유저 설정 |
| `rm ~/.jarvis/data/memory.db*` | **Jarvis의 모든 메모리 (선언/절차/세션) 영구 삭제** | 유저 설정, 채널 설정 |
| `rm -rf ~/.jarvis/users/` | 모든 유저 personality + cron_jobs | DB, 페어링 대기열 |
| `rm -rf ~/.jarvis/` | **모든 런타임 데이터** | 소스 코드(`~/jarvis/`)만 |

> 파괴적 명령은 **반드시 사전 백업** 후 실행하세요. `cp -r ~/.jarvis ~/.jarvis.bak.$(date +%Y%m%d)` 권장.

## 다음 단계

- [커맨드 레퍼런스](07-commands.md) — 전체 명령 목록
