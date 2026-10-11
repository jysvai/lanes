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

## 설치

Windows · macOS 공통, Claude Code 프롬프트에서:

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
/lane status                  레인 상태 · 최근 보고서
/lane mid <할 일>             mid 레인에 바로 넘기기 (low도 같음)
/lane start | stop [mid|low]  미리 켜기 · 닫기
```

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
