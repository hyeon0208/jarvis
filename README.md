# Jarvis

> Personal AI Agent built on Claude Code — 자기 학습하는 멀티채널 개인화 에이전트

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## 개요

Jarvis는 [Claude Code](https://claude.ai/claude-code)를 기반으로 구축된 개인화 AI 에이전트입니다.
[Hermes Agent](https://github.com/nousresearch/hermes-agent), [OpenClaw](https://github.com/openclaw/openclaw), [Oh My OpenAgent](https://github.com/code-yeongyu/oh-my-openagent)의 핵심 기능을 통합하여, Claude Code 생태계와 완전히 호환되면서도 고급 기능을 제공합니다.

### 왜 Jarvis인가?

| 기존 에이전트 | 문제점 | Jarvis의 해법 |
|-------------|--------|-------------|
| 독립 하네스 | 서드파티 차단 위험 | Claude Code 네이티브 (구독 기반 안전) |
| 자체 생태계 | 기존 도구와 단절 | GSD, gstack 등 기존 생태계 100% 호환 |
| 단일 사용자 | 팀 협업 불가 | 멀티채널 멀티유저 + Docker 격리 |

## 핵심 기능

### 1. 3계층 메모리 + Dreaming
- **선언적 메모리**: 사실, 선호도, 기술 스택 프로파일
- **절차적 메모리**: 자율 생성된 스킬 인덱스
- **세션 검색**: SQLite FTS5 기반 과거 세션 전문 검색
- **Dreaming**: 비동기 메모리 정리 — 중복 병합, 오래된 사실 아카이브

### 2. 자율 스킬 생성
복잡한 작업 완수 후 자동으로 `SKILL.md`를 생성하여 재사용 가능한 지식으로 보존합니다.
에이전트가 경험으로부터 학습하고 성장합니다.

### 3. IntentGate (의도 분석)
사용자 요청을 사전 분석하여:
- 작업 카테고리 분류 (코딩/디버깅/리서치/설계 등)
- 복잡도 추정 (quick/standard/deep)
- 관련 스킬 자동 매칭
- 과거 메모리/세션 프리로딩

### 4. 멀티채널 게이트웨이
- **Telegram** / **Discord** / **Slack** 지원
- 팀원이 자신의 채널에서 직접 요청 → 응답을 같은 채널로
- DM 페어링 보안 (알 수 없는 발신자 차단)

### 5. 프로필 기반 권한 관리
| 프로필 | 읽기 | 쓰기 | 실행 | 크론 |
|--------|------|------|------|------|
| admin | * | * | * | O |
| developer | * | 제한 | 제한 | O |
| reviewer | * | X | X | O |
| observer | 제한 | X | X | O |

각 프로필 내에서 개인화 가능 (에이전트 성격, 언어, 호칭 등).

### 6. Docker 샌드박스
팀원의 요청은 격리된 Docker 컨테이너에서 실행:
- 파일시스템 격리 (허용 디렉토리만 읽기 전용 마운트)
- 네트워크 격리 (내부 네트워크만)
- 리소스 제한 (CPU, 메모리, PID, 타임아웃)

### 7. 크론잡 (모든 유저)
모든 유저가 자신의 채널에서 반복 작업을 등록할 수 있습니다:
```
/cron add 매일 9시 오늘 할 일 정리해줘
/cron list
/cron delete daily-standup
```

## 아키텍처

```
Claude Code (구독 기반)
├── Skills (스킬 파일들)
├── Hooks (자동화 훅들)
└── MCP Servers (로컬)
     ├── jarvis-memory    ← 3계층 메모리 엔진
     └── jarvis-gateway   ← 멀티채널 게이트웨이
          └── Docker Sandbox Pool
```

## 빠른 시작

### 요구 사항
- [Claude Code](https://claude.ai/claude-code) 구독
- [Bun](https://bun.sh/) v1.0+
- [Docker](https://www.docker.com/) (팀원 샌드박스 사용 시)

### 설치

```bash
# 1. 클론
git clone https://github.com/hyeon0208/jarvis.git ~/jarvis
cd ~/jarvis

# 2. 의존성 설치
bun install

# 3. 환경 변수 설정
cp .env.example .env
# .env 파일을 편집하여 채널 토큰 입력

# 4. Claude Code에 MCP 서버 등록
# ~/.claude/settings.json에 추가:
```

```jsonc
{
  "mcpServers": {
    "jarvis-memory": {
      "command": "bun",
      "args": ["run", "~/jarvis/packages/memory-server/src/index.ts"]
    },
    "jarvis-gateway": {
      "command": "bun",
      "args": ["run", "~/jarvis/packages/gateway-server/src/index.ts"]
    }
  }
}
```

```bash
# 5. 스킬 심볼릭 링크
ln -s ~/jarvis/skills/jarvis ~/.claude/skills/jarvis
ln -s ~/jarvis/skills/skill-generator ~/.claude/skills/skill-generator
ln -s ~/jarvis/skills/jarvis-telegram ~/.claude/skills/jarvis-telegram

# 6. (선택) Docker 샌드박스 빌드
bun run sandbox:build
```

## 프로젝트 구조

```
jarvis/
├── packages/
│   ├── memory-server/     ← 메모리 MCP 서버
│   ├── gateway-server/    ← 채널 게이트웨이 MCP 서버
│   └── sandbox/           ← Docker 샌드박스 이미지
├── skills/                ← Claude Code 스킬
├── hooks/                 ← Claude Code 훅
├── config/                ← 프로필/설정 템플릿
├── docker-compose.yml
└── package.json
```

## 로드맵

- [x] Phase 1-A: 프로젝트 스캐폴딩
- [x] Phase 1-B: 메모리 MCP 서버 구현 (SQLite + FTS5, 14개 테스트)
- [x] Phase 1-C: 자동 메모리 훅 + Dreaming
- [x] Phase 2: 자율 스킬 생성 시스템 + 보안 스캔
- [x] Phase 3: IntentGate 스킬 + 스마트 라우팅 설정
- [x] Phase 4-A: 게이트웨이 코어 + 프로필/인증 + DM 페어링
- [x] Phase 4-B: Docker 샌드박스 설정 생성기
- [x] Phase 4-C: 채널 어댑터 (Telegram/Discord/Slack) + MCP 도구
- [x] Phase 4-D: 크론잡 시스템 (자연어 → 크론 표현식)
- [x] Phase 4-E: Claude Code 설정 등록 + 스킬 심볼릭 링크
- [ ] Phase 5: 멀티모델 에이전트 (후순위)

## 영감을 준 프로젝트

- [Hermes Agent](https://github.com/nousresearch/hermes-agent) — 자기 개선 학습 루프, 3계층 메모리
- [OpenClaw](https://github.com/openclaw/openclaw) — 멀티채널 게이트웨이, 플러그인 아키텍처
- [Oh My OpenAgent](https://github.com/code-yeongyu/oh-my-openagent) — Discipline Agents, IntentGate

## 라이선스

[MIT](LICENSE)
