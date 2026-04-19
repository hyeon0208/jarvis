# 팀원 등록 및 관리

## 개요

팀원은 **Telegram에서 Jarvis 봇에 DM**을 보내 사용합니다.
Owner가 페어링 코드를 승인하고 프로필을 지정하면, 해당 권한 범위 내에서 Jarvis를 사용할 수 있습니다.

## 전체 흐름

```
┌──────────┐     ┌──────────────┐     ┌──────────┐
│ 팀원     │     │ Telegram 봇  │     │ Owner    │
│ (모바일)  │     │ @jv_gw_bot   │     │ (터미널)  │
└────┬─────┘     └──────┬───────┘     └────┬─────┘
     │                  │                  │
     │  1. 봇 검색 후    │                  │
     │     메시지 전송    │                  │
     ├─────────────────>│                  │
     │                  │                  │
     │  2. 페어링 코드   │                  │
     │     발급          │                  │
     │<─────────────────┤                  │
     │                  │                  │
     │  3. 코드를 Owner에게 전달 (카톡 등)   │
     ├──────────────────────────────────-->│
     │                  │                  │
     │                  │  4. 프로필 지정    │
     │                  │     승인          │
     │                  │<─────────────────┤
     │                  │                  │
     │  5. 이후 메시지는 │                  │
     │     바로 처리됨   │                  │
     │<────────────────>│                  │
```

## 1단계: 팀원이 봇에 메시지 전송

팀원이 자기 모바일에서:

1. Telegram 앱 열기
2. 검색창에 `@jv_gw_bot` 검색
3. "시작" 버튼 클릭
4. 아무 메시지 전송 (예: "안녕하세요")

```
팀원 → "안녕하세요"
봇   → "안녕하세요 김철수님! Jarvis를 사용하려면 페어링이 필요합니다.

        페어링 코드: A1B2C3

        관리자에게 이 코드를 전달하세요. 코드는 24시간 후 만료됩니다."
```

## 2단계: Owner가 승인

팀원이 카톡, 슬랙 등으로 코드를 알려주면:

```bash
# 터미널에서
jarvis chat
```

```
# 대화 중
/jarvis-telegram pair list
```

```
# 출력 예시:
대기 중인 페어링:
  코드: A1B2C3
  이름: 김철수
  채널: telegram
  요청 시각: 2026-04-16 10:38
  만료: 2026-04-17 10:38
```

```
# 프로필을 지정하여 승인
/jarvis-telegram pair approve A1B2C3 developer
```

**approve 뒤에 붙이는 단어가 프로필**입니다:

| 승인 명령 | 결과 |
|----------|------|
| `approve A1B2C3 owner` | **Owner 본인 전용** — 전체 권한. 다른 팀원에게 부여 금지 |
| `approve A1B2C3 developer` | 코드 읽기/쓰기, git, 테스트 |
| `approve A1B2C3 reviewer` | 읽기 전용, git 조회 |
| `approve A1B2C3 observer` | 질문/검색만 가능 |

## 3단계: 팀원이 사용

승인 후 팀원이 봇에 메시지를 보내면 바로 처리됩니다:

```
팀원 → "Spring Boot에서 JPA N+1 문제 뭐야?"
봇   → "JPA N+1 문제는 연관 엔티티를 조회할 때 발생하는..."
```

## 프로필 구조

프로필은 `config/profiles.yml`에 정의되어 있고 **마음대로 추가/수정**할 수 있습니다.
기본 저장소에는 아래 4개가 **예시로 제공**됩니다. 실제 사용 전에 `jarvis edit-profile <name>`로 본인 팀에 맞게 조정하세요.

### owner (Owner 본인 전용, 고정)

유일하게 **변경하지 말아야 할 프로필**입니다. `skip_permissions: true`로 모든 제한을 우회합니다.

```yaml
owner:
  claude:
    skip_permissions: true
    effort: high
  timeout: 600
```

> 절대 다른 팀원에게 이 프로필을 부여하지 마세요. `jarvis` 쉘 명령까지 실행 가능합니다.

### 나머지 프로필은 **예시**입니다

기본 저장소의 `developer`, `reviewer`, `observer`는 **일반적인 팀 구성을 참고해 만든 샘플**입니다.
본인 환경에 맞게 다음 방법으로 조정하세요:

1. **기존 예시 수정**: `jarvis edit-profile developer` — 도구/디렉토리/프롬프트 질문형 수정
2. **새 프로필 생성**: `jarvis create-profile` — 처음부터 원하는 권한으로 설정
3. **YAML 직접 편집**: `config/profiles.yml` 수정 (핫 리로드 지원)

기본 예시의 대략적인 범위:

| 프로필 | 범위 요약 | 디렉토리 격리 |
|--------|---------|------------|
| `developer` | 프로젝트 내 코드 읽기/쓰기, git add/commit/push, 빌드/테스트 실행 | `from_projects` (developer가 allowed_profiles에 포함된 프로젝트만) |
| `reviewer` | 코드 읽기 + git 조회 (수정 불가) | `from_projects` (reviewer가 포함된 프로젝트만) |
| `observer` | **로컬 파일 접근 X** — WebSearch/WebFetch + 메모리 검색만 | 디렉토리 접근 없음 (cwd 샌드박스만) |

> **observer는 의도적으로 `Read`/`Glob`/`Grep`이 제거**되어 있습니다. 정의가 "질문/검색만"이므로 로컬 파일을 보지 못해야 합니다. 코드를 봐야 할 일이 있으면 `reviewer` 프로필을 부여하세요.

### 격리 메커니즘 한눈에

각 채널 요청은 `claude` 자식 프로세스로 spawn되며, 다음 3중 격리가 적용됩니다:

1. **cwd 샌드박스** — `~/.jarvis/sandboxes/{safe-user-id}/` (빈 디렉토리). Read 도구가 cwd 하위를 탐색해도 아무것도 없음 → 홈/시스템 자동 차단.
2. **`--add-dir` 화이트리스트** — `add_dirs: [from_projects]`로 명시한 디렉토리만 추가 접근 가능. `projects.jsonc`의 `allowed_profiles`로 프로필별 권한 결정.
3. **도구 제한** — `allowed_tools`/`disallowed_tools`로 `Read`/`Write`/`Bash` 등 가능 여부 자체를 제어.

자세히: [02. 아키텍처 — 보안 계층](02-architecture.md#보안-계층)

실제 포함된 정확한 도구 목록은 현재 `config/profiles.yml` 파일이 **단일 진실 공급원(single source of truth)** 입니다. 아래 명령으로 확인하세요:

```bash
jarvis list profiles
cat ~/jarvis/config/profiles.yml
```

### 프로필 커스터마이징 예시

```bash
# 기존 developer에 Docker 명령 추가
jarvis edit-profile developer
# → allowed_tools 수정 단계에서 "항목 추가" 선택 → "Bash(docker ps:*),Bash(docker logs:*)"

# 인턴용 새 프로필 생성
jarvis create-profile
# → 이름: intern, 허용: 읽기만, 디렉토리: docs/ 등으로 지정
```

## 개인화 설정

각 팀원은 **에이전트 성격(말투/언어/상세도/호칭)** 을 커스터마이징할 수 있습니다.
짧은 예시:

```
jarvis_profile_manage(
  action: "set_personality",
  user_id: "telegram:12345",
  personality: { "tone": "casual", "nickname": "자비스" }
)
```

전체 필드, 실제 시스템 프롬프트 변환 흐름, Owner/팀원 설정 방법, 현재 미구현 기능은 **[09. 유저별 Personality](09-personalization.md)** 문서를 참고하세요.

## 팀원 관리

### 프로필 변경

```
jarvis_profile_manage(
  action: "set_user_profile",
  user_id: "telegram:12345",
  profile: "reviewer"           # developer → reviewer로 변경
)
```

### 페어링 거부

```
/jarvis-telegram pair reject telegram:12345
```

### 등록된 유저 확인

```
jarvis_profile_manage(action: "list_profiles")
```

## FAQ

### Q: 봇을 프로필마다 따로 만들어야 하나요?

아닙니다. **봇 1개**가 모든 팀원의 요청을 받습니다.
누가 보냈는지는 `chat_id`로 자동 구분되고, 프로필은 유저에 붙습니다.

### Q: 팀원끼리 대화가 보이나요?

아닙니다. 각 팀원은 **자기만의 DM**에서 봇과 1:1로 대화합니다.
다른 팀원의 대화는 볼 수 없습니다.

### Q: 요청 로그는 어떻게 보나요?

```bash
jarvis logs
```

모든 팀원의 요청이 `~/.jarvis/daemon.log`에 기록됩니다.

### Q: 페어링 코드가 만료되면?

24시간 후 자동 만료됩니다. 팀원이 다시 메시지를 보내면 새 코드가 발급됩니다.

## 다음 단계

- [개발 워크플로우](05-dev-workflow.md) — developer 프로필의 `/dev` 커맨드
- [커맨드 레퍼런스](07-commands.md) — 전체 명령 목록
