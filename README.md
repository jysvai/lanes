# lanes

**메인 Claude Code 세션 옆에, 필요할 때만 켜지는 보조 세션 두 개.**
검색·실행·검증처럼 무거운 일은 싼 모델이 맡고, 메인(Opus) 문맥에는 결론만 쌓입니다.

<p align="center"><img src="docs/demo.svg" width="780" alt="터미널 재생: /lane 한 줄로 요청하면 메인이 haiku에게 원인 찾기(T1), sonnet에게 검증(T2)을 넘기고, 아래 상태줄이 작업 상태를 보여준다"></p>

## 구조

<p align="center"><img src="docs/flow.svg" width="880" alt="메인이 mid·low 레인에 작업을 넘기고 짧은 답만 돌려받는다. mid는 단순 작업을 low에 넘기고, 상세 보고서는 파일로 남는다"></p>

| 세션 | 모델 (2순위) | effort | 하는 일 |
|---|---|---|---|
| **main** | Opus 5.5 (Fable 5.1) | xhigh 이상 | 코드 수정 · 커밋 · 배포. **코드는 메인만 고칩니다** |
| **mid** 레인 | Sonnet 5.5 (Opus 5.5) | high 고정 | 테스트, 고친 것 검증, 리뷰 |
| **low** 레인 | Haiku 5.5 | medium 고정 | 검색, 스크립트 실행·집계, 크롤링, 메모 정리 |

- 레인은 **일을 넘길 때 켜지고**, 20분 놀면 스스로 닫힙니다.
- 레인의 답장은 4줄 이내예요. 상세 보고는 `.claude/lanes/out/T<번호>.md`에 남습니다.
- 일하는 중인 레인에 일을 더 넘기면 대기열에 들어갔다가, 앞 작업이 끝나는 대로 넘어갑니다.
- 레인이 찾아 둔 위치·목록은 `.claude/lanes/notes/`에 쌓여서 같은 검색을 두 번 하지 않아요.

## 서브에이전트 위임과 다른 점

서브에이전트는 일을 받아 답 하나를 돌려주고 사라집니다. 레인은 **계속 살아 있는 세션**이라서 이런 일이 됩니다.

| | 서브에이전트 | lanes |
|---|---|---|
| 메인을 `/clear`·재시작·종료하면 | 결과도 같이 사라짐 | 레인은 하던 일을 끝내고, 답장은 **다음 메인 세션이 받아요** |
| 같은 주제를 더 물을 때 | 처음부터 다시 읽음 | 레인이 기억하는 작업에 **이어서 물어요** (`in context: T5, T7`) |
| 찾아 둔 위치·구조 | 다음 호출엔 없음 | `notes/index.md`에 쌓이고, **메인은 세션을 시작할 때 이 지도를 받아요** |
| 비용 | 안 보임 | **작업마다** 든 비용과, Opus였다면 들었을 비용 (`/lane tasks`) |
| 단순 작업 다시 넘기기 | 메인을 거침 | mid가 low에 바로 넘김 |
| 레포 파일 수정 | 도구 권한대로 | `.claude/lanes/`와 임시 폴더 밖에는 **못 써요** (플러그인이 막음) |

- **받은 편지함**: 레인이 답장을 보낼 때 메인이 꺼져 있었거나 다시 시작됐으면, 그 답장은 다음 메인 세션의 프롬프트에 실립니다 (3일까지). 레인은 답장을 다시 보내려고 애쓰지 않아요.
- **이어 묻기**: `/lane status`에 레인이 아직 기억하는 작업이 나와요. 메인은 그 레인에 `(follow-up to T7) ...`로 보내서 설명을 반복하지 않습니다. 레인이 닫혔다 다시 열리면 이 목록은 비어요.
- **작업 장부**: `/lane tasks`

```
lane tasks in this project, newest first (2 of 2)
  T2    mid  open       3m    $0.01 (on main $0.20)  run the tests
  T1    low  DONE       1m    $0.01 (on main $0.20)  count the files
all 2 tasks: $0.02, on opus-5-5 $0.40. A sub-task (T7a) is counted on its own row.
```

## 얼마나 아끼나

<p align="center"><img src="docs/savings.svg" width="880" alt="오늘 오후 한 세션 실측: 전부 Opus였다면 106.05달러, lanes로 70.61달러, 35.44달러(33%) 절약. 1주 177달러, 1달 744달러, 1년 8,860달러 절약"></p>

웹 게임 프로젝트 하나를 오후 내내(4.6시간) 고친 실제 기록이에요. 같은 일을 **전부 Opus가 했을 때**와 비교했습니다.

| 기간 | 전부 Opus | lanes | 차이 |
|---|---:|---:|---:|
| 하루 (이 세션) | $106 | $71 | **−$35 (33%)** |
| 1주 · 5일 | $530 | $353 | **−$177** |
| 1달 · 21일 | $2,227 | $1,483 | **−$744** |
| 1년 · 250일 | $26,513 | $17,653 | **−$8,860** |

- **레인 몫만 보면 57%를 아꼈어요.** mid(Sonnet)는 $52.30 → $26.15로 절반, low(Haiku)는 $9.81 → $0.52로 95% 줄었습니다.
- **구독(Pro·Max)이라면** 요금은 그대로지만, 사용 한도도 대체로 모델 단가대로 깎여요. 같은 한도로 약 **1.5배** 일하는 셈입니다.
- **실제로는 더 아껴요.** 레인이 읽은 스크린샷·로그·검색 결과(이 세션에서 9천만 토큰 남짓)가 메인 대화에 쌓이지 않아서, 메인의 이후 모든 턴이 가벼워집니다. 이 몫은 표에 넣지 않았어요.
- **계산 방법:** 세션 기록에 남은 요청 하나하나의 토큰을 모델별 [API 정가](https://platform.claude.com/docs/en/about-claude/pricing)로 계산했습니다 (캐시 쓰기는 1시간 단가). 1주·1달·1년은 이 세션을 하루치로 잡고 곱한 값이에요.

내 프로젝트의 숫자는 `/lane usage`로 바로 볼 수 있어요:

```
lane spend today (2026-10-11), at API list prices
  main  opus-5-5         468 calls    $43.94
  mid   sonnet-5-5       767 calls    $26.15   on opus-5-5 $52.30  saved $26.15 (50%)
  low   haiku-5-5        147 calls     $0.52   on opus-5-5 $9.81  saved $9.29 (95%)
  lanes                  914 calls    $26.67   on opus-5-5 $62.11  saved $35.44 (57%)
  all                   1382 calls    $70.61   on opus-5-5 $106.05  saved $35.44 (33%)
```

표 아래에는 **어디서, 어떻게 아꼈는지**가 붙어요 (작업마다 장부가 있어서 가능해요):

```
where it came from, by task (most saved first)
  T1    mid  PARTIAL   $1.56 instead of   $3.11  saved  $1.55  Review the uncommitted changes under lanes/
  T2    low  DONE      $0.02 instead of   $0.78  saved  $0.76  Inventory, no edits: in README.md, docs/*.svg
how
  the same work on cheaper models: per token, sonnet-5-5 costs 1/2 of opus-5-5, haiku-5-5 costs 1/40–1/20 of opus-5-5
  and main's context stays light: the lanes took in 244k tokens (their prompts, and the files,
  logs and results they read) that main never read, nor carried through its later turns. That part is not in the table.
```

## 설치

Claude Code 2.1.296 이상에서 확인했어요 (더 낮으면 레인을 열 때 경고가 떠요). Windows · macOS 공통, Claude Code 프롬프트에서:

```
/plugin install lanes --marketplace jysvai/lanes
```

user 범위를 고르면 모든 프로젝트의 모든 세션에서 켜집니다. 터미널에서 설치할 때는 이렇게 합니다:

```
claude plugin marketplace add jysvai/lanes
claude plugin install lanes@claude-mod --scope user
```

"설정값을 아직 정하지 않았다"는 안내가 떠도 아래 기본값으로 동작해요.

## 쓰는 법

```
/lane <하고 싶은 일>          메인이 나눠서 끝까지 진행
/lane status                  레인 상태 · 이어 물을 수 있는 작업 · 최근 보고서 · 오늘 레인 비용
/lane tasks                   작업 장부: 결과 · 걸린 시간 · 작업마다 든 비용
/lane usage [all]             오늘(all: 기록 전체) 쓴 금액과 Opus 대비 절약액
/lane mid <할 일>             mid 레인에 바로 넘기기 (low도 같음)
/lane start | stop [mid|low]  미리 켜기 · 닫기
/lane help                    명령 목록
```

한글로도 돼요: `/lane 상태` · `/lane 작업` · `/lane 비용 [전체|오늘]` · `/lane 시작|중지 [mid|low|전체]` · `/lane 도움말`. 대소문자는 가리지 않고, `/lane usage weekly`처럼 인자를 잘못 쓰거나 `/lane statsu`처럼 오타를 내면 메인에게 일을 넘기는 대신 사용법을 보여 줘요.

`/lane 로그인 버그 고쳐줘`처럼 적으면 메인이 일을 나눠 레인에 넘깁니다. 그동안 자기는 코드를 고치고, 고친 것은 mid에 다시 검증시킨 뒤, 바뀐 것과 확인한 것을 보고합니다.

### 상태줄 읽는 법

```
lanes  sonnet ● T3 2m +1 · haiku ○
```

| 표시 | 뜻 |
|---|---|
| `●` `○` `off` | 작업 중 · 대기 · 꺼짐 |
| `T3` | 이 프로젝트에서 레인에 넘긴 **3번째 작업**이에요. 터미널 번호가 아닙니다. 보고서도 같은 번호로 남아요 (`out/T3.md`). |
| `2m` | 그 작업을 시작한 지 2분 |
| `+1` | 뒤에서 기다리는 작업 1개 |

## 설정 `/config`

| 항목 | 기본값 |
|---|---|
| main 모델 · 2순위 · 최소 effort | `claude-opus-5-5[1m]` · `claude-fable-5-1` · `xhigh` |
| mid 모델 · 2순위 · effort | `claude-sonnet-5-5` · `claude-opus-5-5` · `high` |
| low 모델 · 2순위 · effort | `claude-haiku-5-5` · 없음 · `medium` |
| 레인 여는 방식 | `window` (새 창) · `background` (`claude attach <이름>`으로 보기) |
| 레인 권한 모드 | `auto` · `acceptEdits` · `dontAsk` · `manual` · `bypassPermissions` |
| 놀면 닫기 | `20`분 (0이면 안 닫음) |

<details>
<summary><b>더 보기</b>: effort 규칙 · 프로젝트별 지시 · 주의할 점 · 개발</summary>

**effort 규칙**
- 메인이 Opus·Fable이면 effort가 최소값 아래로 내려가지 않아요.
- 레인 effort는 고정이라 `/effort`로 바꿔도 설정값으로 돌아갑니다.
- 메인의 2순위 모델은 실행할 때만 정할 수 있어서 실행 스크립트를 넣어 뒀어요: `lanes/bin/claude-main.ps1` (Windows), `lanes/bin/claude-main.sh` (macOS).

**프로젝트별 지시**
- 프로젝트에 `.claude/lanes/roles/mid.md`, `low.md`를 두면 레인 역할 프롬프트 끝에 붙습니다. 그 프로젝트의 테스트 명령이나 검증 방법을 적는 곳이에요.
- `.claude/lanes/` 폴더는 첫 실행 때 자기 `.gitignore`를 만들어서 git에 올라가지 않아요.

**주의할 점**
- 레인 이름은 `<폴더 이름>-<경로 태그>-mid` 꼴이에요 (예: `claude-mod-8071-mid`). 이름이 같은 폴더나 한글 이름 폴더끼리도 레인이 섞이지 않아요. 이전 버전에서 켠 `claude-mod-mid` 같은 레인은 놀다가 스스로 닫힙니다.
- 회사 PC처럼 실행 정책이 `.ps1` 파일을 모두 막아도 돼요. 플러그인은 스크립트를 파일이 아니라 스크립트 블록으로 실행하고, claude도 npm의 `claude.ps1` 대신 `claude.exe`나 `claude.cmd`로 띄웁니다. 다만 AppLocker·WDAC의 제한 언어 모드(Constrained Language Mode) PC에서는 동작하지 않아요.
- 레인이 막혀 있는 것: Edit, 레포 안에서 `.claude/lanes/` 밖에 Write, git의 commit · push · reset · checkout · restore · stash · clean · switch · rebase · merge · cherry-pick · revert · apply · am · rm · mv. Bash로 파일을 바꾸는 것(`sed -i` 등)까지는 막지 못하니, 권한 모드를 `bypassPermissions`로 둘 때는 이 점을 감안하세요.
- auto 모드를 못 쓰는 계정이면 `/config`에서 레인 권한 모드를 바꾸세요. background 레인은 권한을 물어도 답할 사람이 없어서, `dontAsk`(허용 목록을 미리 설정)나 `manual` + window를 권해요.
- Claude의 도구 호출(Bash 등) 안에서 레인을 띄우면 메시지를 받지 못합니다. "자식 세션" 표시를 물려받기 때문이에요. `/lane`과 `send`는 세션 본체에서 띄우니 괜찮습니다. 손으로 띄울 때는 직접 연 터미널에서 띄우세요:
  - Windows: `powershell -ExecutionPolicy Bypass -File lanes\bin\lanes.ps1 start -Project <프로젝트 폴더>`
  - macOS·Linux: `LANES_PROJECT=<프로젝트 폴더> bash lanes/bin/lanes.sh start`
- `settings.json`에 `CLAUDE_CODE_SUBAGENT_MODEL_FORCE`가 있으면 서브에이전트가 모두 그 모델로 강제됩니다. 그래서 레인은 서브에이전트 대신 low 레인에 일을 넘기도록 되어 있어요.
- Linux에서는 창 대신 background로 띄웁니다. 볼 때는 `claude attach <프로젝트>-mid`를 쓰세요.

**로컬 폴더에서 설치 · 개발**
```
/plugin marketplace add <이 저장소를 받은 폴더>
/plugin install lanes@claude-mod

claude plugin validate lanes
claude plugin test lanes
```
</details>
