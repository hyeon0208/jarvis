# 커맨드 레퍼런스

Jarvis의 모든 명령을 한 곳에 정리합니다.

---

## 1. 터미널 명령 (jarvis CLI)

Owner가 로컬 터미널에서 사용하는 명령입니다.

### 대화

| 명령 | 설명 | 예시 |
|------|------|------|
| `jarvis chat` | Jarvis와 인터랙티브 대화 시작 | `jarvis chat` |
| `jarvis ask "..."` | 한 번 질문하고 답변 받기 | `jarvis ask "JPA N+1 뭐야?"` |

### 데몬 관리

| 명령 | 설명 |
|------|------|
| `jarvis start` | 백그라운드 데몬 시작 (채널 리스닝) |
| `jarvis stop` | 데몬 종료 |
| `jarvis restart` | 데몬 재시작 |
| `jarvis status` | 실행 상태 확인 |
| `jarvis logs` | 실시간 로그 (tail -f) |
| `jarvis logs 100` | 최근 100줄부터 표시 |

### 자동 시작

| 명령 | 설명 |
|------|------|
| `jarvis install` | 맥 부팅 시 자동 시작 (launchd 등록) |
| `jarvis uninstall` | 자동 시작 해제 |

### 설정 마법사

| 명령 | 설명 |
|------|------|
| `jarvis create-profile` | 프로필 생성 마법사 (신규) |
| `jarvis edit-profile <name>` | 기존 프로필 수정 (`[현재값]` 표시) |
| `jarvis add-project` | 프로젝트 추가 마법사 (디렉토리 자동 생성) |
| `jarvis add-channel` | 채널 추가 + 토큰 + 라이브 검증 |
| `jarvis install-mcp [--dry-run]` | Claude Code settings.json idempotent 패치 |

### 관리 명령 (비대화형)

| 명령 | 설명 |
|------|------|
| `jarvis pair list` | 대기 중인 페어링 목록 |
| `jarvis pair approve <code> [profile]` | 페어링 승인 (기본: observer) |
| `jarvis pair reject <user_id>` | 페어링 거부 |
| `jarvis project ls\|add\|rm` | 프로젝트 CRUD |
| `jarvis channel ls\|enable\|disable\|token <name> [value]` | 채널 CRUD |
| `jarvis user ls\|show\|profile\|rename\|rm <user_id>` | 유저 관리 |

### 조회/진단

| 명령 | 설명 |
|------|------|
| `jarvis list profiles\|users\|channels\|pending` | 목록 조회 |
| `jarvis doctor` | 전체 진단 (11개 체크) |
| `jarvis doctor --quick` | 네트워크 제외 빠른 진단 |
| `jarvis doctor --silent-ok` | 모두 OK면 출력 없음 (`jarvis chat` 진입 시 자동 호출) |

상세 사용법: [Owner CLI 가이드](08-owner-cli.md)

### 사용 예시

두 명령은 **서로 독립**이며, 필요에 따라 하나만 쓰거나 둘 다 켤 수 있습니다.

```bash
# 터미널에서 직접 대화 — 데몬 불필요
$ jarvis chat
Jarvis 대화 모드 시작...
# (진입 시 jarvis doctor --quick --silent-ok 자동 실행, 문제 있을 때만 출력)

# 외부 채널(Telegram 등) 요청을 받으려면 데몬 기동
$ jarvis start
Jarvis Daemon 시작됨 (PID: 55365)

# 데몬 로그 — 팀원 메시지 처리 내역
$ jarvis logs
[11:20:33] 수신: [telegram] 김철수: /dev 로그인 구현
[11:20:34] claude 실행: profile=developer
```

**병행 시나리오**: Owner가 `jarvis chat`으로 본인 작업을 하면서, 동시에 `jarvis start`(또는 launchd)로 팀원 요청을 백그라운드에서 자동 처리.

---

## 2. Claude Code 스킬 커맨드

`jarvis chat` 또는 Claude Code 세션 안에서 사용하는 명령입니다.

### /jarvis (IntentGate)

| 커맨드 | 설명 | 예시 |
|--------|------|------|
| `/jarvis` | 의도 분석 결과 표시 | `/jarvis` |
| `/jarvis {요청}` | 의도 분석 후 작업 | `/jarvis JPA N+1 해결해줘` |
| `/jarvis stats` | 메모리 통계 (DB 크기, 임계치 포함) | |
| `/jarvis dream` | Dreaming 실행 (memory.yml의 archive_days 자동 적용) | |
| `/jarvis skills` | 스킬 목록 조회 | |
| `/jarvis sync` | 스킬+세션 DB 동기화 | |

> **자동 IntentGate**: `/jarvis` 명시 호출 없이도 모든 입력에 대해 `hooks/intent-gate.js`가 UserPromptSubmit 훅으로 자동 발동합니다. 짧은 인사는 통과, 실제 질문은 메모리 검색 결과를 컨텍스트로 자동 주입. 상세는 [06-memory.md](06-memory.md#intentgate-자동화-userpromptsubmit-훅)

### /skill-generator (스킬 생성)

| 커맨드 | 설명 |
|--------|------|
| `/skill-generator` | 현재 세션을 스킬로 변환 |
| `/skill-generator list` | 생성된 스킬 목록 |
| `/skill-generator edit {이름}` | 기존 스킬 수정 |

### /jarvis-telegram (채널 관리, Owner 전용)

| 커맨드 | 설명 | 예시 |
|--------|------|------|
| `/jarvis-telegram pair list` | 대기 중인 페어링 목록 | |
| `/jarvis-telegram pair approve {코드} {프로필}` | 페어링 승인 | `approve A1B2C3 developer` |
| `/jarvis-telegram pair reject {유저ID}` | 페어링 거부 | `reject telegram:12345` |
| `/jarvis-telegram status` | 채널 상태 | |

---

## 3. 채널 커맨드 (Telegram/Discord/Slack)

팀원이 봇 DM에서 사용하는 명령입니다.
Telegram에서 `/`를 입력하면 자동완성 메뉴가 표시됩니다.

### 일반

| 커맨드 | 설명 | 사용 가능 프로필 |
|--------|------|----------------|
| `/help` | 사용 가능한 명령 목록 | 전체 |
| `/status` | Jarvis 상태 확인 | 전체 |
| `/profile` | 내 프로필/권한 조회 | 전체 |
| `/personality` | 개인화 설정 조회 | 전체 |
| `/clear` (= `/reset`) | 대화 컨텍스트 초기화 — 새 세션 ID 발급 (메모리/personality는 유지) | 전체 |

### 개발 워크플로우

| 커맨드 | 설명 | 사용 가능 프로필 |
|--------|------|----------------|
| `/dev {작업}` | 워크플로우 시작 | owner, developer |
| `/dev status` | 진행 상태 확인 | owner, developer |
| `/dev done` | commit → push → PR 생성 | owner, developer |
| `/dev cancel` | 워크플로우 취소 + 정리 | owner, developer |

### 크론잡

| 커맨드 | 설명 | 사용 가능 프로필 |
|--------|------|----------------|
| `/cron add {스케줄} {작업}` | 크론잡 등록 | 전체 |
| `/cron list` | 크론잡 목록 | 전체 |
| `/cron delete {id}` | 크론잡 삭제 | 전체 |

### 일반 메시지

커맨드가 아닌 일반 메시지는 **AI 질문**으로 처리됩니다:

```
팀원: "Spring Boot에서 Redis 캐시 어떻게 적용해?"
Jarvis: "Spring Boot에서 Redis 캐시를 적용하려면..."
```

---

## 4. 크론잡 스케줄 표현

한국어 자연어로 스케줄을 지정합니다:

| 입력 | 크론 표현식 | 설명 |
|------|-----------|------|
| `매일 9시` | `0 9 * * *` | 매일 오전 9시 |
| `매일 오전 9시` | `0 9 * * *` | 매일 오전 9시 |
| `매일 오후 3시` | `0 15 * * *` | 매일 오후 3시 |
| `평일 10시` | `0 10 * * 1-5` | 월~금 오전 10시 |
| `매주 월요일 9시` | `0 9 * * 1` | 매주 월요일 |
| `매시간` | `0 * * * *` | 매시간 정각 |
| `30분마다` | `*/30 * * * *` | 30분 간격 |
| `0 9 * * 1-5` | 그대로 사용 | 직접 크론 입력 |

### 예시

```
/cron add 매일 9시 오늘 할 일 정리해줘
/cron add 평일 10시 스탠드업 요약
/cron add 매주 월요일 9시 주간 리포트 작성
/cron add 30분마다 서버 상태 확인
```

---

## 5. MCP 도구

Claude Code 세션에서 직접 호출할 수 있는 MCP 도구입니다.
일반적으로 스킬 커맨드가 내부적으로 호출하므로 직접 사용할 일은 적습니다.

### 메모리 서버 (jarvis-memory)

| 도구 | 설명 |
|------|------|
| `jarvis_memory_save` | 메모리 저장 (선언적/절차적) |
| `jarvis_memory_recall` | FTS5 전문 검색 |
| `jarvis_memory_list` | 메모리 목록 조회 |
| `jarvis_session_save` | 세션 기록 (시작/메시지/종료) |
| `jarvis_session_search` | 과거 세션 검색 |
| `jarvis_memory_dream` | Dreaming 실행 |
| `jarvis_dream_history` | Dreaming 히스토리 |
| `jarvis_user_profile` | 유저 프로파일 CRUD |
| `jarvis_memory_stats` | 전체 통계 |
| `jarvis_sync_skills` | 스킬 인덱스 동기화 |
| `jarvis_sync_sessions` | 세션 로그 동기화 |

### 게이트웨이 서버 (jarvis-gateway)

| 도구 | 설명 |
|------|------|
| `jarvis_gateway_route` | 채널 메시지 라우팅 |
| `jarvis_gateway_send` | 채널로 메시지 전송 |
| `jarvis_gateway_pair` | DM 페어링 관리 |
| `jarvis_profile_manage` | 프로필/개인화 관리 |
| `jarvis_cron_manage` | 크론잡 CRUD |
| `jarvis_sandbox_config` | Docker 샌드박스 설정 |
| `jarvis_worktree_manage` | git worktree 관리 |
| `jarvis_gateway_status` | 게이트웨이 상태 |
