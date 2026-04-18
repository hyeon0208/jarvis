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
7. [프로필 기본 personality (현재 미구현)](#7-프로필-기본-personality-현재-미구현)

---

## 1. 설정 가능한 필드

| 필드 | 선택지 | 효과 (실제 시스템 프롬프트로 주입되는 문장) |
|------|-------|--------------------------------------|
| `tone` | `formal` | "정중하고 격식 있는 톤으로 응답하세요." |
| | `casual` | "편안하고 친근한 톤으로 응답하세요." |
| | `friendly` | "밝고 친절한 톤으로 응답하세요." |
| | `technical` | "기술적이고 정확한 톤으로 응답하세요." |
| `language` | `ko` | "한국어로 응답하세요." |
| | `en` | "Respond in English." |
| | `ja` | "日本語で応答してください。" |
| | (그 외) | "{입력값}로 응답하세요." |
| `verbosity` | `concise` | "응답은 간결하게 핵심만 전달하세요." |
| | `normal` | (추가 지시 없음) |
| | `detailed` | "응답은 상세하게 설명을 포함하세요." |
| `emoji` | `true` / `false` | **현재 문자열로 주입되지 않음** (향후 확장) |
| `nickname` | 자유 문자열 | "당신의 이름은 \"{값}\"입니다." |

구현 근거: [`packages/gateway-server/src/permissions.ts`](../packages/gateway-server/src/permissions.ts) — `buildPersonalityPrompt()` 함수.

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
    "nickname": "Jarvis"
  },
  "cron_jobs": []
}
```

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
> MCP 도구 호출, 채널 전송 시도, 메타 설명은 하지 마세요.
> 순수한 답변 텍스트만 출력하세요.
> 응답은 2000자 이내로 간결하게 작성하세요.

이 지시는 personality와 무관하게 항상 붙습니다 (외부 채널 메시지 처리 시).

### Owner의 `jarvis chat`은?

Owner의 터미널 대화(`jarvis chat`)는 **데몬을 거치지 않으므로** 위 흐름이 아닌 다른 시스템 프롬프트를 씁니다. 현재는 `jarvis.sh`의 `cmd_chat`이 고정 시스템 프롬프트만 주입합니다. 터미널에서 personality를 반영하고 싶으면 `jarvis.sh`를 확장해야 합니다 (현재 미지원).

---

## 7. 프로필 기본 personality (현재 미구현)

설계상 `profiles.yml`의 각 프로필에 기본 personality를 둘 수 있는 필드가 타입에 정의되어 있고, `mergePersonality()` 함수도 작성되어 있습니다 ([permissions.ts:244](../packages/gateway-server/src/permissions.ts)). 예상 동작:

```yaml
# config/profiles.yml (구상)
developer:
  personality:     # 프로필 기본값
    tone: technical
    verbosity: detailed
```

→ 실행 시 `{프로필 기본} + {유저 개별} = 최종 personality` (유저 개별이 우선).

**현 상태**: `mergePersonality()` 함수는 정의되어 있지만 `daemon.ts`에서 호출하지 않습니다. 데몬은 유저 파일의 personality만 그대로 사용합니다. 프로필별 기본값 기능을 쓰려면 추가 구현이 필요합니다 (`daemon.ts`의 `executeWithClaude`에서 `buildPersonalityPrompt` 호출 전에 `mergePersonality(personality, profileName)` 적용).

---

## 관련 문서

- [04. 팀원 등록/관리](04-team-members.md) — 페어링 + 프로필 관리
- [07. 커맨드 레퍼런스](07-commands.md) — `/personality`, `jarvis user`
- [08. Owner CLI](08-owner-cli.md) — `jarvis user profile/rename/show`
