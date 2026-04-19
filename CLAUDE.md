# Jarvis — Claude Code 작업 가이드

> 이 파일은 Claude Code가 `~/jarvis`에서 작업을 시작할 때 자동으로 읽는 자기소개서입니다.
> 새 작업을 시작하기 전에 반드시 이 문서를 통해 프로젝트 구조와 핵심 규칙을 인지하세요.

---

## 1. 이 프로젝트가 무엇인가

**Jarvis**는 [Claude Code](https://claude.ai/claude-code) 위에 얹는 **개인 AI 에이전트**입니다.

- **로컬 터미널 대화** (`jarvis chat`) + **외부 채널 협업** (Telegram/Discord/Slack 데몬)을 동시에 지원
- **3계층 메모리** (선언적/절차적/세션 + FTS5) + **Dreaming** (비동기 정리)
- **자율 스킬 생성** + **IntentGate** (의도 분류 후 컨텍스트 프리로딩)
- **프로필 기반 권한 격리** (`owner` 고정 + `developer/reviewer/observer` 예시)

영감: Hermes Agent (자기 학습) · OpenClaw (멀티채널) · Oh My OpenAgent (IntentGate)

---

## 2. 두 디렉토리의 역할 (혼동 금지)

| 경로 | 역할 | Git 추적 |
|------|------|---------|
| `~/jarvis/` | 소스 코드 (이 저장소) | O |
| `~/.jarvis/` | 런타임 데이터 (DB, 유저 설정, 데몬 PID/로그) | X |

전체 디렉토리 트리: [`docs/00-overview.md`](docs/00-overview.md)

---

## 3. 작업 시작 전 자가 점검 체크리스트

새로운 요청을 받았을 때 다음 순서로 확인하세요.

1. **요청이 Jarvis 자체에 대한 것인가?**
   → `docs/00-overview.md`를 먼저 읽어 전체 구조를 파악
2. **메모리 시스템에 관련 정보가 있는가?**
   → `jarvis_memory_recall(query: "...", type: "declarative")` 우선 호출
3. **유사한 과거 작업이 있는가?**
   → `jarvis_session_search(query: "...")` 호출
4. **관련 스킬이 있는가?**
   → `jarvis_memory_recall(query: "...", type: "procedural")` 또는 `~/jarvis/skills/` 확인
5. **변경이 일어났다면 docs도 동기화했는가? ← 절대 규칙**

---

## 3.5 격리 모델 (보안 핵심)

데몬이 외부 채널 요청을 처리할 때 `claude` 자식을 spawn하며 다음 격리를 강제합니다:

| 격리 | 메커니즘 | 코드 |
|------|---------|------|
| 메모리 격리 (장기) | `JARVIS_USER_ID` 환경변수 → MCP 서버 자동 fallback | `packages/memory-server/src/memory-config.ts:resolveUserId` |
| 대화 컨텍스트 (단기) | user_id별 영속 UUID → `claude --session-id` 매 호출 시 주입 | `packages/gateway-server/src/auth.ts:getOrCreateClaudeSessionId` |
| 파일시스템 격리 | `cwd: ~/.jarvis/sandboxes/{safe-user-id}/` (빈 디렉토리) | `packages/gateway-server/src/daemon.ts:ensureSandbox` |
| 디렉토리 화이트리스트 | `--add-dir`는 `add_dirs: [from_projects]`로 명시한 곳만 | `packages/gateway-server/src/permissions.ts:buildClaudeArgs` |
| 도구 권한 | `allowed_tools`/`disallowed_tools` (예: observer는 Read 자체 없음) | `config/profiles.yml` |

`profiles.yml`의 `add_dirs: [from_projects]`는 `projects.jsonc`에서 해당 프로필이 `allowed_profiles`에 포함된 프로젝트만 자동 추가합니다. 매치 0개 = cwd 샌드박스만 접근 가능 (의도된 격리이거나 설정 누락 — `jarvis doctor`로 확인).

## 4. 절대 규칙 (사용자 명시)

### 4.1 코드/설정 변경 시 docs 동기화 필수
사용자 원문: *"지금 세션에서는 내가 요청하고 변경된 작업마다 docs 내용을 항상 동기화해야해."*

영향 매핑:
- `packages/**` 또는 `scripts/**` 변경 → 관련 `docs/{02|03|07|08}-*.md` 점검
- 새 명령어 추가 → `docs/07-commands.md` + `jarvis.sh` help + `README.md`
- 새 설정 파일/필드 → `docs/00-overview.md` §3 + 해당 도메인 문서
- 프로필/권한 모델 변경 → `docs/04-team-members.md` + `docs/08-owner-cli.md`
- 메모리/스킬/Dreaming → `docs/06-memory.md`
- 데몬 동작 변경 → `docs/03-daemon.md`
- personality 관련 → `docs/09-personalization.md`

### 4.2 파일 생성/삭제 전 사용자 승인
글로벌 `~/.claude/CLAUDE.md`의 "Write Operation Approval" 규칙을 따릅니다.

### 4.3 owner 프로필은 절대 변경 금지
`config/profiles.yml`의 `owner` 블록은 고정. 다른 팀원에게 부여 금지.

### 4.4 한국어 응답
모든 사용자 응답·로그·에러 메시지는 한국어.

### 4.5 KISS
현재 요구사항에 대한 최소 해결책만 구현. 미래 가정으로 추상화 금지. 변경 폭이 커지면 사용자 확인 후 진행.

---

## 5. 자주 쓰는 명령어 (전체 목록은 `docs/07-commands.md`)

```bash
# 대화
jarvis chat                  # 터미널 대화 (포그라운드)
jarvis ask "질문"            # 단발 질문

# 데몬
jarvis start | stop | status | logs
jarvis install               # 부팅 자동 시작 (launchd)

# 설정
jarvis create-profile
jarvis edit-profile <name>
jarvis add-project | add-channel
jarvis install-mcp           # ~/.claude/settings.json 자동 패치

# 조회
jarvis list profiles | users | channels | pending
jarvis doctor [--quick]

# 관리
jarvis pair list | approve <code> <profile> | reject <userId>
jarvis project add | rm | ls
jarvis channel ls | enable | disable | token
jarvis user ls | show | profile | rename | rm
```

---

## 6. 핵심 코드 진입점

| 모듈 | 파일 |
|------|------|
| 메모리 MCP 서버 | `packages/memory-server/src/index.ts` |
| 메모리 정책 로더 | `packages/memory-server/src/memory-config.ts` (memory.yml 핫 리로드) |
| Dreaming 엔진 | `packages/memory-server/src/dreaming.ts` |
| 게이트웨이 MCP + 데몬 | `packages/gateway-server/src/{index,daemon,router,permissions,auth,workflow}.ts` |
| 채널 어댑터 | `packages/gateway-server/src/adapters/{telegram,discord,slack,webhook}.ts` |
| Claude Code 훅 | `hooks/{intent-gate,auto-memory,skill-nudge,dreaming-cron}.js` |
| 진단 | `scripts/lib/diagnostics.ts` (+ `scripts/doctor.ts`) |
| 설정 CRUD | `scripts/lib/config.ts` |
| 메인 셸 | `jarvis.sh` |
| 설치 | `setup.sh` (마지막에 `install-mcp.ts` 자동 호출) |

---

## 7. 문서 인덱스

| 문서 | 내용 |
|------|------|
| [00. 전체 개요](docs/00-overview.md) | **항상 먼저 읽으세요** — 디렉토리/워크플로우/MCP/보안 종합 |
| [01. 설치](docs/01-getting-started.md) | 설치 상세 |
| [02. 아키텍처](docs/02-architecture.md) | chat vs start 두 모드, 보안 계층 |
| [03. 데몬](docs/03-daemon.md) | 데몬 + 자동 진단 |
| [04. 팀원](docs/04-team-members.md) | 페어링/프로필 |
| [05. 개발 워크플로우](docs/05-dev-workflow.md) | `/dev`, worktree |
| [06. 메모리](docs/06-memory.md) | 3계층 + Dreaming + 스킬 |
| [07. 명령어](docs/07-commands.md) | 전체 명령 레퍼런스 |
| [08. Owner CLI](docs/08-owner-cli.md) | Owner CLI vs owner 프로필 구분 |
| [09. Personality](docs/09-personalization.md) | 유저별 말투/언어/호칭 |
| [10. Slack 채널 설정](docs/10-slack-setup.md) | Slack App + Socket Mode + 토큰 등록 |

---

## 8. 테스트 + 검증

```bash
cd ~/jarvis && bun test     # 25 pass 기준선 유지
jarvis doctor               # 설정 정합성 + 토큰 라이브 검증
jarvis doctor --quick       # 네트워크 호출 제외 빠른 체크
```

코드 수정 후에는 위 두 명령으로 반드시 검증한 뒤 커밋하세요.
