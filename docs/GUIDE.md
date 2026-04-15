# Jarvis 사용 가이드

> Claude Code 위에서 동작하는 개인화 AI 에이전트

---

## 목차

1. [설치](#1-설치)
2. [기능 개요](#2-기능-개요)
3. [백그라운드 데몬](#3-백그라운드-데몬)
4. [IntentGate (의도 분석)](#4-intentgate-의도-분석)
5. [메모리 시스템](#5-메모리-시스템)
6. [자율 스킬 생성](#6-자율-스킬-생성)
7. [멀티채널 게이트웨이](#7-멀티채널-게이트웨이)
8. [프로필 및 자동 승인](#8-프로필-및-자동-승인)
9. [크론잡](#9-크론잡)
10. [Docker 샌드박스](#10-docker-샌드박스)
11. [MCP 도구 레퍼런스](#11-mcp-도구-레퍼런스)
12. [훅 레퍼런스](#12-훅-레퍼런스)
13. [트러블슈팅](#13-트러블슈팅)

---

## 1. 설치

### 요구 사항

| 항목 | 버전 | 필수 |
|------|------|------|
| [Claude Code](https://claude.ai/claude-code) | 구독 활성 | 필수 |
| [Bun](https://bun.sh/) | 1.0+ | 필수 |
| [Docker](https://www.docker.com/) | 20.10+ | 선택 (팀원 샌드박스) |

### 설치 방법

```bash
# 1. 클론
git clone https://github.com/hyeon0208/jarvis.git ~/jarvis

# 2. 설치 스크립트 실행
cd ~/jarvis && chmod +x setup.sh && ./setup.sh
```

setup.sh가 자동으로:
- 의존성 설치 (`bun install`)
- 데이터 디렉토리 생성 (`~/.jarvis/`)
- 스킬 심볼릭 링크 (`~/.claude/skills/jarvis` 등)
- 기존 스킬 스캔 및 인덱싱

### settings.json 수동 설정

`~/.claude/settings.json`에 다음을 추가하세요:

```jsonc
{
  // MCP 서버 등록
  "mcpServers": {
    "jarvis-memory": {
      "command": "bun",
      "args": ["run", "/Users/{사용자명}/jarvis/packages/memory-server/src/index.ts"]
    },
    "jarvis-gateway": {
      "command": "bun",
      "args": ["run", "/Users/{사용자명}/jarvis/packages/gateway-server/src/index.ts"]
    }
  },

  // 훅 등록 (기존 hooks.PostToolUse 배열에 추가)
  "hooks": {
    "PostToolUse": [
      // ... 기존 훅 유지 ...
      {
        "matcher": "Edit|Write|MultiEdit|Bash|Agent",
        "hooks": [
          {
            "type": "command",
            "command": "node \"/Users/{사용자명}/jarvis/hooks/auto-memory.js\"",
            "timeout": 5
          },
          {
            "type": "command",
            "command": "node \"/Users/{사용자명}/jarvis/hooks/skill-nudge.js\"",
            "timeout": 5
          }
        ]
      }
    ]
  },

  // 권한 등록 (기존 permissions.allow 배열에 추가)
  "permissions": {
    "allow": [
      // ... 기존 권한 유지 ...
      "mcp__jarvis-memory__jarvis_memory_save",
      "mcp__jarvis-memory__jarvis_memory_recall",
      "mcp__jarvis-memory__jarvis_memory_list",
      "mcp__jarvis-memory__jarvis_session_save",
      "mcp__jarvis-memory__jarvis_session_search",
      "mcp__jarvis-memory__jarvis_memory_dream",
      "mcp__jarvis-memory__jarvis_dream_history",
      "mcp__jarvis-memory__jarvis_user_profile",
      "mcp__jarvis-memory__jarvis_memory_stats",
      "mcp__jarvis-memory__jarvis_sync_skills",
      "mcp__jarvis-memory__jarvis_sync_sessions",
      "mcp__jarvis-gateway__jarvis_gateway_route",
      "mcp__jarvis-gateway__jarvis_gateway_send",
      "mcp__jarvis-gateway__jarvis_gateway_pair",
      "mcp__jarvis-gateway__jarvis_profile_manage",
      "mcp__jarvis-gateway__jarvis_cron_manage",
      "mcp__jarvis-gateway__jarvis_sandbox_config",
      "mcp__jarvis-gateway__jarvis_gateway_status"
    ]
  }
}
```

### 설치 확인

Claude Code를 재시작한 후:

```
/jarvis stats
```

메모리 통계가 표시되면 설치 성공입니다.

---

## 2. 기능 개요

```
┌─────────────────────────────────────────────────────────┐
│                      Jarvis                              │
│                                                          │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐     │
│  │ IntentGate  │  │   Memory    │  │    Skill    │     │
│  │ 의도 분석    │  │ 3계층 메모리 │  │ 자율 생성   │     │
│  └─────────────┘  └─────────────┘  └─────────────┘     │
│                                                          │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐     │
│  │  Gateway    │  │  Profiles   │  │   CronJob   │     │
│  │ 멀티채널     │  │ 권한 관리    │  │ 반복 작업   │     │
│  └─────────────┘  └─────────────┘  └─────────────┘     │
│                                                          │
│  ┌─────────────────────────────────────────────────┐    │
│  │              Docker Sandbox                      │    │
│  │           팀원 요청 격리 실행                      │    │
│  └─────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────┘
```

| 기능 | 영감 출처 | 설명 |
|------|----------|------|
| IntentGate | Oh My OpenAgent | 요청의 의도/복잡도를 분석하여 최적 대응 |
| 3계층 메모리 | Hermes Agent | 선언적 + 절차적 + 세션검색 + Dreaming |
| 자율 스킬 생성 | Hermes Agent | 복잡한 작업 후 SKILL.md 자동 생성 |
| 멀티채널 게이트웨이 | OpenClaw | Telegram/Discord/Slack 동시 지원 |
| 프로필 권한 | OpenClaw | 4단계 역할 기반 접근 제어 |
| 크론잡 | OpenClaw | 자연어로 반복 작업 등록 |
| Docker 샌드박스 | OpenClaw | 팀원 요청을 격리 실행 |

---

## 3. 백그라운드 데몬

Jarvis Daemon은 **별도 터미널 없이 백그라운드에서 상시 대기**하며, 외부 채널의 메시지를 자동 처리합니다.

### 동작 원리

```
Jarvis Daemon (백그라운드 Bun 프로세스)
│
├── Telegram long polling (상시 리스닝)
├── Discord WebSocket (상시 리스닝)
├── Slack Socket Mode (상시 리스닝)
│
└── 메시지 수신 시:
    1. Gateway 라우팅 (인증/권한 체크)
    2. 프로필 → --allowedTools 자동 매핑 (승인 불필요!)
    3. claude -p "{요청}" --allowedTools "Read,Grep,..."
    4. 응답을 해당 채널로 자동 전송
```

### 데몬 관리

```bash
./jarvis.sh start      # 백그라운드로 시작
./jarvis.sh stop       # 종료
./jarvis.sh restart    # 재시작
./jarvis.sh status     # 실행 상태 확인
./jarvis.sh logs       # 실시간 로그 (tail -f)
./jarvis.sh logs 100   # 최근 100줄부터 표시
```

### 맥 부팅 시 자동 시작 (launchd)

```bash
./jarvis.sh install    # launchd에 등록 → 맥 재부팅해도 자동 실행
./jarvis.sh uninstall  # 자동 시작 해제
```

설치하면 `~/Library/LaunchAgents/com.jarvis.daemon.plist`가 등록됩니다.
- 프로세스가 비정상 종료되면 **자동 재시작** (KeepAlive)
- 10초 throttle로 무한 재시작 방지

### 로그 위치

| 파일 | 내용 |
|------|------|
| `~/.jarvis/daemon.log` | 메인 로그 (메시지 수신/응답/에러) |
| `~/.jarvis/daemon.stdout.log` | launchd stdout |
| `~/.jarvis/daemon.stderr.log` | launchd stderr |

### 비용 보호

admin 외의 프로필은 **요청당 $0.5 비용 제한**이 자동 적용됩니다 (`--max-budget-usd 0.5`).
과도한 비용을 방지하면서도 유용한 응답을 받을 수 있습니다.

---

## 4. IntentGate (의도 분석)

사용자의 요청을 사전 분석하여 최적의 대응 전략을 결정합니다.

### 사용법

```
/jarvis                    → 현재 세션의 분석 결과 표시
/jarvis {요청}             → 의도 분석 후 즉시 작업
/jarvis stats              → 메모리 통계
/jarvis dream              → Dreaming 실행
/jarvis skills             → 등록된 스킬 목록
/jarvis sync               → 스킬 + 세션 동기화
```

### 동작 원리

#### 1) 카테고리 분류

요청을 9가지 카테고리로 자동 분류합니다:

| 카테고리 | 예시 요청 |
|---------|----------|
| `coding` | "로그인 기능 만들어줘" |
| `debugging` | "NullPointerException이 발생해" |
| `refactoring` | "이 코드를 클린하게 정리해줘" |
| `research` | "JPA와 MyBatis 차이가 뭐야?" |
| `review` | "이 PR 코드 리뷰해줘" |
| `question` | "이 함수가 뭐 하는 건지 설명해줘" |
| `design` | "결제 시스템 아키텍처를 설계해줘" |
| `devops` | "Docker 배포 파이프라인 구성해줘" |
| `test` | "이 서비스의 단위 테스트를 작성해줘" |

#### 2) 복잡도 추정

| 레벨 | 기준 | Jarvis 행동 |
|------|------|------------|
| `quick` | 단일 파일, 간단한 수정 | 즉시 실행 |
| `standard` | 여러 파일, 일반 작업 | 관련 스킬/메모리 프리로딩 |
| `deep` | 복잡한 설계, 멀티스텝 | 작업 계획 수립 + 풀 프리로딩 |

#### 3) 프리로딩 (standard/deep)

- 관련 **스킬** 자동 탐색 및 추천
- 과거 **메모리** 회상 (선호도, 기술 스택)
- 유사한 과거 **세션** 검색 (접근법, 교훈)

### 예시 시나리오

```
사용자: /jarvis Spring Boot에서 JPA N+1 문제 해결해줘

Jarvis 분석:
  카테고리: debugging
  복잡도: standard
  관련 스킬: [kt-spring-boot-expert, kotlin-expert]
  관련 메모리: "프로젝트는 Kotlin + Spring Boot 기반"
  과거 세션: "3일 전 유사 JPA 이슈 해결 (fetch join 적용)"

→ kt-spring-boot-expert 스킬 적용 후 작업 시작
```

---

## 5. 메모리 시스템

Jarvis는 3계층 메모리로 세션 간 맥락을 유지합니다.

### 4.1 선언적 메모리 (사실/선호도)

사용자에 대한 사실, 선호도, 기술 스택 등을 저장합니다.

```
# 저장
jarvis_memory_save(
  type: "declarative",
  key: "tech_stack",
  content: "Kotlin + Spring Boot + JPA + QueryDSL",
  tags: ["kotlin", "spring", "jpa"]
)

# 검색
jarvis_memory_recall(
  query: "어떤 프레임워크를 사용하나요",
  type: "declarative"
)

# 목록
jarvis_memory_list(type: "declarative")
```

**자동 저장**: auto-memory 훅이 세션 중 도구 사용 패턴을 자동으로 추적합니다.

### 4.2 절차적 메모리 (스킬 인덱스)

등록된 스킬을 인덱싱하여 요청에 맞는 스킬을 빠르게 찾습니다.

```
# 스킬 스캔 (터미널에서)
node ~/jarvis/hooks/scan-skills.js

# 스캔 결과를 DB에 동기화
jarvis_sync_skills

# 스킬 검색
jarvis_memory_recall(
  query: "Kotlin 코드 품질",
  type: "procedural"
)
```

**현재 인덱싱된 스킬**: 13개 (kotlin-expert, kt-spring-boot-expert, ddd-context-loader 등)

### 4.3 세션 검색 (FTS5)

과거 대화 세션을 전문 검색하여 유사한 작업의 접근법을 회상합니다.

```
# 세션 검색
jarvis_session_search(query: "JPA N+1 문제")

# 세션 로그 DB에 동기화
jarvis_sync_sessions
```

### 4.4 Dreaming (메모리 정리)

주기적으로 메모리를 정리합니다:
- 중복 메모리 병합 (같은 키로 여러 개 존재 시 최신만 유지)
- 오래된 메모리 아카이브 (기본 90일)

```
# 수동 실행
/jarvis dream

# 또는 직접 MCP 호출
jarvis_memory_dream(stale_days: 90)

# Dreaming 히스토리
jarvis_dream_history
```

### 4.5 통계

```
/jarvis stats

# 출력 예시:
{
  "declarative_memories": 15,
  "procedural_memories": 13,
  "sessions": 42,
  "session_messages": 1280,
  "paired_users": 3,
  "total_users": 4
}
```

---

## 6. 자율 스킬 생성

복잡한 작업을 완수한 후, 해당 작업을 재사용 가능한 스킬로 변환합니다.

### 자동 넛지

다음 조건 충족 시 Jarvis가 스킬 생성을 제안합니다:
- 도구 호출 15회 이상
- 파일 변경 5개 이상
- 경과 시간 30분 이상

```
[Jarvis] 복잡한 작업이 감지되었습니다 (도구 23회, 파일 변경 8건, 45분 경과).
이 작업을 스킬로 저장하면 다음에 재사용할 수 있습니다.
/skill-generator 를 실행해보세요.
```

### 수동 실행

```
/skill-generator              → 현재 세션을 스킬로 변환
/skill-generator list          → 생성된 스킬 목록
/skill-generator edit {이름}   → 기존 스킬 수정
```

### 생성 절차

1. **세션 분석** — 사용한 도구, 수정한 파일, 패턴, 의사결정 분석
2. **사용자 확인** — 스킬 이름/설명 제시 후 승인
3. **SKILL.md 생성** — Claude Code 표준 형식
4. **보안 스캔** — 시크릿, 파괴적 명령, 동적 실행 검사
5. **저장 및 인덱싱** — `~/.claude/skills/`에 저장 + 메모리 동기화
6. **결과 보고**

### 보안 스캔 항목

| 차단 | 경고 |
|------|------|
| API 키/토큰 하드코딩 | 외부 URL |
| `rm -rf`, `DROP TABLE` | 하드코딩된 경로 |
| `eval()`, `exec()` | 특정 버전 번호 |
| `curl \| sh` | 특정 포트 번호 |

---

## 7. 멀티채널 게이트웨이

팀원이 자신의 메시징 채널에서 Jarvis에게 요청하고 응답을 받습니다.

### 7.1 Telegram

**이미 설치된 Telegram 플러그인**과 연동됩니다. 별도 설정 불필요.

**팀원이 Telegram에서 메시지를 보내면:**

```
팀원 → Telegram 봇 → Claude Code (jarvis-telegram 스킬)
  → jarvis_gateway_route (인증/권한 체크)
    → 처리 후 mcp__plugin_telegram_telegram__reply로 응답
```

**팀원이 처음 메시지를 보낼 때 (페어링):**

```
팀원: "안녕하세요"
Jarvis: "안녕하세요 김철수님! Jarvis를 사용하려면 페어링이 필요합니다.
        페어링 코드: A1B2C3
        관리자에게 이 코드를 전달하세요."
```

**Owner가 승인:**
```
/jarvis-telegram pair list                      → 대기 목록
/jarvis-telegram pair approve A1B2C3 developer  → 승인
/jarvis-telegram pair reject telegram:12345     → 거부
```

### 7.2 Discord

```bash
# .env에 토큰 설정
DISCORD_BOT_TOKEN=your_discord_bot_token
```

Discord Developer Portal에서:
1. 봇 생성 → 토큰 발급
2. **Message Content Intent** 활성화
3. 서버에 봇 초대

### 7.3 Slack

```bash
# .env에 토큰 설정
SLACK_BOT_TOKEN=xoxb-your-slack-bot-token
SLACK_APP_TOKEN=xapp-your-slack-app-token
```

Slack API에서:
1. 앱 생성 → Socket Mode 활성화
2. Event Subscriptions: `message.im`, `message.channels`
3. OAuth Scopes: `chat:write`, `channels:history`, `im:history`

### 7.4 팀원이 사용 가능한 명령

모든 채널에서 동일하게 사용 가능:

```
/help               → 도움말
/status             → Jarvis 상태
/profile            → 내 프로필 조회
/personality        → 개인화 설정 조회
/cron add ...       → 크론잡 등록
/cron list          → 크론잡 목록
/cron delete {id}   → 크론잡 삭제
```

일반 메시지는 AI 질문으로 처리됩니다.

---

## 8. 프로필 및 자동 승인

4단계 프로필로 팀원의 접근 범위를 제어합니다.
**외부 채널 요청 시 매번 허락을 받지 않고**, 프로필 권한 범위 내에서 자동 실행됩니다.

### 자동 승인 원리

데몬이 `claude -p` 호출 시 프로필에 맞는 `--allowedTools`를 자동으로 매핑합니다:

| 프로필 | 자동 허용 도구 | Claude CLI 플래그 |
|--------|--------------|------------------|
| **admin** | 전체 | `--dangerously-skip-permissions` |
| **developer** | Read, Write, Edit, Grep, Glob, `bun test`, `gradle test` 등 | `--allowedTools "Read,Write,Edit,..."` |
| **reviewer** | Read, Grep, Glob, `git log`, `git diff` 등 읽기 전용 | `--allowedTools "Read,Grep,Glob,..."` |
| **observer** | Read, Grep, Glob, WebSearch 검색 전용 | `--allowedTools "Read,Grep,Glob,..."` |

따라서 **observer가 코드 수정을 요청해도 Write/Edit 도구가 허용 목록에 없으므로 자동 거부**됩니다.

### 프로필 비교

| 기능 | admin | developer | reviewer | observer |
|------|-------|-----------|----------|----------|
| 코드 읽기 | 전체 | 전체 | 전체 | docs만 |
| 코드 쓰기 | O | 허용 디렉토리 | X | X |
| 명령 실행 | 전체 | 테스트/빌드만 | X | X |
| Git | 전체 | 읽기 전용 | 읽기 전용 | X |
| 크론잡 | O | O | O | O |
| 설정 변경 | O | X | X | X |
| 샌드박스 | X (직접 실행) | O | O | O |
| 타임아웃 | 10분 | 5분 | 2분 | 1분 |

### 프로필 변경

```
# MCP 도구로 직접
jarvis_profile_manage(
  action: "set_user_profile",
  user_id: "telegram:12345",
  profile: "developer"
)
```

### 개인화 설정

각 프로필 내에서 팀원이 자유롭게 커스터마이징:

```
jarvis_profile_manage(
  action: "set_personality",
  user_id: "telegram:12345",
  personality: {
    "tone": "casual",        # formal, casual, friendly, technical
    "language": "ko",        # ko, en, ja, ...
    "verbosity": "concise",  # concise, normal, detailed
    "emoji": true,
    "nickname": "자비스"      # 에이전트 호칭
  }
)
```

### 프로필 설정 파일

`~/jarvis/config/profiles.jsonc`에서 프로필을 커스터마이징할 수 있습니다:

```jsonc
{
  "profiles": {
    "developer": {
      "description": "개발자",
      "permissions": { "read": true, "write": true, "execute": true, ... },
      "sandbox": true,
      "directories": ["src/", "tests/"],
      "allowed_commands": ["bun test", "gradle test"],
      "max_timeout_seconds": 300
    }
  }
}
```

---

## 9. 크론잡

**모든 유저**가 자신의 채널에서 반복 작업을 등록할 수 있습니다.

### 등록

한국어 자연어로 스케줄을 지정합니다:

```
/cron add 매일 9시 오늘 할 일 정리해줘
/cron add 평일 10시 스탠드업 요약해줘
/cron add 매주 월요일 9시 주간 리포트 작성해줘
/cron add 매시간 서버 상태 확인해줘
/cron add 30분마다 빌드 상태 확인해줘
```

### 관리

```
/cron list              → 등록된 크론잡 목록
/cron delete {job_id}   → 크론잡 삭제
/cron pause {job_id}    → 크론잡 일시 중지/재개
```

### 지원하는 스케줄 표현

| 자연어 | 크론 표현식 |
|--------|-----------|
| 매일 9시 | `0 9 * * *` |
| 매일 오전 9시 | `0 9 * * *` |
| 매일 오후 3시 | `0 15 * * *` |
| 평일 10시 | `0 10 * * 1-5` |
| 매주 월요일 9시 | `0 9 * * 1` |
| 매시간 | `0 * * * *` |
| 30분마다 | `*/30 * * * *` |
| 직접 크론 입력 | `0 9 * * 1-5` (그대로 사용) |

---

## 10. Docker 샌드박스

팀원의 요청은 격리된 Docker 컨테이너에서 실행됩니다.

### 설정

```bash
# 샌드박스 이미지 빌드
cd ~/jarvis && bun run sandbox:build

# Docker 네트워크 생성
docker network create --internal jarvis-sandbox-net
```

### 격리 수준

| 항목 | 설정 |
|------|------|
| 메모리 | 512MB |
| CPU | 1코어 |
| PID | 최대 100 |
| 네트워크 | 내부 전용 (외부 차단) |
| 파일시스템 | 프로필 허용 디렉토리만 마운트 |
| 타임아웃 | 프로필별 (1~10분) |

### 샌드박스 설정 확인

```
jarvis_sandbox_config(
  user_id: "telegram:12345",
  project_dir: "/path/to/project",
  command: "gradle test"
)
```

---

## 11. MCP 도구 레퍼런스

### 메모리 서버 (jarvis-memory)

| 도구 | 설명 | 주요 파라미터 |
|------|------|-------------|
| `jarvis_memory_save` | 메모리 저장 | type, key, content, tags |
| `jarvis_memory_recall` | FTS5 검색 | query, type(all/declarative/procedural) |
| `jarvis_memory_list` | 목록 조회 | type, limit |
| `jarvis_session_save` | 세션 기록 | action(start/message/end), session_id |
| `jarvis_session_search` | 세션 검색 | query, limit |
| `jarvis_memory_dream` | Dreaming | stale_days(기본 90) |
| `jarvis_dream_history` | Dreaming 로그 | limit |
| `jarvis_user_profile` | 프로파일 | action(get/create/update/list/delete) |
| `jarvis_memory_stats` | 통계 | (없음) |
| `jarvis_sync_skills` | 스킬 동기화 | (없음) |
| `jarvis_sync_sessions` | 세션 동기화 | (없음) |

### 게이트웨이 서버 (jarvis-gateway)

| 도구 | 설명 | 주요 파라미터 |
|------|------|-------------|
| `jarvis_gateway_route` | 메시지 라우팅 | channel, user_id, message |
| `jarvis_gateway_send` | 메시지 전송 | channel, user_id, message |
| `jarvis_gateway_pair` | DM 페어링 | action(list/approve/reject), code |
| `jarvis_profile_manage` | 프로필 관리 | action, user_id, profile |
| `jarvis_cron_manage` | 크론잡 관리 | action(add/list/delete/toggle), user_id |
| `jarvis_sandbox_config` | 샌드박스 | user_id, project_dir, command |
| `jarvis_gateway_status` | 상태 조회 | (없음) |

---

## 12. 훅 레퍼런스

### auto-memory.js (PostToolUse)

세션 중 도구 사용을 추적합니다.

- **추적 대상**: Edit, Write, MultiEdit, Bash, Agent
- **저장 위치**: `~/.jarvis/sessions/{session-id}.json`
- **저장 내용**: 도구 호출 횟수, 파일 변경 수, 수정된 파일 목록

### skill-nudge.js (PostToolUse)

복잡한 작업 후 스킬 생성을 제안합니다.

- **넛지 조건**: 도구 15회+ 또는 파일 변경 5건+ 또는 30분+
- **세션당 1회만** 표시 (`.nudged` 마커 파일)

### scan-skills.js (수동 실행)

`~/.claude/skills/` 아래 SKILL.md를 파싱하여 인덱스를 생성합니다.

```bash
node ~/jarvis/hooks/scan-skills.js
```

- **출력**: `~/.jarvis/skill-index.json`
- **파싱 내용**: name, description, tags (자동 추출)

### dreaming-cron.js (수동/스케줄)

세션 로그를 동기화하고 오래된 파일을 정리합니다.

```bash
node ~/jarvis/hooks/dreaming-cron.js
```

- 미동기화 세션 로그 마킹
- 30일 이상 된 로그 파일 삭제

---

## 13. 트러블슈팅

### 데몬이 시작되지 않을 때

```bash
# 상태 확인
./jarvis.sh status

# 로그 확인
./jarvis.sh logs 50

# 수동으로 직접 실행하여 에러 확인
bun run ~/jarvis/packages/gateway-server/src/daemon.ts

# PID 파일 정리 후 재시작
rm ~/.jarvis/daemon.pid
./jarvis.sh start
```

### launchd 서비스 문제

```bash
# launchd 상태 확인
launchctl print gui/$(id -u)/com.jarvis.daemon

# 강제 재등록
./jarvis.sh uninstall
./jarvis.sh install

# launchd 로그 확인
cat ~/.jarvis/daemon.stderr.log
```

### MCP 서버가 기동하지 않을 때

```bash
# 수동으로 서버 실행하여 에러 확인
bun run ~/jarvis/packages/memory-server/src/index.ts
bun run ~/jarvis/packages/gateway-server/src/index.ts
```

### SQLite DB 초기화

```bash
rm ~/.jarvis/data/memory.db*
# 서버 재시작 시 자동으로 마이그레이션됨
```

### 스킬이 인식되지 않을 때

```bash
# 심볼릭 링크 확인
ls -la ~/.claude/skills/jarvis

# 재스캔
node ~/jarvis/hooks/scan-skills.js
```

### 훅이 동작하지 않을 때

```bash
# 훅 단독 테스트
CLAUDE_SESSION_ID=test CLAUDE_TOOL_NAME=Edit node ~/jarvis/hooks/auto-memory.js
```

### 테스트 실행

```bash
cd ~/jarvis && bun test
```

### 데이터 위치

| 항목 | 경로 |
|------|------|
| SQLite DB | `~/.jarvis/data/memory.db` |
| 세션 로그 | `~/.jarvis/sessions/` |
| 유저 설정 | `~/.jarvis/users/` |
| 스킬 인덱스 | `~/.jarvis/skill-index.json` |
| 페어링 대기 | `~/.jarvis/data/pending-pairings.json` |
| 프로필 설정 | `~/jarvis/config/profiles.jsonc` |
| 라우팅 설정 | `~/jarvis/config/routing.jsonc` |
| 데몬 PID | `~/.jarvis/daemon.pid` |
| 데몬 로그 | `~/.jarvis/daemon.log` |
| launchd plist | `~/Library/LaunchAgents/com.jarvis.daemon.plist` |
