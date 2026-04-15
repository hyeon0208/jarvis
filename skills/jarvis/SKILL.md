---
name: jarvis
description: "Jarvis 메인 오케스트레이터 스킬. IntentGate (의도 분석), 스킬 매칭, 메모리 프리로딩을 수행하여 Claude Code의 응답 품질을 극대화합니다. 복잡한 작업 시작 전에 자동으로 활성화되어 컨텍스트를 풍부하게 합니다. /jarvis 로 수동 호출 가능."
---

# Jarvis — IntentGate 오케스트레이터

## 역할

사용자의 요청을 **사전 분석**하고, 최적의 컨텍스트를 **프리로딩**하여
Claude Code의 응답 품질을 극대화합니다.

## 실행 절차

`/jarvis` 또는 `/jarvis {요청}` 으로 호출하면 다음을 수행합니다:

### Step 1: 의도 분석 (IntentGate)

사용자 요청을 분석하여 **카테고리**와 **복잡도**를 판단합니다.

#### 카테고리 분류

| 카테고리 | 트리거 키워드 예시 | 설명 |
|---------|-------------------|------|
| `coding` | 구현, 만들어, 추가, 기능, 개발 | 새 코드 작성 |
| `debugging` | 버그, 에러, 안됨, 수정, 왜, 오류 | 문제 해결 |
| `refactoring` | 리팩토링, 개선, 정리, 클린, 구조 | 코드 개선 |
| `research` | 찾아, 검색, 조사, 어떻게, 뭐가 | 정보 탐색 |
| `review` | 리뷰, 검토, PR, 코드리뷰, 분석 | 코드 평가 |
| `question` | 뭐야, 설명, 알려, 차이, 비교 | 지식 질문 |
| `design` | 설계, 아키텍처, 구조, ERD, 다이어그램 | 시스템 설계 |
| `devops` | 배포, CI, CD, 도커, 쿠버, 파이프라인 | 인프라/배포 |
| `test` | 테스트, 검증, TDD, 커버리지 | 테스트 작성 |

#### 복잡도 추정

| 레벨 | 기준 | 행동 |
|------|------|------|
| `quick` | 단일 파일, 명확한 변경, 5분 내 | 즉시 실행 |
| `standard` | 여러 파일, 일반적 작업, 5-30분 | 스킬/메모리 프리로딩 |
| `deep` | 복잡한 분석, 멀티스텝, 30분+ | 계획 수립 + 풀 프리로딩 |

### Step 2: 스킬 매칭

복잡도가 `standard` 이상일 때, 관련 스킬을 자동 탐색합니다:

1. **MCP 검색**: `jarvis_memory_recall`로 요청에 맞는 스킬 검색
   ```
   jarvis_memory_recall (query: "{카테고리 + 핵심 키워드}", type: "procedural")
   ```

2. **매칭 결과 제시**: 관련 스킬이 있으면 사용자에게 알림
   ```
   [Jarvis] 관련 스킬을 찾았습니다:
   - kotlin-expert: Kotlin 코드 품질 전문가
   - kt-spring-boot-expert: Spring Boot 개발 전문가
   적용하시겠습니까?
   ```

3. **스킬 적용**: 사용자가 동의하면 해당 스킬의 지침을 컨텍스트에 반영

### Step 3: 메모리 프리로딩

복잡도가 `standard` 이상일 때, 관련 메모리를 사전 로딩합니다:

1. **선언적 메모리 검색**:
   ```
   jarvis_memory_recall (query: "{핵심 키워드}", type: "declarative")
   ```
   → 사용자 선호도, 기술 스택, 과거 결정 사항

2. **세션 검색**:
   ```
   jarvis_session_search (query: "{핵심 키워드}")
   ```
   → 유사한 과거 작업의 접근법과 교훈

3. **결과 요약**: 프리로딩된 컨텍스트를 간결하게 요약하여 제시
   ```
   [Jarvis] 컨텍스트 프리로딩:
   - 메모리: "프로젝트는 Kotlin + Spring Boot 기반"
   - 과거 세션: "비슷한 JPA 이슈를 3일 전에 해결 (fetch join 적용)"
   ```

### Step 4: 작업 계획 (deep 복잡도만)

복잡도가 `deep`일 때 추가 수행:

1. **작업 분해**: 요청을 실행 가능한 서브태스크로 분해
2. **도구 사전 식별**: 각 서브태스크에 필요한 도구 목록
3. **위험 요소 식별**: 주의해야 할 사항 (기존 코드 영향, 테스트 필요성)
4. **사용자 확인**: 계획을 제시하고 승인 받기

### Step 5: 실행

분석과 프리로딩이 끝나면 실제 작업을 수행합니다.

## 스마트 라우팅 레퍼런스 (후순위: 멀티모델 활성화 시)

멀티모델이 활성화되면 카테고리에 따라 최적 모델을 자동 선택합니다:

| 카테고리 | 우선 모델 | 근거 |
|---------|----------|------|
| `coding`, `refactoring` | Claude Opus | 코드 이해력, 안전성 |
| `debugging` | GPT | 창의적 문제해결 |
| `research` | Gemini | 긴 컨텍스트, 검색 |
| `review`, `design` | Claude Sonnet | 분석력, 비용 효율 |
| `question` | Gemini Flash | 빠른 응답, 저비용 |
| `test` | Claude Opus | 정확한 테스트 생성 |
| `devops` | Claude Sonnet | 인프라 안전성 |

**현재는 Claude 단일 모델로 동작합니다.** 라우팅 설정은 `~/jarvis/config/routing.jsonc`에서 관리합니다.

## 사용법

```
/jarvis                          # 이번 세션의 의도 분석 결과 표시
/jarvis {요청}                   # 의도 분석 후 즉시 작업 시작
/jarvis stats                    # 메모리 시스템 통계
/jarvis dream                    # Dreaming 실행
/jarvis skills                   # 등록된 스킬 목록
/jarvis sync                     # 스킬 + 세션 동기화
```

### `/jarvis stats` 처리
```
jarvis_memory_stats
```

### `/jarvis dream` 처리
```
jarvis_memory_dream
```

### `/jarvis skills` 처리
```
jarvis_memory_list (type: "procedural")
```

### `/jarvis sync` 처리
1. `node ~/jarvis/hooks/scan-skills.js` 실행
2. `jarvis_sync_skills` MCP 도구 호출
3. `jarvis_sync_sessions` MCP 도구 호출

## MCP 도구 의존성
- `jarvis_memory_recall` — 메모리 검색
- `jarvis_memory_list` — 메모리 목록
- `jarvis_session_search` — 과거 세션 검색
- `jarvis_memory_stats` — 통계
- `jarvis_memory_dream` — Dreaming
- `jarvis_sync_skills` — 스킬 동기화
- `jarvis_sync_sessions` — 세션 동기화
