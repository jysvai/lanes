<div align="center">

# What lanes actually saves

**Measured on four projects, and the same tasks run on three models**

[한국어](dollar-savings.md) · **English** · [Back to the README](../README.en.md)

</div>

<p align="center"><img src="en/projects.svg" width="880" alt="What the lanes saved on four projects: all on Opus 202.06 dollars, with lanes 153.74 dollars, 48.32 dollars (24%) saved. Project 1, a web game, 106.13 to 70.64 dollars (33%); project 2, the lanes plugin, 39.51 to 30.89 dollars (22%); project 3, a work planning doc on Bedrock, 6.92 to 4.58 dollars (34%); project 4, a Python web service, 49.50 to 47.63 dollars (4%)"></p>

## At a glance

| | Project 1 · a web game | Project 2 · the lanes plugin | Project 3 · a work planning doc (Bedrock) | Project 4 · a Python web service | All four |
|---|---:|---:|---:|---:|---:|
| Session (KST) | Oct 11, 14:07–18:48 | Oct 11, 21:10 – Oct 12, 00:33 | Oct 12, 12:03–12:56 | Oct 12, 11:43–16:51 | |
| Length | 4.7 h | 3.4 h | 0.9 h | 5.1 h | 14.1 h |
| Lane tasks | 29 | 7 | 3 | 2 | 41 |
| All on Opus | $106.13 | $39.51 | $6.92 | $49.50 | $202.06 |
| With lanes | $70.64 | $30.89 | $4.58 | $47.63 | $153.74 |
| **Saved** | **−$35.48 (33%)** | **−$8.62 (22%)** | **−$2.34 (34%)** | **−$1.87 (4%)** | **−$48.32 (24%)** |
| The lanes' share alone | 57% saved | 66% saved | 63% saved | 50% saved | |
| Work the same money buys | 1.50× | 1.28× | 1.51× | 1.04× | 1.31× |
| Tokens kept out of main's context | 109.1M | 12.0M | 1.9M | 3.8M | 126.7M |
| Saved in main's context (estimate) | ≈$6.13 | ≈$5.41 | ≈$0.03 | ≈$2.39 | |
| With that counted | ≈37% | ≈31% | ≈34% | ≈8% | |

- **"All on Opus"** prices the tokens the lanes used at Opus 5.5 rates. What main spent is the same on both sides.
- **Why the projects differ:** on the game, the lanes ran long playtests and regression runs (mid: 213 minutes). On the plugin, main spent most of the time changing the code itself and gave the lanes seven reviews and lookups. The planning session was short, so main's share was large, but the low lane did the web research at 3% of Opus's price, so the lanes' share saved 63%. On the web service, main did nearly all the work itself (2 lane tasks). **The more side work goes to the lanes, the more they save.**
- **Saved in main's context (estimate)** is what main's later requests would have read again had main read the lanes' material itself. It is an estimate, not a measurement, so it isn't in the saving. How it's worked out is [below](#saved-in-mains-context-estimate).
- **On a subscription (Pro, Max)** the bill doesn't change, but usage limits are drawn down by model price too, so the same limit stretches about 1.3× further.

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

## Project 3 · a work planning doc (through a gateway to Bedrock)

A lunchtime session on a work Mac, through the company's LLM gateway to Amazon Bedrock, writing the planning doc for an internal tool. Anything that would name the company or the project (names, paths, account numbers) is left out.

<p align="center"><img src="en/timeline-3.svg" width="880" alt="Project 3 over time: beside 14 minutes of main's work, the lanes worked 15 minutes on 3 tasks"></p>

| Session | Model | Calls | Cost | On Opus |
|---|---|---:|---:|---:|
| main | Opus 5.5 (7 on Sonnet 5.5) | 20 | $3.21 | (the same) |
| mid lane | Sonnet 5.5 | 19 | $1.34 | $2.67 |
| low lane | Haiku 5.5 | 11 | $0.03 | $1.04 |
| **Total** | | 50 | **$4.58** | **$6.92** |

Each lane task (the `/lane usage` ledger; a task's cost is its share of the day's lane cost by its number of requests, an estimate marked `≈`):

| Task | Lane | Result | Took | Cost | On Opus | What |
|---|---|---|---:|---:|---:|---|
| T1 | low | DONE | 3 min | ≈$0.03 | ≈$1.04 | Collect and sort the evidence for the doc from the web |
| T2 | mid | DONE | 3 min | ≈$0.56 | ≈$1.12 | Write the doc's policy, risks, success measures and rollout |
| T3 | mid | DONE | 10 min | ≈$0.77 | ≈$1.55 | Following up T2, put the finished doc together |
| | | | **16 min** | **$1.36** | **$3.71** | |

- **It saves just the same at work.** This gateway answers with a Bedrock application inference profile's ARN where the model name would be, so up to 0.3.1 `/lane usage` showed $0. From 0.3.2 a request is priced by the model it asked for, and from 0.3.3 a day logged at $0 before that is priced again from its token totals.
- **Research saves the most on the low lane.** The web research (T1) cost 3% of what it would have on Opus, and Sonnet wrote the doc (T2, T3) at half the price. The lanes work the same on a job with no code in it.
- **Time at work:** main 14 minutes, mid 13, low 3. Of the lanes' 15 minutes, 6 ran while main was at work too.
- **A short session leaves main a large share.** Main spent 70% of it ($3.21), so though the lanes' share saved 63%, the session as a whole saved 34%. Main was switched to Sonnet for 7 of its requests during the session; those are priced as the model they ran on.

## Project 4 · a Python web service

A daytime session on a personal computer, building a Python web service and refining it by opening it in the browser. Names and paths that would identify the service are left out.

<p align="center"><img src="en/timeline-4.svg" width="880" alt="Project 4 timeline: the lanes worked 11 minutes beside 142 minutes of main's work, 2 lane tasks"></p>

| Session | Model | Calls | Cost | On Opus |
|---|---|---:|---:|---:|
| main | Opus 5.5 | 427 | $45.75 | $45.75 |
| mid lane | Sonnet 5.5 | 37 | $1.87 | $3.75 |
| low lane | Haiku 5.5 | 0 | $0.00 | $0.00 |
| **Total** | | 464 | **$47.63** | **$49.50** |

Each lane task (the `/lane usage` ledger):

| Task | Lane | Result | Took | Cost | On Opus | What it did |
|---|---|---|---:|---:|---:|---|
| T1 | mid | DONE | 6 min | $1.11 | $2.22 | Found and wrote up the outside API keys the service needs and how to get them |
| T2 | mid | PARTIAL | 5 min | $0.77 | $1.53 | Code review (comments only, no edits) |
| | | | **11 min** | **$1.88** | **$3.75** | |

- **Hand off less, save less.** Main did nearly everything here itself: 134 lookups, 196 other commands, 84 browser steps and 68 file writes and edits, against 2 tasks for the lanes. The lanes' share saved 50%, the session as a whole 4%.
- **Half of main's cost was reading again.** Of main's $45.75, $23.92 (52%) went on reading the conversation so far from the cache at each request. The conversation grew to 470k tokens and was compacted twice. The lookup and command output main read itself came to about 160k tokens (480k characters).
- **0.3.7 came out of this session.** Once main has read over 40k tokens of lookups and command output itself since its last hand-off, the next tool result carries a short note, for main only, that such work can go to a lane. `/lane usage` now shows what main did itself, and what was saved in main's context (below).
- **Time at work:** main 142 minutes, mid 11, low 0. All 11 of the lanes' minutes ran while main was working too.

## Saved in main's context (estimate)

The files, logs and search results the lanes read never pile up in main's conversation. Had main read them itself, each of its later requests would have read them again from the cache (Opus 5.5 cache reads, $0.20 per million tokens). The saving above counts only the price gap, so this part isn't in it. It is estimated here from the session logs.

| | Project 1 | Project 2 | Project 3 | Project 4 |
|---|---:|---:|---:|---:|
| What the lanes read, summed over tasks | 802k tokens | 388k tokens | 93k tokens | 179k tokens |
| Saved in main's context | ≈$6.13 | ≈$5.41 | ≈$0.03 | ≈$2.39 |
| Together with the price-gap saving | ≈$41.61 of ≈$112.25 (37%) | ≈$14.03 of ≈$44.92 (31%) | ≈$2.37 of ≈$6.95 (34%) | ≈$4.26 of ≈$51.89 (8%) |

- **How:** what a lane read for a task is how far its prompt grew over the task (its last request's prompt less its first's). Each main request after the lane answered is taken to read that again, at Opus's cache-read price.
- **Counted on the low side.** A conversation that much fuller would have been compacted sooner, so requests from the one where (main's prompt + what the lane read) reaches the size main actually compacted at are left out, as are requests after a compaction. What the lane spent inside the task is already in "On Opus" and isn't counted again; cache rewrites after an expiry aren't counted either.
- **The shorter the session, the smaller it is.** Project 3 ran 54 minutes, so few main requests came after the lanes answered, and nothing was compacted. With no compaction to go by, main's context is taken to fill at the largest size it actually reached (the most conservative choice), which leaves ≈$0.03. It grows with long sessions where the lanes read a lot early.
- From 0.3.7, `/lane usage` works this out the same way (`main's context`).

## Speed and amount of work

| | Project 1 | Project 2 | Project 3 | Project 4 |
|---|---:|---:|---:|---:|
| Main at work | 154 min | 151 min | 14 min | 142 min |
| Lanes at work | 265 min | 62 min | 15 min | 11 min |
| of which alongside main | 115 min | 62 min | 6 min | 11 min |
| If main had done the lanes' share too | 419 min (2.7×) | 213 min (1.4×) | 29 min (2.1×) | 153 min (1.1×) |
| Work the same money buys | 1.50× | 1.28× | 1.51× | 1.04× |

- **Main didn't wait.** Checks and lookups ran alongside main's work, so what main alone would have done one after another overlapped instead.
- **"Main alone" assumes the same speed:** in the experiment below the three models took about as long (18–47 s). Time at work counts requests less than 4 minutes apart as one stretch.
- **Amount of work:** what's saved buys more work on the same budget: 1.31× over the four projects.

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
- **A gateway's model names:** project 3's session logs carry a Bedrock application inference profile's ARN instead of a model name, so a request whose name a lane's requests also carry is priced at that lane's model (mid Sonnet 5.5, low Haiku 5.5), and any other at its session's model (main Opus 5.5). Main's 7 requests while it was switched to Sonnet carry the mid lane's name, so they are priced as Sonnet 5.5. The script's `pricedByLaneName` (37) and `pricedBySession` (13) count those requests. The ARNs are removed from the published raw results.
- **Prices:** Claude API list prices, the same as the plugin's price table, checked against the official pricing page (T6). Cache writes at the 1-hour rate.

  | Per million tokens | Input | Cache write | Cache read | Output |
  |---|---:|---:|---:|---:|
  | Opus 5.5 | $4 | $8 | $0.20 | $20 |
  | Sonnet 5.5 | $2 | $4 | $0.10 | $10 |
  | Haiku 5.5 (prompt up to 100k tokens) | $0.10 | $0.20 | $0.01 | $0.50 |
  | Haiku 5.5 (over 100k) | $0.50 | $1 | $0.05 | $2.50 |

- **Cross-checks:** for project 1, the README has what `/lane usage` showed that day (all on Opus $106.05, with lanes $70.61; 468, 767 and 147 calls). Recomputed from the session logs it is $106.13 and $70.64 (468, 769 and 147 calls), within 0.1%. For project 2, the lane ledger ($4.46, $13.09 on Opus) matches the session logs ($4.47, $13.09). For project 3, the lanes' share `/lane usage` priced again from token totals ($1.36, $3.71 on Opus) matches the session logs. `/lane usage` counted main at 17 calls and $2.74, under the session logs' 20 and $3.21: before the project's first lane, main's log lived only in memory, so a plugin reload in that time dropped it (fixed in 0.3.6). The tables use the session logs. For project 4, what `/lane usage` showed (main 427 calls $45.75, mid 37 calls $1.87) matches the session logs.
- **Measure it yourself:** the scripts and the raw results are in [`measure/`](measure/).

  ```bash
  # one session: what main and its lanes spent, when each was at work, when tasks came in
  node docs/measure/session-stats.mjs ~/.claude/projects/<project folder> <main session id> [until]
  # (what was saved in main's context is under carry, what main did itself under mainWork)
  # the experiment: the same three tasks on three models, three times each
  REPS=3 node docs/measure/bench.mjs . bench.json
  ```

  Your own project's figures for today are a `/lane usage` away, and the ledger per task is `/lane tasks`.
- **Limits:**
  - These are list prices, not an invoice. Bedrock's rates can differ by contract and region, but they move the lanes and main alike, so the share saved stays the same.
  - Project 3's cost per task (`≈`) is an estimate by number of requests. The session totals are priced request by request.
  - What was saved in main's context is an estimate: whether main would really have read it all, or compacted even sooner, can't be known, so it is counted on the low side.
  - "On Opus" assumes Opus would have done the same work with the same tokens.
  - The experiment's tasks are three short ones; on long, hard work the gap may differ.
  - The experiment ran with the other plugins in daily use switched on, the same for all three models.
