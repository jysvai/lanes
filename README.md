# claude-mod

Claude Code mod 모음입니다. 지금은 **lanes** 하나가 들어 있어요.

## lanes: 필요할 때만 켜지는 보조 세션

메인 세션(Opus) 옆에 보조 Claude Code 세션 두 개를 붙여 일을 나눕니다.

| 세션 | 기본 모델 (2순위) | effort | 하는 일 |
|---|---|---|---|
| 메인 | Opus 5.5 (Fable 5.1) | xhigh 이상 | 코드·콘텐츠 수정, 커밋, 배포, 방향 결정. **코드는 메인만 고칩니다.** |
| mid 레인 | Sonnet 5.5 (Opus 5.5) | high 고정 | 테스트, 메인이 고친 것 검증, 리뷰, 자료 검증 |
| low 레인 | Haiku 5.5 | medium 고정 | 검색, 목록, 스크립트 실행·집계, 사이트 크롤링, 메모 정리 |

- 레인은 **일을 넘길 때만 켜지고**, 일정 시간(기본 20분) 놀면 스스로 닫힙니다.
- 레인은 자기 창(Windows는 PowerShell, macOS는 Terminal)에서 돌아가서 무슨 일을 하는지 볼 수 있어요.
- 레인 답장은 4줄 이내고, 상세 보고는 `.claude/lanes/out/<작업번호>.md`에 남습니다. 메인은 필요할 때만 열어 봐요.
- 레인이 찾아낸 위치·목록은 `.claude/lanes/notes/`에 쌓여서 같은 검색을 두 번 하지 않습니다.
- 레인의 중간 진행 알림 `[progress]`는 메인 상태줄에만 뜨고 메인 모델을 깨우지 않아요.
- 그래서 메인(Opus) 문맥에는 결론만 쌓이고, 무거운 읽기·실행은 싼 모델이 맡습니다.

### 설치

Claude Code 프롬프트에서 (Windows·macOS 공통):

```
/plugin marketplace add C:\Users\yunseok\Desktop\claude-mod
/plugin install lanes@claude-mod
```

GitHub에 올린 뒤에는 다른 PC에서 이 한 줄이면 됩니다:

```
/plugin install lanes --marketplace jysvai/claude-mod
```

`y`로 마켓플레이스를 추가하고 user 범위를 고르면, 이후 모든 프로젝트의 모든 세션에서 켜집니다.

### 쓰는 법

메인 모델은 시스템 프롬프트로 레인 규칙을 알고, 도구 세 개를 씁니다:

- `mcp__lanes__send({ lane: "mid" | "low", task })`: 작업 번호(T1, T2 …)를 붙여 넘깁니다. 레인이 꺼져 있으면 켜고 대기열에 넣어요.
- `mcp__lanes__status`: 레인별 현재 작업, 마지막 답, 토큰 사용량, 최근 보고서를 봅니다.
- `mcp__lanes__stop`: 레인을 지금 닫습니다.

직접 쓸 때:

```
/lane                     레인 상태
/lane mid <할 일>         mid 레인에 작업 넘기기
/lane low <할 일>         low 레인에 작업 넘기기
/lane start [mid|low]     미리 켜기
/lane stop  [mid|low]     닫기
```

상태줄은 짧게만 보여줍니다: `lanes  sonnet ● T3 2m · haiku ○` (● 작업 중, ○ 대기, off 꺼짐)

### 설정 (`/config`)

| 항목 | 기본값 |
|---|---|
| Main model / fallback / effort floor | `claude-opus-5-5[1m]` / `claude-fable-5-1` / `xhigh` |
| Mid lane model / fallback / effort | `claude-sonnet-5-5` / `claude-opus-5-5` / `high` |
| Low lane model / fallback / effort | `claude-haiku-5-5` / 없음 / `medium` |
| How lanes open | `window` (창) 또는 `background` (`claude --bg`, `claude attach <이름>`으로 보기) |
| Close an idle lane after | `20` 분 (0이면 안 닫음) |

- 메인 effort가 floor보다 낮으면 Opus·Fable 메인에 한해 floor로 올립니다.
- 레인 effort는 고정이라 `/effort`로 바꿔도 설정값으로 돌아갑니다.
- 메인의 2순위 모델은 실행할 때만 정할 수 있어서 메인 실행 스크립트를 넣어 뒀어요:
  - Windows: `lanes\bin\claude-main.ps1`
  - macOS: `lanes/bin/claude-main.sh`

### 프로젝트별 추가 지시

프로젝트에 `.claude/lanes/roles/mid.md`, `.claude/lanes/roles/low.md`를 두면 레인 역할 프롬프트 끝에 붙습니다. 그 프로젝트의 테스트 명령이나 검증 방법을 적어 두는 곳이에요.

레인이 쓰는 폴더 `.claude/lanes/`는 첫 실행 때 자기 `.gitignore`(`*`)를 만들어서 git에 올라가지 않습니다.

### 알아둘 점

- **레인을 Claude 도구 호출 안에서 띄우면 메시지를 못 받습니다.** 띄우는 쪽의 "자식 세션" 표시를 물려받기 때문이에요. 플러그인의 `/lane`·`send`는 세션 본체에서 띄워서 괜찮고, 손으로 띄울 때는 직접 연 터미널에서:
  - Windows: `powershell -ExecutionPolicy Bypass -File <claude-mod>\lanes\bin\lanes.ps1 start -Project <프로젝트 폴더>`
  - macOS·Linux: `LANES_PROJECT=<프로젝트 폴더> bash <claude-mod>/lanes/bin/lanes.sh start`
- `settings.json`의 `env`에 `CLAUDE_CODE_SUBAGENT_MODEL_FORCE`가 있으면 모든 서브에이전트가 그 모델로 강제됩니다. 레인은 서브에이전트 대신 low 레인에 일을 넘기도록 되어 있어요.
- Linux는 창 대신 background로 띄웁니다. 볼 때는 `claude attach <프로젝트>-mid`.

### 개발

```
claude plugin validate lanes
claude plugin test lanes
```
