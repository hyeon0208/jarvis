# 전체 개요

처음 Jarvis를 다루는 사람이 **한번에 파악**할 수 있도록 6가지 핵심 주제를 묶어 정리한 문서입니다.
세부 내용은 각 섹션에서 전용 문서로 연결합니다.

---

## 목차

1. [두 개의 jarvis 디렉토리](#1-두-개의-jarvis-디렉토리)
2. [전체 워크플로우](#2-전체-워크플로우)
3. [사용자가 직접 설정을 다루는 방법](#3-사용자가-직접-설정을-다루는-방법)
4. [MCP 서버란? 프로세스는 어떻게 뜨는가?](#4-mcp-서버란-프로세스는-어떻게-뜨는가)
5. [격리 및 보안 구조](#5-격리-및-보안-구조)
6. [명령어 카테고리별 정리](#6-명령어-카테고리별-정리)

---

## 1. 두 개의 jarvis 디렉토리

`~/jarvis/`와 `~/.jarvis/`는 **완전히 다른 역할**을 합니다.

| 디렉토리 | 역할 | 생성 시점 | Git 추적 | 공유 가능 |
|---------|------|----------|---------|----------|
| **`~/jarvis/`** | 소스 코드 저장소 | 사용자가 `git clone`으로 생성 | O (GitHub) | O (공개 저장소) |
| **`~/.jarvis/`** | 런타임 개인 데이터 | 데몬/훅이 자동 생성 | X (dotfile) | X (로컬 전용) |

### `~/jarvis/` — 소스 코드

```
~/jarvis/
├── packages/
│   ├── memory-server/      MCP 서버 소스 (메모리 엔진)
│   ├── gateway-server/     MCP 서버 소스 + Daemon
│   └── sandbox/            Docker 이미지 (선택)
├── skills/                 Claude Code 스킬
├── hooks/                  훅 스크립트 (auto-memory, skill-nudge)
├── scripts/                CLI 엔트리 포인트 + 마법사
├── config/                 설정 파일들 (profiles.yml, projects.jsonc, channels.yml)
├── docs/                   가이드 문서
├── jarvis.sh               메인 쉘 디스패처
├── setup.sh                설치 스크립트
└── .env                    봇 토큰 (.gitignore 됨, 로컬만)
```

### `~/.jarvis/` — 런타임 데이터

```
~/.jarvis/
├── data/
│   ├── memory.db                SQLite + FTS5 (선언/절차/세션 메모리)
│   └── pending-pairings.json    페어링 코드 대기열
├── users/
│   ├── owner.json               Owner 자신의 설정 (개인화, 크론잡)
│   └── telegram_NNN.json        각 외부 유저별 설정
├── workflows/                   /dev 진행 중인 세션 상태
├── skill-index.json             스킬 스캔 결과 인덱스
├── daemon.pid                   데몬 프로세스 ID
├── daemon.log                   데몬 로그
└── daemon.stderr.log            launchd 실행 시 stderr
```

### 왜 분리했나?

- **`.env` 파일 등 개인 시크릿을 커밋 실수로부터 격리**
- **백업/복구 편의** — 코드는 `git clone`, 데이터만 `rsync`
- **다중 인스턴스 가능성** — 향후 여러 워크스페이스 지원 확장 여지

> Claude Code 자체도 같은 패턴: `~/.claude/`(런타임) + GitHub 저장소(코드).

---

## 2. 전체 워크플로우

Jarvis는 **3가지 사용 모드**가 있습니다. 사용자가 직접 고르는 것이 아니라, **접속 경로에 따라 자동으로** 결정됩니다.

### 2.1 Owner 직접 대화 (터미널)

```
Owner 터미널에서
    $ jarvis chat
         │
         ▼
    claude 프로세스 1개 spawn (인터랙티브)
         │
         ├─ Jarvis 성격 주입 (--append-system-prompt)
         ├─ ~/.claude/settings.json의 MCP 서버 자동 로드
         │   ├─ jarvis-memory
         │   └─ jarvis-gateway
         │
         └─ 대화 시작
```

데몬과 무관하게 독립 실행됩니다. 혼자만 쓸 때 가장 간단합니다.

### 2.2 Owner 한 번 질문 (터미널)

```
    $ jarvis ask "JPA N+1 뭐야?"
         │
         ▼
    claude -p "..." (non-interactive) → 응답 출력 후 종료
```

### 2.3 외부 채널 유저 (Telegram/Discord/Slack)

```
팀원 모바일 Telegram 앱
         │
         │ "로그인 기능 구현해줘"
         ▼
┌─────────────────────────────────────────┐
│       Telegram 서버 (클라우드)             │
└────────────┬────────────────────────────┘
             │ long polling (1초)
             ▼
┌─────────────────────────────────────────┐
│  Jarvis Daemon (~/jarvis/ PID=36743)    │
│                                          │
│  1. 메시지 수신 (TelegramAdapter)         │
│  2. routeMessage() — 인증/프로필 매칭      │
│     ├─ 미페어링 → 페어링 코드 발급         │
│     ├─ /dev → 워크플로우 상태 머신 시작    │
│     └─ 일반 메시지 → 3번으로              │
│                                          │
│  3. 프로필 → Claude CLI 인자 매핑         │
│     developer → --allowedTools "..."     │
│                 --disallowedTools "..."  │
│                 --add-dir "프로젝트 경로"  │
│                                          │
│  4. claude -p "..." 자식 프로세스 spawn    │
│     ├─ Claude가 해당 인자로 작업 수행      │
│     └─ stdout에 응답 텍스트 반환            │
│                                          │
│  5. 응답을 Telegram sendMessage로 전송    │
└─────────────────────────────────────────┘
             │
             ▼
          팀원 앱에 응답 도착
```

데몬은 계속 켜져 있고, 요청마다 `claude -p` 자식 프로세스를 짧게 스폰했다가 종료합니다.

### 2.4 /dev 워크플로우 (팀원의 코드 작업)

```
팀원: /dev UserService에 이메일 검증 추가
    │
    ▼
Jarvis: "어떤 프로젝트에서 작업할까요? 1. vingle-backend"
    │
팀원: 1
    │
Jarvis: "1. 이슈 생성 후 브랜치  2. 바로 브랜치"
    │
팀원: 2
    │
    ▼ (워크플로우 상태 머신이 ~/.jarvis/workflows/ 에 저장)
    │
1. git fetch origin
2. git checkout dev && git pull
3. git worktree add ~/project/.jarvis-worktrees/telegram_XXX \
     -b feature/이메일-검증
4. claude -p "..." --cwd 새 worktree
5. 작업 완료 후 팀원: /dev done
6. git add -A → commit → push → gh pr create
7. PR 링크 응답
```

> 상세: [05-dev-workflow.md](05-dev-workflow.md)

### 2.5 메모리 루프 (자동)

```
Claude Code 도구 호출 (Edit/Write/Bash 등)
    │
    ▼ PostToolUse 훅
hooks/auto-memory.js
    └─ ~/.jarvis/sessions/{id}.json 기록

복잡한 작업 완료 시
    │
    ▼ 넛지
hooks/skill-nudge.js
    └─ "/skill-generator로 스킬 저장하시겠습니까?" 제안
```

> 상세: [06-memory.md](06-memory.md)

---

## 3. 사용자가 직접 설정을 다루는 방법

설정 방식은 **3단계 추상화 레벨**로 정리됩니다.

### 3.1 설정 파일 (가장 낮은 레벨)

| 파일 | 내용 | 편집 시기 |
|------|------|----------|
| `~/jarvis/config/profiles.yml` | 프로필별 권한 (도구/디렉토리/모델/effort) | 프로필 권한 튜닝 |
| `~/jarvis/config/projects.jsonc` | `/dev`에서 쓸 git 저장소 목록 | 새 프로젝트 추가 |
| `~/jarvis/config/channels.yml` | Telegram/Discord/Slack 활성화 | 채널 온/오프 |
| `~/jarvis/.env` | 봇 토큰 (gitignore) | 봇 최초 설정 |
| `~/.claude/settings.json` | MCP 서버, 훅, 권한 등록 | 자동 패치 (`jarvis install-mcp`) |
| `~/.jarvis/users/*.json` | 각 유저의 프로필/개인화/크론잡 | 자동 관리 |

### 3.2 명령어 마법사 (중간 레벨, 인터랙티브)

파일을 직접 건드리지 않고 질문에 답변하며 설정:

```bash
jarvis create-profile       # 새 프로필 생성
jarvis edit-profile <name>  # 기존 프로필 수정 ([현재값] 표시)
jarvis add-project          # 프로젝트 추가 + 디렉토리 자동 생성
jarvis add-channel          # 채널 활성화 + 토큰 입력 + Telegram 라이브 검증
jarvis install-mcp          # settings.json idempotent 패치
```

### 3.3 명령어 비대화형 (가장 빠른 레벨)

```bash
# 한 줄 CRUD
jarvis project add backend --path ~/backend --repo org/backend --profiles owner,developer
jarvis channel enable discord
jarvis channel token telegram xxx
jarvis user profile telegram:1234 reviewer
jarvis pair approve A1B2C3 developer
```

### 3.4 설정 변경 반영 방식

| 대상 | 반영 시점 |
|------|----------|
| profiles.yml | **즉시** (permissions.ts가 mtime 기반 핫 리로드) |
| channels.yml | 데몬 재시작 필요 (`jarvis restart`) |
| projects.jsonc | 즉시 (요청 시마다 읽음) |
| .env | 데몬 재시작 필요 |
| users/*.json | 즉시 |
| settings.json | Claude Code 재시작 필요 |

### 3.5 모든 변경은 자동 백업

`.bak.{ISO timestamp}` 파일이 자동 생성됩니다:

```
~/.claude/settings.json.bak.2026-04-18T16-19-25-022Z
~/jarvis/config/profiles.yml.bak.2026-04-19T...
```

> 상세: [08-owner-cli.md](08-owner-cli.md)

---

## 4. MCP 서버란? 프로세스는 어떻게 뜨는가?

### 4.1 MCP(Model Context Protocol)란

Claude Code가 외부 도구/데이터에 접근하기 위한 **표준 프로토콜**입니다. Jarvis는 2개의 MCP 서버를 제공합니다:

| 서버 | 역할 | 노출 도구 수 |
|------|------|------------|
| **jarvis-memory** | SQLite FTS5 메모리 엔진 | 11개 |
| **jarvis-gateway** | 채널 라우팅/프로필/크론/페어링 | 8개 |

### 4.2 통신 방식 (stdio JSON-RPC)

```
Claude Code 프로세스
    │
    │ stdin: JSON-RPC 요청
    │ {"method": "tools/call", "params": {...}}
    ▼
┌───────────────────────┐
│  MCP 서버 자식 프로세스  │
│  bun run .../index.ts │
│  (stdio 기반)         │
└───────┬───────────────┘
    │
    │ stdout: JSON-RPC 응답
    │ {"result": {...}}
    ▼
Claude Code 프로세스
```

네트워크 포트를 열지 않고 **표준 입출력**으로만 통신합니다. 외부에서 접근 불가능합니다.

### 4.3 언제 spawn되는가?

Claude Code는 `~/.claude/settings.json`에서 MCP 서버를 읽어 **Claude 세션이 시작될 때 자동으로 자식 프로세스로 띄웁니다**:

```jsonc
// ~/.claude/settings.json
{
  "mcpServers": {
    "jarvis-memory": {
      "command": "bun",
      "args": ["run", "/Users/hyeonjun/jarvis/packages/memory-server/src/index.ts"]
    },
    "jarvis-gateway": {
      "command": "bun",
      "args": ["run", "/Users/hyeonjun/jarvis/packages/gateway-server/src/index.ts"]
    }
  }
}
```

실제 프로세스 구조:

```
Claude Code 세션 (예: jarvis chat 중)
├── bun run .../memory-server/src/index.ts   (자식)
└── bun run .../gateway-server/src/index.ts  (자식)

세션 종료 → 자식 프로세스도 함께 종료
```

### 4.4 데몬 vs MCP 서버 (헷갈리기 쉬움)

**같은 gateway-server/src/ 안에 두 개의 엔트리가 있습니다**:

| 엔트리 | 용도 | 실행 방식 | 수명 |
|--------|------|---------|------|
| `packages/gateway-server/src/index.ts` | MCP 서버 | Claude Code가 자식 프로세스로 spawn | 세션 기간 |
| `packages/gateway-server/src/daemon.ts` | 채널 리스닝 데몬 | `jarvis start`로 백그라운드 실행 | 상시 (launchd) |

### 4.5 실제 프로세스 확인

```bash
# 현재 실행 중인 Jarvis 프로세스
$ ps aux | grep -E "jarvis" | grep -v grep
hyeonjun  36743  bun run /Users/hyeonjun/jarvis/packages/gateway-server/src/daemon.ts
#                                                              ^^^^^^ daemon.ts

# Claude Code 세션이 열려 있을 때만 추가로:
# bun run .../memory-server/src/index.ts
# bun run .../gateway-server/src/index.ts  ← 이건 index.ts (MCP), 위의 daemon.ts와 별개
```

### 4.6 MCP가 제공하는 도구 예시

Claude 세션 안에서 사용 가능:

```
jarvis_memory_save / recall / list / search       # jarvis-memory
jarvis_session_save / search
jarvis_memory_dream / dream_history
jarvis_memory_stats / sync_skills / sync_sessions
jarvis_user_profile

jarvis_gateway_route / send / pair                # jarvis-gateway
jarvis_profile_manage / cron_manage / worktree_manage
jarvis_gateway_status / sandbox_config
```

> 상세: [02-architecture.md](02-architecture.md), [06-memory.md](06-memory.md)

---

## 5. 격리 및 보안 구조

Jarvis는 **다층 방어**를 사용합니다. 각 계층이 독립적으로 동작해 한 곳이 뚫려도 다른 계층이 방어합니다.

### 5.1 계층별 보안

```
외부 채널 요청 (Telegram/Discord/Slack)
    │
    ▼
┌──────────────────────────────────────────┐
│ 계층 1: DM 페어링                         │
│   - 미등록 유저는 페어링 코드만 받음      │
│   - Owner가 터미널에서 승인해야 활성화    │
│   - 6자리 코드 + 24시간 만료              │
└─────────────┬────────────────────────────┘
              ▼
┌──────────────────────────────────────────┐
│ 계층 2: 프로필 기반 --allowedTools        │
│   - Claude가 호출할 수 있는 도구 목록 제한  │
│   - 허용 목록에 없는 도구는 자동 거부      │
│   - 승인 다이얼로그 없음 (-p 모드)         │
└─────────────┬────────────────────────────┘
              ▼
┌──────────────────────────────────────────┐
│ 계층 3: 위험 명령 차단 --disallowedTools  │
│   - rm -rf, sudo, ssh, chmod, kill 등    │
│   - cat ~/.ssh, cat ~/.env 같은 시크릿 노출 차단
│   - git push --force, git reset --hard 차단│
└─────────────┬────────────────────────────┘
              ▼
┌──────────────────────────────────────────┐
│ 계층 4: --add-dir 디렉토리 격리            │
│   - Claude가 접근할 수 있는 디렉토리를     │
│     프로젝트 경로로 제한                  │
│   - ~/.ssh, ~/.env 등 시스템 파일 접근 차단│
└─────────────┬────────────────────────────┘
              ▼
┌──────────────────────────────────────────┐
│ 계층 5: 시간 제한                         │
│   - 프로필별 타임아웃 (60초 ~ 10분)        │
│   - 무한 루프/장시간 작업 방지             │
└─────────────┬────────────────────────────┘
              ▼
┌──────────────────────────────────────────┐
│ 계층 6: 데몬 자동 진단                     │
│   - 시작 시 설정 파일 문법/참조 검증       │
│   - 오류 시 데몬 시작 거부 (exit 2)       │
└──────────────────────────────────────────┘
```

### 5.2 프로필별 격리 강도

| 프로필 | 도구 제한 | 디렉토리 제한 | 시간 제한 |
|--------|---------|-------------|---------|
| **owner** | 없음 (skip_permissions) | 없음 | 10분 |
| **developer** | Read/Write/Edit/git 쓰기/test/build만 | 프로젝트만 | 5분 |
| **reviewer** | Read/git 읽기만 | 프로젝트만 | 2분 |
| **observer** | Read/Grep/WebSearch만 | 프로젝트만 | 1분 |

`owner` 프로필의 경우 `skip_permissions: true` 때문에 모든 제한을 우회합니다. **Owner 본인 전용**이며 다른 팀원에게 부여하지 마세요.

### 5.3 실제 실행되는 claude 인자

`developer` 프로필 유저가 요청을 보내면 데몬이 spawn하는 명령:

```bash
claude -p "{요청 내용}" \
  --allowedTools "Read,Write,Edit,Grep,Glob,Bash(git add:*),Bash(bun test:*),..." \
  --disallowedTools "Bash(rm -rf:*),Bash(sudo:*),Bash(ssh:*),Bash(cat ~/.ssh:*),..." \
  --add-dir "/Users/hyeonjun/Desktop/프로젝트/vingle-backend" \
  --effort xhigh \
  --append-system-prompt "..."
```

### 5.4 승인 다이얼로그가 없음

외부 유저는 claude의 승인 다이얼로그를 볼 수 없습니다 (`-p` non-interactive 모드). 허용 목록에 없는 도구는 **묻지 않고 자동 거부**됩니다.

이는 중요합니다: **다른 프로필 유저가 허용/거부 응답으로 권한을 확대할 방법이 없습니다**.

### 5.5 Owner CLI vs owner 프로필 (혼동 주의)

| 구분 | 의미 | 접근 |
|------|------|------|
| **Owner (호스트)** | Jarvis를 호스팅하는 본인 | 로컬 터미널 (파일 시스템 접근 권한) |
| **owner 프로필** | Owner의 외부 채널 계정 전용 최고 권한 | Telegram/Discord/Slack DM |

Owner CLI 명령(`jarvis pair`, `jarvis user profile` 등)은 **쉘 스크립트이고 파일 시스템 접근 권한으로 보호**됩니다. 네트워크로 노출되지 않으므로 외부 유저는 호출할 방법이 없습니다. 단, `owner` 프로필 유저는 `skip_permissions` 때문에 이론상 Bash를 통해 `jarvis` 명령을 실행 가능하므로 **절대 다른 팀원에게 owner 프로필을 부여하지 않아야 합니다**.

> 상세: [02-architecture.md](02-architecture.md), [08-owner-cli.md](08-owner-cli.md)

---

## 6. 명령어 카테고리별 정리

### 6.1 Owner의 터미널 명령 (`jarvis` CLI)

#### 대화

| 명령 | 용도 |
|------|------|
| `jarvis chat` | 인터랙티브 대화 시작 |
| `jarvis ask "..."` | 한 번 질문하고 종료 |

#### 데몬 관리

| 명령 | 용도 |
|------|------|
| `jarvis start/stop/restart` | 데몬 제어 |
| `jarvis status` | 실행 상태 |
| `jarvis logs [N]` | 로그 tail -f |
| `jarvis install/uninstall` | 맥 부팅 자동 시작 (launchd) |

#### 설정 마법사 (인터랙티브)

| 명령 | 용도 |
|------|------|
| `jarvis create-profile` | 새 프로필 생성 |
| `jarvis edit-profile <name>` | 기존 프로필 수정 |
| `jarvis add-project` | 프로젝트 추가 |
| `jarvis add-channel` | 채널 추가 + 토큰 입력 |
| `jarvis install-mcp` | Claude Code settings.json 패치 |

#### 관리 (비대화형)

| 명령 | 용도 |
|------|------|
| `jarvis pair list/approve/reject` | 페어링 승인 관리 |
| `jarvis project ls/add/rm` | 프로젝트 CRUD |
| `jarvis channel ls/enable/disable/token` | 채널 CRUD |
| `jarvis user ls/show/profile/rename/rm` | 유저 관리 |

#### 조회/진단

| 명령 | 용도 |
|------|------|
| `jarvis list profiles/users/channels/pending` | 목록 조회 |
| `jarvis doctor [--quick]` | 전체 진단 |

### 6.2 외부 채널 유저의 명령 (Telegram/Discord/Slack)

#### 일반

| 명령 | 용도 |
|------|------|
| `/help` | 도움말 |
| `/status` | Jarvis 상태 |
| `/profile` | 내 프로필 조회 |
| `/personality` | 개인화 설정 조회 |

#### 개발 워크플로우 (owner, developer 프로필만)

| 명령 | 용도 |
|------|------|
| `/dev <작업>` | 워크플로우 시작 |
| `/dev status` | 진행 상태 |
| `/dev done` | commit → push → PR |
| `/dev cancel` | 취소 + worktree 정리 |

#### 크론잡 (모든 프로필)

| 명령 | 용도 |
|------|------|
| `/cron add <스케줄> <작업>` | 크론잡 등록 |
| `/cron list` | 크론잡 목록 |
| `/cron delete <id>` | 크론잡 삭제 |

### 6.3 Claude Code 세션 내 스킬 (Owner/관리자 대화 중)

| 명령 | 용도 |
|------|------|
| `/jarvis` | IntentGate 의도 분석 |
| `/jarvis stats` | 메모리 통계 |
| `/jarvis dream` | Dreaming 실행 |
| `/jarvis skills` | 등록된 스킬 목록 |
| `/jarvis sync` | 스킬/세션 DB 동기화 |
| `/skill-generator` | 현재 세션을 스킬로 변환 |

> 상세: [07-commands.md](07-commands.md)

---

## 요약 한 장

```
~/jarvis/                소스 (public)           — git clone
~/.jarvis/               데이터 (private)         — 자동 생성

3가지 모드
  Owner 터미널    jarvis chat                     — 데몬 불필요
  외부 채널      Telegram/Discord/Slack → 데몬    — jarvis start 필요
  /dev 워크플로우  프로젝트 → 브랜치 → PR          — worktree 격리

MCP 서버 2개 (Claude가 자식 프로세스로 spawn, stdio 통신)
  jarvis-memory   메모리/세션/스킬 인덱스
  jarvis-gateway  채널/프로필/크론/페어링

데몬 1개 (백그라운드 상시)
  daemon.ts       Telegram 등 폴링 → claude -p 자식 프로세스로 spawn

보안 6계층
  페어링 → allowedTools → disallowedTools → add-dir → 타임아웃 → 자동 진단

설정 파일
  profiles.yml        프로필 권한
  projects.jsonc      프로젝트 저장소
  channels.yml        채널 활성화
  .env                봇 토큰
  ~/.claude/settings.json  MCP 등록 (jarvis install-mcp로 자동)
```

---

## 다음 단계

처음이라면: [01-getting-started.md](01-getting-started.md) (5분 설치)
깊이 파기: [02-architecture.md](02-architecture.md) (상세 아키텍처)
관리자용: [08-owner-cli.md](08-owner-cli.md) (Owner CLI 전체 가이드)
