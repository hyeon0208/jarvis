---
name: jarvis
description: "Jarvis main orchestrator. Activate first whenever a new task, request, or question arrives — run IntentGate (category + complexity analysis), skill matching (jarvis_memory_recall procedural), and memory preloading (declarative + session_search) in sequence to enrich context. Trigger keywords (Korean/English): 구현/만들어/추가/디버깅/리팩토링/조사/리뷰/설계/배포/테스트, implement/create/add/debug/refactor/investigate/review/design/deploy/test, question forms (뭐야/어떻게/왜, what/how/why), code-change intent, or any question about Jarvis itself. Can also be invoked manually via /jarvis."
---

# Jarvis — IntentGate Orchestrator

## Role

Pre-analyze user requests and **preload optimal context** (skills, memory, past sessions) to maximize response quality in Claude Code.

## Procedure

When invoked via `/jarvis` or `/jarvis {request}`, perform the following steps:

### Step 1: Intent Analysis (IntentGate)

Analyze the request to determine **category** and **complexity**.

#### Category classification

| Category | Trigger keywords | Description |
|---------|-------------------|------|
| `coding` | implement, create, add, feature, develop / 구현, 만들어, 추가, 기능, 개발 | New code |
| `debugging` | bug, error, broken, fix, why / 버그, 에러, 안됨, 수정, 왜 | Problem solving |
| `refactoring` | refactor, improve, clean, structure / 리팩토링, 개선, 정리, 구조 | Code improvement |
| `research` | find, search, how, what / 찾아, 검색, 어떻게, 뭐가 | Information lookup |
| `review` | review, PR, analyze / 리뷰, 검토, PR, 분석 | Code evaluation |
| `question` | what is, explain, tell me, compare / 뭐야, 설명, 알려, 비교 | Knowledge question |
| `design` | design, architecture, ERD, diagram / 설계, 아키텍처, ERD | System design |
| `devops` | deploy, CI, CD, docker, kubernetes / 배포, CI, CD, 도커 | Infra/deploy |
| `test` | test, TDD, coverage / 테스트, 검증, TDD | Test authoring |

#### Complexity estimation

| Level | Criteria | Action |
|------|------|------|
| `quick` | Single file, obvious change, under 5 min | Execute immediately |
| `standard` | Multiple files, typical work, 5-30 min | Preload skills/memory |
| `deep` | Complex analysis, multi-step, 30 min+ | Plan first + full preloading |

### Step 2: Skill Matching

For `standard` or higher complexity, search for related skills:

1. **MCP search**: Use `jarvis_memory_recall` to find relevant skills
   ```
   jarvis_memory_recall (query: "{category + keywords}", type: "procedural")
   ```

2. **Present matches**: If skills are found, notify the user
   ```
   [Jarvis] Found related skills:
   - kotlin-expert: Kotlin code quality expert
   - kt-spring-boot-expert: Spring Boot development expert
   Apply?
   ```

3. **Apply**: If the user agrees, incorporate the skill's guidance into context

### Step 3: Memory Preloading

For `standard` or higher complexity, preload relevant memory:

1. **Declarative memory search**:
   ```
   jarvis_memory_recall (query: "{keywords}", type: "declarative")
   ```
   → user preferences, tech stack, past decisions

2. **Session search**:
   ```
   jarvis_session_search (query: "{keywords}")
   ```
   → approaches and lessons from similar past work

3. **Summarize**: Present preloaded context concisely
   ```
   [Jarvis] Preloaded context:
   - Memory: "Project uses Kotlin + Spring Boot"
   - Past session: "Solved a similar JPA issue 3 days ago with fetch join"
   ```

### Step 4: Task Planning (deep complexity only)

For `deep` complexity, additionally:

1. **Task decomposition**: Break the request into actionable subtasks
2. **Tool identification**: List tools needed for each subtask
3. **Risk identification**: Side effects, test needs, regression risks
4. **User confirmation**: Present the plan and get approval

### Step 5: Execution

After analysis and preloading, perform the actual work.

## Smart Routing Reference (future: multi-model activation)

If multi-model is enabled, optimal model is auto-selected by category:

| Category | Preferred model | Rationale |
|---------|----------|------|
| `coding`, `refactoring` | Claude Opus | Code comprehension, safety |
| `debugging` | GPT | Creative problem solving |
| `research` | Gemini | Long context, search |
| `review`, `design` | Claude Sonnet | Analysis, cost efficiency |
| `question` | Gemini Flash | Fast response, low cost |
| `test` | Claude Opus | Accurate test generation |
| `devops` | Claude Sonnet | Infra safety |

**Currently operates on single Claude model.** Routing settings live in `~/jarvis/config/routing.jsonc`.

## Usage

```
/jarvis                          # Show intent analysis for current session
/jarvis {request}                # Analyze intent then start task
/jarvis stats                    # Memory system statistics
/jarvis dream                    # Run Dreaming (memory cleanup)
/jarvis skills                   # List registered skills
/jarvis sync                     # Sync skills + sessions to DB
```

### `/jarvis stats` handler
```
jarvis_memory_stats
```

### `/jarvis dream` handler
```
jarvis_memory_dream
```

### `/jarvis skills` handler
```
jarvis_memory_list (type: "procedural")
```

### `/jarvis sync` handler
1. Run `node ~/jarvis/hooks/scan-skills.js`
2. Call `jarvis_sync_skills` MCP tool
3. Call `jarvis_sync_sessions` MCP tool

## MCP Tool Dependencies
- `jarvis_memory_recall` — memory search
- `jarvis_memory_list` — memory listing
- `jarvis_session_search` — past session search
- `jarvis_memory_stats` — statistics
- `jarvis_memory_dream` — Dreaming
- `jarvis_sync_skills` — skill sync
- `jarvis_sync_sessions` — session sync
