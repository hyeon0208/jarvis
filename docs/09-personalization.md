# 유저별 에이전트 성격 (Personality)

Jarvis는 **유저마다** 에이전트의 말투, 언어, 상세도, 호칭을 다르게 설정할 수 있습니다.
이 설정은 외부 채널(Telegram/Discord/Slack) 응답 생성 시 **시스템 프롬프트로 주입**되어 Claude의 응답 스타일을 바꿉니다.

---

## 목차

1. [설정 가능한 필드](#1-설정-가능한-필드)
2. [저장 위치 + 반영 시점](#2-저장-위치--반영-시점)
3. [Owner 본인 설정](#3-owner-본인-설정)
4. [팀원 설정](#4-팀원-설정-owner가-관리)
5. [팀원 본인이 확인](#5-팀원-본인이-확인)
6. [내부 동작 (시스템 프롬프트 변환)](#6-내부-동작-시스템-프롬프트-변환)
7. [프로필 기본 personality](#7-프로필-기본-personality)

---

## 1. 설정 가능한 필드

기본 필드는 고정 선택지이고, `system_prompt_extra`는 자유 서술입니다.
LLM 시스템 프롬프트는 토큰 효율을 위해 영어로 주입되지만, 응답 언어는 `language` 필드로 제어됩니다 (기본 한국어).

| 필드 | 선택지 | 효과 (실제 시스템 프롬프트로 주입되는 문장, 영어) |
|------|-------|--------------------------------------|
| `tone` | `formal` | "Use a formal and polite tone." |
| | `casual` | "Use a casual and friendly tone." |
| | `friendly` | "Use a warm and friendly tone." |
| | `technical` | "Use a technical and precise tone." |
| `language` | `ko` | "Respond in Korean (한국어)." |
| | `en` | "Respond in English." |
| | `ja` | "Respond in Japanese (日本語)." |
| | (미지정) | "Respond in Korean (한국어) by default." |
| | (그 외) | "Respond in {값}." |
| `verbosity` | `concise` | "Keep responses terse — only the essentials." |
| | `normal` | (추가 지시 없음) |
| | `detailed` | "Include detailed explanations." |
| `emoji` | `true` / `false` | **현재 문자열로 주입되지 않음** (향후 확장) |
| `nickname` | 자유 문자열 | `Your name is "{값}".` |
| **`system_prompt_extra`** | **자유 서술** | **위 필드로 표현 불가능한 상세 캐릭터/역할/도메인 지시를 그대로 주입** (프롬프트 끝에 append). 영어 권장 (토큰 효율). |

구현 근거: [`packages/gateway-server/src/permissions.ts`](../packages/gateway-server/src/permissions.ts) — `buildPersonalityPrompt()` 함수.

### `system_prompt_extra` 사용 예시

고정 필드만으로 표현이 어려운 캐릭터/역할/도메인 전문가를 만들 때 씁니다. user JSON의 `personality.system_prompt_extra`에 자유롭게 작성:

```json
{
  "personality": {
    "tone": "formal",
    "language": "ko",
    "nickname": "집사",
    "system_prompt_extra": "You are a devoted butler serving the user. Address them with the highest Korean honorific (극존칭/합쇼체). Anticipate needs and offer gentle suggestions."
  }
}
```

또는 도메인 전문가:
```json
{
  "personality": {
    "tone": "technical",
    "verbosity": "detailed",
    "system_prompt_extra": "You are a senior SRE specializing in Kubernetes. Always consider scaling, observability, and incident response. Cite relevant kubectl commands and include rollback procedures."
  }
}
```

**순서**: 기본 필드 → `system_prompt_extra` (가장 마지막에 append). 따라서 extra가 상위 필드의 지시를 보강/덮어쓸 수 있습니다.

**길이 가이드**: 수백 자 권장. 너무 길면 매 요청의 시스템 프롬프트가 커져 토큰 비용/지연 증가.

---

## 2. 저장 위치 + 반영 시점

### 저장 파일

```
~/.jarvis/users/{user_id}.json
```

예시 (`telegram:1613476146`):

```json
{
  "user_id": "telegram:1613476146",
  "name": "hyeonjun",
  "profile": "owner",
  "channel": "telegram",
  "paired": true,
  "personality": {
    "tone": "friendly",
    "language": "ko",
    "verbosity": "normal",
    "emoji": false,
    "nickname": "Jarvis",
    "system_prompt_extra": ""
  },
  "cron_jobs": []
}
```

> `system_prompt_extra`는 없거나 빈 문자열이면 주입되지 않습니다. 상세 캐릭터가 필요할 때만 채우세요.

### 반영 시점

데몬은 **요청마다 이 파일을 읽어** 시스템 프롬프트를 구성합니다. 따라서 **즉시 반영**되고 데몬 재시작이 필요 없습니다.

---

## 3. Owner 본인 설정

### 방법 A: 파일 직접 편집

`~/.jarvis/users/owner.json`을 열어서 `personality` 블록을 수정하면 즉시 반영됩니다.

```bash
# 현재 설정 조회
cat ~/.jarvis/users/owner.json

# 편집
vi ~/.jarvis/users/owner.json
```

### 방법 B: MCP 도구 (Claude Code 대화 중)

```
jarvis_profile_manage(
  action: "set_personality",
  user_id: "owner",
  personality: {
    "tone": "technical",
    "verbosity": "detailed",
    "nickname": "T-800"
  }
)
```

지정하지 않은 필드는 기존 값이 유지됩니다 (부분 병합).

### 예시 비교

**Before** (`friendly` + `normal`):
> 안녕하세요! JPA N+1 문제는 연관 엔티티를 조회할 때 발생하는 성능 문제입니다. ...

**After** (`technical` + `detailed`):
> JPA N+1 문제는 `@OneToMany`/`@ManyToOne` 관계에서 부모 엔티티 1회 조회 이후 각 자식에 대해 N회 추가 쿼리가 발생하는 성능 이슈입니다. 원인은 기본 `FetchType.LAZY`의 프록시 해소 시점이 지연된 탓이며, 해결책은 ...

---

## 4. 팀원 설정 (Owner가 관리)

Owner가 외부 채널 팀원의 personality를 지정/변경하는 방법입니다.

### MCP 도구 (Claude Code 대화 중)

```
jarvis_profile_manage(
  action: "set_personality",
  user_id: "telegram:12345",
  personality: {
    "tone": "casual",
    "language": "ko",
    "verbosity": "concise",
    "nickname": "자비스"
  }
)
```

### 파일 직접 편집

```
~/.jarvis/users/telegram_12345.json
```

> `user_id`의 `:`는 파일명에서 `_`로 치환되어 저장됩니다.

### 설정 확인

```bash
# 터미널에서
jarvis user show telegram:12345

# 또는 파일 직접 확인
cat ~/.jarvis/users/telegram_12345.json
```

---

## 5. 팀원 본인이 확인

팀원은 자기 채널에서 `/personality` 커맨드로 현재 설정을 조회할 수 있습니다:

```
팀원 → /personality

봇 → 현재 개인화 설정:
     톤: casual
     언어: ko
     상세도: concise
     호칭: 자비스
```

**주의**: 현재 팀원이 **자기 personality를 채널에서 직접 수정하는 방법은 지원되지 않습니다**. Owner가 MCP 도구로만 변경 가능합니다. 확장이 필요하면 router.ts에 `/personality set ...` 커맨드를 추가해야 합니다.

---

## 6. 내부 동작 (시스템 프롬프트 변환)

### 전체 흐름

```
1. 팀원 메시지 수신 (daemon.ts)
    │
    ▼
2. loadUserConfig(user_id) — ~/.jarvis/users/{id}.json 읽기
    │
    ▼
3. buildPersonalityPrompt(personality, userName, "external-channel")
    │  ↓ 위 필드 테이블 매핑으로 시스템 프롬프트 문자열 생성
    │  예:
    │  "당신은 Jarvis, 개인화된 AI 에이전트입니다. ...
    │   사용자 이름: 김철수
    │   편안하고 친근한 톤으로 응답하세요.
    │   한국어로 응답하세요.
    │   응답은 간결하게 핵심만 전달하세요.
    │   당신의 이름은 "자비스"입니다."
    │
    ▼
4. claude -p "{원본 메시지}" --append-system-prompt "{위 문자열}"
    │
    ▼
5. Claude가 해당 톤/언어/상세도/호칭으로 응답 생성
```

### 기본 시스템 프롬프트

값이 모두 비어 있어도 항상 주입되는 문장들:

> 당신은 Jarvis, 개인화된 AI 에이전트입니다.
> 지금 외부 채널 메시지에 대한 응답을 생성하고 있습니다.
> 응답 전송은 시스템이 자동으로 처리하므로, 당신은 답변 내용만 작성하세요.
> 채널 전송 시도, 메타 설명은 하지 마세요.
> 순수한 답변 텍스트만 출력하세요.
> 응답은 2000자 이내로 간결하게 작성하세요.
> 응답은 plain text로 작성하세요. markdown 문법 사용 금지: **볼드**, *이탤릭*, _언더라인_, # 헤더, `인라인 코드`, ```코드 블록``` 전부 쓰지 마세요. 목록은 단순 하이픈(- 항목)만 허용.
> [중요] 답변 작성 전, 사용자 요청이 단순 인사나 한 줄 잡담이 아니라면 다음을 먼저 호출하세요:
> 1) jarvis_memory_recall(query: 핵심키워드, type: 'declarative') — 사용자 선호/과거 결정 확인
> 2) jarvis_session_search(query: 핵심키워드) — 유사 과거 작업 확인
> 위 결과를 답변에 반영하되, 도구 호출 사실 자체는 답변에 노출하지 마세요.

이 지시는 personality와 무관하게 항상 붙습니다 (외부 채널 메시지 처리 시). 메모리 프리로딩 강제 지시는 IntentGate 자동화의 일환으로 추가되었습니다.

**왜 plain text인가**: Telegram(MarkdownV2) · Slack(mrkdwn) · Discord(표준 md) · Webhook(임의)는 각각 마크다운 문법이 다르고 이스케이프 규칙이 까다롭습니다. 후처리로 채널마다 변환기를 붙이는 대신 **모델이 애초에 plain text로 답하게** 하면 어댑터 로직이 단순해지고 출력 토큰도 약간 줄어듭니다. 이 정책은 로컬 `jarvis chat`/`ask` (`jarvis.sh`의 SYSTEM_PROMPT)에도 동일하게 적용됩니다.

### Owner의 `jarvis chat`은?

Owner의 터미널 대화(`jarvis chat`)는 **데몬을 거치지 않으므로** 위 흐름이 아닌 `jarvis.sh`의 `SYSTEM_PROMPT`를 씁니다. 이 프롬프트에는 다음이 들어 있습니다:

- 자기 정보 참조 안내 (`~/jarvis/CLAUDE.md`, `docs/00-overview.md`)
- IntentGate 자가 점검 절차 (메모리 회상, 세션 검색, 스킬 매칭)
- 한국어 응답

다만 **개별 유저의 personality(말투/언어/호칭)는 아직 chat에 반영되지 않습니다**. 터미널에서 owner.json의 personality를 적용하려면 `jarvis.sh`의 `cmd_chat`이 `~/.jarvis/users/owner.json`을 읽어 동적으로 시스템 프롬프트를 합성해야 합니다 (현재 미구현).

---

## 7. 프로필 기본 personality

`profiles.yml`의 각 프로필에 `personality` 블록을 두면 해당 프로필을 받은 **전원에게 자동 적용**됩니다.
유저 JSON에도 personality가 있으면 유저 설정이 우선합니다 (`{프로필 기본} + {유저 개별} = 최종 personality`).

### 동작 흐름

1. `daemon.ts:executeWithClaude` 진입 → `mergePersonality(userPersonality, profileName)` 호출 (구현: [permissions.ts:312](../packages/gateway-server/src/permissions.ts))
2. 병합된 personality를 `buildPersonalityPrompt`에 전달 → 시스템 프롬프트로 주입
3. Claude CLI가 해당 페르소나로 응답

### 실제 사용 예시: `macho` 프로필

`macho` 프로필은 이 메커니즘으로 **"상남자" 페르소나**를 전원에게 강제합니다:

```yaml
# config/profiles.yml
macho:
  description: "상남자 — 외부 검색/API/(후속)브라우저, 로컬 접근 X"
  claude:
    allowed_tools: [WebSearch, WebFetch, "Bash(curl:*)", ...]
    system_prompt: |
      You are the external-facing assistant. No local file access.
  personality:              # ← 프로필 기본 personality
    tone: casual
    verbosity: normal
    system_prompt_extra: |
      Persona: 상남자. Be direct, realistic, and decisive. ...
      Dislikes: 마라탕 and sweets/desserts. ...
      Taboo word: never say "졸려" when tired. Always say "잠온다" instead.
```

`jarvis pair approve <code> macho`로 승인된 사용자는 본인 JSON에 personality가 없어도 위 값이 자동으로 적용됩니다. 일부 필드만 오버라이드하려면 `~/.jarvis/users/{user_id}.json`에 해당 필드만 써 넣으면 됩니다 (나머지는 프로필 기본값 상속).

### 기존 프로필 (`owner`/`developer`/`reviewer`/`observer`)은?

기본 저장소의 이 4개 프로필에는 `personality` 블록이 없으므로 기존 동작(유저 JSON 값만 사용) 그대로입니다. 필요하면 해당 프로필에도 `personality` 블록을 추가할 수 있습니다 (예: `developer`에 `tone: technical` 기본값).

---

## 관련 문서

- [04. 팀원 등록/관리](04-team-members.md) — 페어링 + 프로필 관리
- [07. 커맨드 레퍼런스](07-commands.md) — `/personality`, `jarvis user`
- [08. Owner CLI](08-owner-cli.md) — `jarvis user profile/rename/show`
