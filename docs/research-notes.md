# Research notes — deterministic scheduled batch orchestration

> Research backing the `ardur-top10-engine` orchestrator (`runCycle`) and the
> cycle math (`cycle.ts`). Captures the best-practice decisions behind the 6-hour
> refresh loop: idempotent cycles, UTC cycle IDs, delivery semantics, last-good-wins,
> cross-cycle diffing/stability, clock correctness, and backfill/catch-up.
> Date: 2026-06-11. Schema version: `ardur-content-pipeline/v1`.

This is the *why* behind the code; the *what* lives in `docs/spec.md` and
`ARCHITECTURE.md`. Every design decision below is traceable to a concrete
function in `src/`.

---

## 1. Cron semantics and why we never trust the trigger to be on time

POSIX `cron` is a *best-effort wall-clock dispatcher*, not a guaranteed-delivery
scheduler. The classic `cron`/`crontab` contract is: "at approximately this
wall-clock time, in the daemon's local timezone, attempt to start the job." It
makes **no** guarantee that (a) the job starts exactly on the boundary, (b) a job
runs at all if the machine was asleep/off at the boundary, or (c) two ticks can't
overlap if the previous run is still going. `anacron` exists precisely because
vanilla `cron` *skips* missed runs on machines that aren't always-on — it has no
catch-up. (POSIX `crontab` spec — [pubs.opengroup.org](https://pubs.opengroup.org/onlinepubs/9699919799/utilities/crontab.html); cron behavior — [man7.org cron.8](https://man7.org/linux/man-pages/man8/cron.8.html); anacron catch-up — [man7.org anacron.8](https://man7.org/linux/man-pages/man8/anacron.8.html))

**GitHub Actions `schedule:` inherits all of these weaknesses and adds more.**
The reference trigger for this engine is `.github/workflows/refresh.yml`
(`cron: "0 */6 * * *"`). GitHub's own docs state scheduled events "may be delayed
during periods of high load," and the community-observed reality is worse:

- **Drift is routine.** 5-minute drift is normal; 15-minute drift is common
  around the top of the hour; 30+ minutes happens on busy days. Scheduled
  workflows are explicitly *best-effort*, and event-driven workflows are
  prioritized over them under load. ([GitHub Actions events docs](https://docs.github.com/en/actions/using-workflows/events-that-trigger-workflows#schedule); [community discussion #156282](https://github.com/orgs/community/discussions/156282); [crontap analysis](https://crontap.com/blog/github-actions-cron-drift-problem))
- **Runs can be silently dropped** under load — a cycle may simply not fire.
- **UTC only.** No `CRON_TZ`, no timezone config. ([GitHub schedule docs](https://docs.github.com/en/actions/using-workflows/events-that-trigger-workflows#schedule))
- **Auto-disable after 60 days of repo inactivity** — scheduled runs do not
  count as "activity."
- **5-minute minimum cadence**; sub-5-minute crons coalesce.

### Design consequences (encoded in code)

1. **The trigger time is advisory; the *cycle window* is authoritative.** We never
   key anything on "when the workflow happened to start." Instead, `cycleFor(now)`
   floors `now` to the 6-hour UTC boundary and derives a stable `cycle.id`. A run
   that fires at `06:14Z` (drifted) computes the *exact same* cycle as one that
   fired at `06:00Z`: `2026-06-11T06:00Z`. Drift cannot produce a different or
   duplicate cycle. → `src/cycle.ts`.
2. **Top-of-hour drift is acceptable** because a 6h window has > 5h33m of slack
   (ARCHITECTURE §8). We don't fight drift; we make it irrelevant. We *could*
   move the cron off `:00` to reduce drift, but correctness does not depend on it.
3. **`workflow_dispatch` is always wired** alongside `schedule:` so a missed cycle
   can be re-fired manually, and the same `cycle.id` math makes the manual re-run
   idempotent (see §2).
4. **Single-flight.** `concurrency: { group: ardur-refresh, cancel-in-progress: false }`
   in `refresh.yml` guarantees two cycles never overlap — the cron equivalent of
   `flock`. A late cycle finishes before the next starts.

---

## 2. Idempotency: at-least-once delivery + an idempotent sink = effective exactly-once

True end-to-end exactly-once requires coordination (two-phase commit between
source, processor, sink) that adds latency and operational complexity. The
well-established cheaper path: **at-least-once delivery into an idempotent sink**
yields the same observable result as exactly-once, without the coordination
overhead. "If your sink is idempotent, at-least-once delivery gives you the same
end result as exactly-once." (Google Cloud Dataflow — [exactly-once concepts](https://cloud.google.com/dataflow/docs/concepts/exactly-once); Kafka EOS / idempotent producer — [Confluent](https://www.confluent.io/blog/exactly-once-semantics-are-possible-heres-how-apache-kafka-does-it/); idempotent-pipeline pattern — [dev.to/alexmercedcoder](https://dev.to/alexmercedcoder/idempotent-pipelines-build-once-run-safely-forever-2o2o))

We deliberately choose **at-least-once triggering + idempotent cycle** rather than
chasing exactly-once at the scheduler. Justification: the scheduler (cron/GitHub
Actions) *cannot* give us exactly-once — it drops and double-fires. So the engine
must be safe under both duplication and loss.

### How idempotency is realized

- **Every artifact is keyed on `cycle.id`** (the contract's `CycleMeta.id`). Re-running
  a `cycle.id` overwrites in place; it never appends.
- **Deterministic, content-addressed run IDs.** `runCycle` derives stage `runId`s
  from `cycle.id` (e.g. `top10:2026-06-11T06:00Z`) rather than random UUIDs or
  timestamps. Two runs of the same cycle produce **byte-identical** published
  sets — the definition of an idempotent sink. This is why `selectTop10` is a
  *pure function of its inputs*: same `RankingArtifact` + same previous Top-10 ⇒
  same `Top10Artifact`, no wall-clock leakage. → `src/select.ts`, `src/orchestrate.ts`.
- **Skip-if-published guard.** `runCycle` consults an optional
  `runners.loadPublished(cycle)`; if the current cycle is already published, it
  short-circuits with `status: 'published'` and does no work. This makes a manual
  re-fire (or a GitHub Actions retry) a cheap no-op rather than a duplicate write.
- **Why deterministic IDs and not "generate fresh each run":** a random `runId`
  would make a retried cycle *look* different downstream (new provenance chain),
  defeating idempotency and corrupting the audit trail. Determinism is the
  load-bearing property, per the idempotent-pipeline literature above.

---

## 3. UTC cycle IDs and clock/timezone correctness

All cycle math is **UTC, integer-arithmetic, DST-free**:

- `windowStart = floor(epochMillis / CYCLE_INTERVAL_MS) * CYCLE_INTERVAL_MS`,
  computed on the epoch (`Date.getTime()`), which is timezone-agnostic by
  definition. There is no local-time conversion anywhere in the hot path, so
  there is **no DST discontinuity** — the failure mode that makes naive
  "subtract 6 hours from local midnight" schedulers double-run or skip on DST
  transition days. (DST hazards in schedulers — [Quartz cron + DST notes](https://www.quartz-scheduler.org/documentation/quartz-2.3.0/tutorials/crontrigger.html); UTC-everywhere rationale — [Jon Skeet, "Storing UTC is not a silver bullet"](https://codeblog.jonskeet.uk/2019/03/27/storing-utc-is-not-a-silver-bullet/) — we store *and compute* in UTC because the cadence is fixed-interval, the case where UTC genuinely is the right tool.)
- `cycle.id` is the ISO window-start truncated to the minute with a `Z` suffix
  (`2026-06-11T06:00Z`), human-readable and lexicographically sortable — sorting
  cycle IDs as strings yields chronological order, which we rely on for
  "previous cycle" lookups and trend ordering.
- Boundaries land exactly on `00:00 / 06:00 / 12:00 / 18:00Z`, matching the
  `cron: 0 */6 * * *` trigger so the window the code computes is the window the
  scheduler intended.
- **Leap seconds** are a non-issue: JS `Date`/Unix time ignores them, and a 6h
  fixed interval is unaffected by a ±1s civil-time adjustment.

→ `src/cycle.ts` (`cycleFor`, `previousCycle`, `nextRefreshAt`).

---

## 4. Last-good-wins (availability over freshness on failure)

The freshness/availability trade-off for a content board: a *stale but coherent*
Top-10 beats a *blank or half-built* one. This is the standard "serve last known
good" pattern (CDN stale-while-revalidate; blue/green "keep the old version live
until the new one is proven"). ([stale-while-revalidate, RFC 5861](https://datatracker.ietf.org/doc/html/rfc5861); availability-over-consistency framing — [Google SRE Workbook, "Data Processing Pipelines"](https://sre.google/workbook/data-processing/))

Encoded as a three-state outcome in `OrchestrationResult.status`:

- **`published`** — all stages succeeded; the new cycle is live.
- **`degraded`** — published, but upstream raised non-fatal `warnings` (e.g. a
  source timed out, a topic under-filled). The board is live and usable but
  flagged for monitoring.
- **`failed`** — a stage *threw*; `runCycle` publishes **nothing** and returns the
  warnings. The previously published cycle stays live (last-good-wins). No blank
  state ever reaches the app.

The critical invariant: **publish is all-or-nothing per cycle.** We never publish
a partial set (e.g. ranking succeeded but synthesis threw), because a half-cycle
is worse than last cycle. → `src/orchestrate.ts`.

---

## 5. Cross-cycle diffing and stability (anti-churn)

A board that re-sorts from scratch every 6 hours "thrashes": items flip in/out on
sub-noise score differences, which reads as instability to users and makes
"what changed?" meaningless. News/feed ranking systems counter this with
**hysteresis / incumbency bias** — a challenger must beat the incumbent by a
*margin*, not by an epsilon, to take the slot. This is the same idea as Schmitt-trigger
hysteresis in signal processing and "positional stability" in ranked feeds.
(Hysteresis for ranking stability — general control-theory pattern, [Schmitt trigger / hysteresis](https://en.wikipedia.org/wiki/Hysteresis); feed-ranking stability motivation — [Google SRE Workbook, pipeline correctness](https://sre.google/workbook/data-processing/))

### Decisions

1. **Diff by stable identity, not position.** Deltas compare `clusterId` across
   cycles, not array index — an item that holds rank 3 across two cycles is
   `same`, and an item present last cycle is `carriedOver`. → `computeDelta`,
   `src/stability.ts`.
2. **`movement ∈ {new, up, down, same}`** derived from previous-vs-current rank of
   the same `clusterId`.
3. **`stabilityMargin` hysteresis.** Membership selection (who is *in* the board)
   gives incumbents a score bonus of `stabilityMargin`; final *ordering within*
   the board uses the real comparator. So an incumbent whose true score is within
   `stabilityMargin` below a challenger keeps its slot, but everyone is still
   ranked honestly once selected. This demonstrably reduces `churnRate` versus a
   naive re-rank (covered by a unit test) while never *lying* about scores.
4. **`churnRate ∈ [0,1]`** = fraction of previous slots replaced; with
   `carriedOver + fresh === board size`. Surfaced for monitoring (spec §6: alert
   on churn spikes). → `computeStability`, `src/stability.ts`.

Trade-off noted: hysteresis trades a small amount of *freshness* (a marginally
better challenger waits a cycle) for *stability*. `stabilityMargin` is tunable and
defaults to `0` (no hysteresis) so the behavior is opt-in and the default board is
a faithful re-rank. The "how sticky?" default is tracked as a spec §10 open
question.

---

## 6. Backfill / catch-up on missed or late cycles

Because the scheduler drops runs (§1), the engine must be *re-runnable for an
arbitrary past cycle*, not only "now":

- **`cycleFor(now)` + manual `now`.** `runCycle({ now })` accepts an explicit
  instant, so a backfill job can replay cycle `2026-06-11T00:00Z` by passing any
  timestamp inside that window. The cycle math does the flooring; the caller need
  not know the boundary.
- **Idempotent replay (§2)** means catch-up is safe: re-running a cycle that *did*
  publish is a no-op; re-running one that *failed* produces the correct artifact.
- **Bounded catch-up, not unbounded.** Unlike `anacron` (which replays every
  missed run), a *content* board only cares about the **latest** missed cycle —
  serving a 12-hour-old board to "catch up" is pointless. So the recommended
  backfill policy is "compute the *current* cycle and the most recent unpublished
  one," not "replay all gaps." This is a deliberate divergence from
  general-purpose batch backfill (e.g. Airflow's `catchup=True` which backfills
  every interval — [Airflow DAG catchup docs](https://airflow.apache.org/docs/apache-airflow/stable/authoring-and-scheduling/catchup.html)); for a freshness-oriented board, `catchup` should effectively be *latest-only*.
- **Previous-cycle lookup for deltas** uses `previousCycle(cycle)` →
  `runners.loadPreviousTop10`, so deltas are computed against the last *published*
  board even if intermediate cycles were skipped. Diffing tolerates gaps.

---

## 7. Summary of decisions → code

| Concern | Decision | Where |
|---|---|---|
| Drifted/dropped trigger | Cycle derived from `floor(now,6h)` UTC, not trigger time | `cycle.ts` |
| Duplicate/retry fire | Deterministic `cycle.id`-keyed run IDs; pure selection; skip-if-published | `orchestrate.ts`, `select.ts` |
| Delivery semantics | At-least-once trigger + idempotent sink ≈ exactly-once | `orchestrate.ts` |
| Clock/timezone/DST | UTC epoch integer math; no local time; leap-second-immune | `cycle.ts` |
| Partial failure | Last-good-wins; all-or-nothing publish; `published`/`degraded`/`failed` | `orchestrate.ts` |
| Board thrashing | `clusterId` diffing + `stabilityMargin` hysteresis; honest ordering | `stability.ts` |
| Missed cycles | Replayable `runCycle({now})`; latest-only catch-up, not full backfill | `orchestrate.ts`, `cycle.ts` |

---

## 8. Sources

- POSIX `crontab` — https://pubs.opengroup.org/onlinepubs/9699919799/utilities/crontab.html
- `cron(8)` man page — https://man7.org/linux/man-pages/man8/cron.8.html
- `anacron(8)` (catch-up semantics) — https://man7.org/linux/man-pages/man8/anacron.8.html
- GitHub Actions `schedule` event — https://docs.github.com/en/actions/using-workflows/events-that-trigger-workflows#schedule
- GitHub Actions cron drift (community) — https://github.com/orgs/community/discussions/156282
- GitHub Actions cron drift analysis — https://crontap.com/blog/github-actions-cron-drift-problem
- Dataflow exactly-once concepts — https://cloud.google.com/dataflow/docs/concepts/exactly-once
- Kafka exactly-once semantics — https://www.confluent.io/blog/exactly-once-semantics-are-possible-heres-how-apache-kafka-does-it/
- Idempotent pipelines pattern — https://dev.to/alexmercedcoder/idempotent-pipelines-build-once-run-safely-forever-2o2o
- HTTP `stale-while-revalidate` (RFC 5861) — https://datatracker.ietf.org/doc/html/rfc5861
- Google SRE Workbook — Data Processing Pipelines — https://sre.google/workbook/data-processing/
- Storing/computing in UTC (Jon Skeet) — https://codeblog.jonskeet.uk/2019/03/27/storing-utc-is-not-a-silver-bullet/
- Hysteresis (stability) — https://en.wikipedia.org/wiki/Hysteresis
- Airflow catchup/backfill — https://airflow.apache.org/docs/apache-airflow/stable/authoring-and-scheduling/catchup.html
</content>
</invoke>
