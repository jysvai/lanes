<div align="center">

# What lanes actually saves

**Measured on two projects, and the same tasks run on three models**

[한국어](dollar-savings.md) · **English** · [Back to the README](../README.en.md)

</div>

<p align="center"><img src="en/projects.svg" width="880" alt="What the lanes saved on two projects: all on Opus 145.64 dollars, with lanes 101.53 dollars, 44.11 dollars (30%) saved. Project 1, a web game, 106.13 to 70.64 dollars (33%); project 2, the lanes plugin, 39.51 to 30.89 dollars (22%)"></p>

## At a glance

| | Project 1 · a web game | Project 2 · the lanes plugin | Both |
|---|---:|---:|---:|
| Session (KST) | Oct 11, 14:07–18:48 | Oct 11, 21:10 – Oct 12, 00:33 | |
| Length | 4.7 h | 3.4 h | 8.1 h |
| Lane tasks | 29 | 7 | 36 |
| All on Opus | $106.13 | $39.51 | $145.64 |
| With lanes | $70.64 | $30.89 | $101.53 |
| **Saved** | **−$35.48 (33%)** | **−$8.62 (22%)** | **−$44.11 (30%)** |
| The lanes' share alone | 57% saved | 66% saved | |
| Work the same money buys | 1.50× | 1.28× | 1.43× |
| Tokens kept out of main's context | 109.1M | 12.0M | 121.1M |

- **"All on Opus"** prices the tokens the lanes used at Opus 5.5 rates. What main spent is the same on both sides.
- **Why the two projects differ:** on the game, the lanes ran long playtests and regression runs (mid: 213 minutes). On the plugin, main spent most of the time changing the code itself and gave the lanes seven reviews and lookups. **The more side work a job has, the more the lanes save.**
- **On a subscription (Pro, Max)** the bill doesn't change, but usage limits are drawn down by model price too, so the same limit stretches about 1.4× further.

## Project 1 · a web game

An afternoon of fixing a browser game, reworking its translations and playing it on a phone to check.

<p align="center"><img src="en/timeline-1.svg" width="880" alt="Project 1 over time: beside 154 minutes of main's work, the lanes worked 265 minutes on 29 tasks"></p>

| Session | Model | Calls | Cost | On Opus |
|---|---|---:|---:|---:|
| main | Opus 5.5 | 468 | $43.94 | $43.94 |
| mid lane | Sonnet 5.5 | 769 | $26.19 | $52.37 |
| low lane | Haiku 5.5 | 147 | $0.52 | $9.81 |
| **Total** | | 1,384 | **$70.64** | **$106.13** |

- **What the lanes did:** 29 tasks, among them triaging 46 search hits, full regression runs, a sweep of all 16 cases, checks of the translation packs, regression runs after the translation edits, and checking fixes and tracking down causes.
- **Time at work:** main 154 minutes, mid 213, low 52. Of the lanes' 265 minutes, 115 ran while main was at work too.
- **What the lanes read:** 109.1M tokens of screenshots, logs and search results that never piled up in main's conversation. That part is not in the savings.

## Project 2 · the lanes plugin (this repo)

A night session building lanes 0.3.0, fixing what the security review found, and making this page, counted up to 00:33, when this page was started.

<p align="center"><img src="en/timeline-2.svg" width="880" alt="Project 2 over time: beside 151 minutes of main's work, the lanes worked 62 minutes on 7 tasks; away from 22:40 to 23:32"></p>

| Session | Model | Calls | Cost | On Opus |
|---|---|---:|---:|---:|
| main | Opus 5.5 | 266 | $26.13 | $26.13 |
| main's subagents | Haiku 5.5 | 8 | $0.30 | (as is) |
| mid lane | Sonnet 5.5 | 81 | $4.07 | $8.13 |
| low lane | Haiku 5.5 | 41 | $0.40 | $4.96 |
| **Total** | | 396 | **$30.89** | **$39.51** |

Each lane task (the `/lane tasks` ledger):

| Task | Lane | Result | Took | Cost | On Opus | What |
|---|---|---|---:|---:|---:|---|
| T3 | low | DONE | <1 min | $0.01 | $0.37 | Check after a restart |
| T4 | mid | PASS | 3 min | $0.37 | $0.73 | Install from GitHub on a clean setup |
| T5 | low | BLOCKED | 4 min | $0.28 | $2.53 | Collect Bedrock and Vertex model IDs (Bedrock confirmed only) |
| T6 | mid | PASS | 5 min | $0.63 | $1.26 | Check the prices against the official page |
| T7 | mid | PARTIAL | 7 min | $1.27 | $2.53 | Review all of 0.3.0: **two real bugs** found |
| T8 | mid | PARTIAL | 21 min | $1.80 | $3.61 | Security review: **ten issues to fix** found |
| T9 | low | PARTIAL | 19 min | $0.10 | $2.06 | Find the evidence behind project 1's figures |
| | | | **60 min** | **$4.46** | **$13.09** | |

- **Not just money.** The bugs T7 found (a model given as an ARN kept lanes from opening on macOS and Linux; the GovCloud region prefix) are fixed in this version. So are the ten issues T8 found; after the fixes, the mid lane reviewed them again (T10) and the gaps it still found were closed too. A lane instructions file a repo ships stays as trusted as its `CLAUDE.md`, which the README lists as a limit.
- **Time at work:** main 151 minutes, mid 36, low 25. Nearly all the lanes' work ran while main was at work.

## Speed and amount of work

| | Project 1 | Project 2 |
|---|---:|---:|
| Main at work | 154 min | 151 min |
| Lanes at work | 265 min | 62 min |
| of which alongside main | 115 min | 62 min |
| If main had done the lanes' share too | 419 min (2.7×) | 213 min (1.4×) |
| Work the same money buys | 1.50× | 1.28× |

- **Main didn't wait.** Checks and lookups ran alongside main's work, so what main alone would have done one after another overlapped instead.
- **"Main alone" assumes the same speed:** in the experiment below the three models took about as long (18–47 s). Time at work counts requests less than 4 minutes apart as one stretch.
- **Amount of work:** what's saved buys more work on the same budget: 1.43× over both projects.

## Experiment: the same task on three models

Three tasks of the kind lanes take, each run three times on main's settings (Opus 5.5 · xhigh), the mid lane's (Sonnet 5.5 · high) and the low lane's (Haiku 5.5 · medium). Each ran in a fresh `claude -p`; cost is what Claude Code reported, and a script graded the answers.

<p align="center"><img src="en/bench.svg" width="880" alt="Experiment: Sonnet costs 38% of Opus, Haiku 3%. Right answers: Opus 9/9, Sonnet 9/9, Haiku 7/9"></p>

| Task | Model | Mean cost | Mean time | Right |
|---|---|---:|---:|---:|
| List and count (low-lane work) | Opus | $0.235 | 34 s | 3/3 |
| | Sonnet | $0.066 | 18 s | 3/3 |
| | Haiku | $0.007 | 35 s | 3/3 |
| Run the tests, report (mid-lane work) | Opus | $0.144 | 30 s | 3/3 |
| | Sonnet | $0.067 | 47 s | 3/3 |
| | Haiku | $0.004 | 37 s | **1/3** |
| Review for a bug (mid-lane work) | Opus | $0.147 | 31 s | 3/3 |
| | Sonnet | $0.067 | 26 s | 3/3 |
| | Haiku | $0.004 | 23 s | 3/3 |

- **Sonnet answers as well as Opus (9/9) at 38% of the cost.** That's why the checks and reviews that need judgement go to the mid lane (Sonnet).
- **Haiku costs 3% of Opus.** It got the lists and the review right, but missed twice on "run exactly this one command": once it ran another shape of the command, which wasn't allowed, and once it stopped without trying the other shell. That's why the low lane (Haiku) gets mechanical work only, and falls back to Sonnet 5.5.
- **The times were close (18–47 s):** handing work to a cheaper model didn't slow it down.
- **The experiment cost** $2.23 for 28 runs. One was run again, for the reason below.

**A bug the experiment found:** one Haiku run received the mid lane's interim security report. Claude Code names a session after its folder, so a `claude -p` in the same folder got main's name (`claude-mod-94`). From this version on, main gives a lane its unique address with each task (`reply to: <name> at uds:...`), so a lane's reply can't go to another session. That one run was redone after the fix.

## Evidence and method

- **The data:** the session logs Claude Code keeps (`~/.claude/projects/<project>/<session>.jsonl`). Each model request has its model and tokens (input, cache write, cache read, output). A request logged over several lines counts once, by message id.
- **What counts as a lane:** the named lane sessions only (`<project>-mid`, `<project>-low`, and project 1's earlier names `gaze-sonnet` and `gaze-haiku`). Unnamed one-off calls other tools made (conversation summaries and the like) are left out.
- **Prices:** Claude API list prices, the same as the plugin's price table, checked against the official pricing page (T6). Cache writes at the 1-hour rate.

  | Per million tokens | Input | Cache write | Cache read | Output |
  |---|---:|---:|---:|---:|
  | Opus 5.5 | $4 | $8 | $0.20 | $20 |
  | Sonnet 5.5 | $2 | $4 | $0.10 | $10 |
  | Haiku 5.5 (prompt up to 100k tokens) | $0.10 | $0.20 | $0.01 | $0.50 |
  | Haiku 5.5 (over 100k) | $0.50 | $1 | $0.05 | $2.50 |

- **Cross-checks:** for project 1, the README has what `/lane usage` showed that day (all on Opus $106.05, with lanes $70.61; 468, 767 and 147 calls). Recomputed from the session logs it is $106.13 and $70.64 (468, 769 and 147 calls), within 0.1%. For project 2, the lane ledger ($4.46, $13.09 on Opus) matches the session logs ($4.47, $13.09).
- **Measure it yourself:** the scripts and the raw results are in [`measure/`](measure/).

  ```bash
  # one session: what main and its lanes spent, when each was at work, when tasks came in
  node docs/measure/session-stats.mjs ~/.claude/projects/<project folder> <main session id> [until]
  # the experiment: the same three tasks on three models, three times each
  REPS=3 node docs/measure/bench.mjs . bench.json
  ```

  Your own project's figures for today are a `/lane usage` away, and the ledger per task is `/lane tasks`.
- **Limits:**
  - These are list prices, not an invoice.
  - "On Opus" assumes Opus would have done the same work with the same tokens.
  - The experiment's tasks are three short ones; on long, hard work the gap may differ.
  - The experiment ran with the other plugins in daily use switched on, the same for all three models.
