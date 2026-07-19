# Hinglish S2I — Volunteer Recording Web App

A low-friction, browser-based recording tool for building the multi-domain Hinglish
Speech-to-Intent corpus. Volunteers open a link, tap record, hear their clip back, confirm, and
move on. Everything else — speaker IDs, filenames, metadata, domain/intent tagging, scenario
assignment, provenance — is handled automatically by the system.

**Design goal:** minimise everything the volunteer must do, *except* the one step that protects
data quality — confirming each take before it is submitted.

---

## Table of contents

1. [Design principles](#1-design-principles)
2. [What the volunteer experiences](#2-what-the-volunteer-experiences)
3. [The confirmation step](#3-the-confirmation-step)
4. [Device vs. speaker identity](#4-device-vs-speaker-identity)
5. [System architecture](#5-system-architecture)
6. [Data model](#6-data-model)
7. [Speaker ID assignment](#7-speaker-id-assignment)
8. [Filename & storage convention](#8-filename--storage-convention)
9. [The scenario bank](#9-the-scenario-bank)
10. [Scenario assignment algorithm](#10-scenario-assignment-algorithm)
11. [The transcript problem](#11-the-transcript-problem)
12. [Audio capture pipeline](#12-audio-capture-pipeline)
13. [Friction budget](#13-friction-budget)
14. [Session logic & coverage tracking](#14-session-logic--coverage-tracking)
15. [Quality gates](#15-quality-gates)
16. [Consent, PII & ethics](#16-consent-pii--ethics)
17. [Admin dashboard](#17-admin-dashboard)
18. [API specification](#18-api-specification)
19. [Project structure](#19-project-structure)
20. [Tech stack & deployment](#20-tech-stack--deployment)
21. [Build order](#21-build-order)
22. [Failure modes & mitigations](#22-failure-modes--mitigations)

---

## 1. Design principles

Six rules resolve every design argument in this document. Lower numbers win.

| # | Principle | Consequence |
|---|-----------|-------------|
| **P1** | **Bad data must never reach the corpus silently** | Mandatory listen-and-confirm before every submission |
| **P2** | **One human = one speaker ID, always** | Device identity and speaker identity are separate concepts |
| **P3** | **The speaker never types if it can be avoided** | No login, dropdowns not text fields, transcript prefilled |
| **P4** | **Metadata is derived, never asked** | IDs, filenames, domain, intent, scenario all server-assigned |
| **P5** | **Never block on the network** | Recording works offline; uploads queue and retry in background |
| **P6** | **Corrupt data must be impossible, not merely discouraged** | Domain/intent read from server-issued task, never client input |

> **P1 overrides speed.** An earlier version of this design auto-advanced on release to save two
> seconds per utterance. That was wrong. A bad take committed blind — a cough, a phone buzz, a
> trailing "umm" — surfaces days later at QC, when the volunteer is long gone and the task must
> be reissued to someone else. Two seconds of confirmation is far cheaper than a lost utterance.

---

## 2. What the volunteer experiences

From link to first recording: **three taps, about 20 seconds.**

```
  Tap link ──▶ [Consent + 4 quick fields] ──▶ [Mic permission] ──▶ [Who's speaking?] ──▶ RECORDING
   (0s)            (~15s, once ever)          (~3s, once)         (1 tap)
```

### 2.1 Onboarding (once per speaker, ~15 seconds)

A single screen. No account, no password, no email.

- **Consent checkbox** with licence text — blocking, legally required (§16)
- **Four fields:** age (number), gender, native language (L1), region
- Age is a **number stepper** (a short numeric input with ± buttons), so it stays a tap
  interaction and never opens a full keyboard. Gender, L1 and region remain dropdowns.
- Submitting assigns a permanent `speaker_id`

### 2.2 The recording loop

Two states on one screen. The volunteer never navigates away.

**State A — prompt:**

```
┌──────────────────────────────────────────────────┐
│ Banking · Intent 7 of 12        ▓▓▓▓▓▓▓░░░░░     │  ← INTENT progress
│ 🎙 Recording as SPK_0042  ⇄ Switch               │  ← always visible (§4)
├──────────────────────────────────────────────────┤
│                                                  │
│   Aapka card kho gaya hai aur aap use            │  ← scenario, large type
│   turant band karwana chahte hain.               │
│                                                  │
│   ▸ Example (tap to reveal)                      │  ← collapsed by default (§9.3)
│   urgent, alarmed                                │  ← register hint
│                                                  │
│   Scenario 2 of 3   ●━━━●━━━○                    │  ← SCENARIO progress
│   Take     2 of 3   ◆━━━◆━━━◇                    │  ← EXAMPLE progress (§2.3)
│                                                  │
├──────────────────────────────────────────────────┤
│            ╭─────────────────╮                   │
│            │  ●  HOLD TO     │                   │  ← the only control
│            │     RECORD      │                   │
│            ╰─────────────────╯                   │
│         ▁▂▄▆█▆▄▂▁  live waveform                 │  ← proves the mic works
└──────────────────────────────────────────────────┘
```

**State B — confirm (appears instantly on release):**

```
┌──────────────────────────────────────────────────┐
│   ▶ ▁▂▄▆█▆▄▂▁  0:03                              │  ← auto-plays back
│                                                  │
│   ╭────────────────────╮  ╭──────────╮           │
│   │  ✓  KEEP & NEXT    │  │ ↻ Redo   │           │  ← Keep is default (spacebar)
│   ╰────────────────────╯  ╰──────────╯           │
│                                                  │
│   ✎ I said something different                   │  ← optional transcript edit
└──────────────────────────────────────────────────┘
```

**Hold-to-record** makes the utterance boundary physical and eliminates the most common failure
in recording tools — the speaker forgetting to press stop and uploading 40 seconds of silence.
It also naturally produces the short utterances this corpus needs. Spacebar is bound to the same
action on desktop.

### 2.3 Three-level progress

The scenario bank is three levels deep, so progress is shown at **three nested levels**. A
single bar would be actively misleading here.

```
Domain (Banking)
  └── 12 intents
        └── 2–3 scenarios per intent
              └── 3 examples per scenario
```

```
INTENT    Banking · Intent 7 of 12       ▓▓▓▓▓▓▓░░░░░     ← outer:  intents done
SCENARIO  Scenario 2 of 3                ●━━━●━━━○        ← middle: scenarios in this intent
EXAMPLE   Take 2 of 3                    ◆━━━◆━━━◇        ← inner:  examples in this scenario
```

| Level | Shows | Question it answers |
|-------|-------|---------------------|
| **Intent (outer)** | Intents completed / 12 in this domain | *"How much of this session is left?"* — abandonment |
| **Scenario (middle)** | Which situation within the current intent | *"Am I still on my lost card, or a new situation?"* — orientation |
| **Example (inner)** | Which of the 3 takes for this scenario | *"How many more times do I say this?"* — fatigue |

**Why all three are needed.** Without the example bar, a volunteer recording the third phrasing
of the same scenario sees nothing move at all — both upper bars stay frozen across three
consecutive recordings. That reads as a broken app. The inner diamonds are the only feedback
that anything happened after a single take.

**Exact session arithmetic (Banking, one take per example):**

```
12 intents × 2–3 scenarios × 3 examples  =  84 recordings
```

That is too long for one sitting (§14.1), so a **session batch is a horizontal slice of this
tree** — every intent and every scenario, but only one example number per pass. For Banking
that is 28 recordings (~5 min); later batches collect examples 2 and 3.

**Behaviour:**

- Inner diamonds fill as each take is confirmed: `◆━━━◆━━━◇`
- Last diamond fills → middle dot advances, diamonds reset
- Last middle dot fills → outer bar advances one intent, both lower rows reset
- **Redo** advances nothing — the diamond stays hollow, exactly the expected feedback
- **Skip** fills the current diamond in a muted colour, so the row reads complete without
  implying a recording exists

> **One subtlety.** Because a batch is a horizontal slice, within a single batch the speaker
> records example 1 of scenario 1, then example 1 of scenario 2, and so on — they do not fill
> all three diamonds consecutively. The inner bar therefore shows *lifetime* progress for that
> scenario across batches, with already-completed diamonds shown filled from the start of a
> later batch. This is the honest reading: it tells the speaker how many phrasings of this
> situation still exist, not how many are left in today's sitting.

All three rows are fixed-height CSS with no layout shift between states. A jumping progress
indicator reads as instability and undermines confidence in the tool.

> **On the example level specifically.** The three examples under a scenario are *seed
> phrasings*, and the speaker is asked to improvise rather than read them (§9.3). The inner bar
> therefore counts **takes for that scenario**, not "which example text is displayed" — the
> examples stay collapsed. It tells the speaker how many more times they will be asked about
> this same situation.

---

## 3. The confirmation step

**Mandatory. Every clip. No exceptions.**

### 3.1 How it stays fast

Confirmation costs time-to-decide, not upload time, because the upload starts before the
decision is made:

```
release button
     │
     ├──▶ blob → IndexedDB (durable, instant)
     ├──▶ background upload STARTS immediately (optimistic)
     └──▶ playback auto-starts, confirm UI appears
                    │
          ┌─────────┴─────────┐
      ✓ Keep                ↻ Redo
          │                   │
   commit DB row       cancel upload,
   advance to next     delete blob,
   scenario            same task reissued
```

By the time the volunteer has heard a 3-second clip and tapped Keep, the upload is usually
already finished. Redo simply aborts it.

### 3.2 Design details that prevent friction

| Detail | Why |
|--------|-----|
| **Playback auto-starts** | They hear the clip without tapping anything |
| **Keep is the default** | Large, right-thumb reach, bound to spacebar and Enter |
| **Redo is visually smaller** | Keeping is the common case; don't give both equal weight |
| **No modal, no dialog** | The confirm UI replaces the record button in place — no overlay to dismiss |
| **Redo reissues the same task** | The scenario doesn't change, so they can immediately try again |

**Cost:** roughly 2–3 seconds per utterance. A 28-recording batch runs about 6.5 minutes instead of
5. That is the correct trade.

### 3.3 The signal this gives you

Log `redo_count` per task. A scenario with a consistently high redo rate is usually confusing or
badly worded — you can fix the prompt text *during* collection rather than discovering it in
analysis. Surface this in the admin dashboard as a sortable column.

---

## 4. Device vs. speaker identity

**This is the most important correctness mechanism in the app.**

Your collection team is not fixed — it may be two members or ten, and phones get passed around.
The moment two humans record under one `speaker_id`, the benchmark is silently compromised:
train/dev/test splits are **speaker-disjoint**, so their clips land on both sides of a split and
results inflate invisibly.

### 4.1 The separation

```
localStorage  →  device_id   (one per browser, permanent)
                     │
                     ├── SPK_0042  ← Priya
                     ├── SPK_0043  ← Anand      one device, many speakers
                     └── SPK_0044  ← Rehan
```

A device **never** owns a speaker identity. It holds a roster of speaker profiles that have used
it, and every clip records both `device_id` and `speaker_id`.

### 4.2 Switching speakers

Two taps, available from any screen:

1. Tap the **"Recording as SPK_0042 ⇄"** chip in the header
2. Pick from recent speakers on this device, or **＋ New speaker** (runs the 15-second onboarding)

### 4.3 Guardrails, because people forget

| Guard | Behaviour |
|-------|-----------|
| **Session-start confirm** | Every new batch opens with "Recording as SPK_0042 — is this you?" One tap to confirm, one to switch |
| **Idle timeout** | After ~10 minutes of inactivity, re-ask who is speaking before accepting more clips |
| **QR override** | Leads pre-generate speaker QR codes for supervised sessions; scanning sets identity explicitly, no memory required |
| **Dashboard flag** | Any `device_id` with multiple speakers recording in a short window is flagged for lead audit |
| **Clip-level provenance** | `device_id` on every clip row means contamination is detectable *after the fact* |

That last point matters: storing `device_id` costs nothing and is the difference between
discarding 30 suspect clips and discarding an entire speaker's contribution.

> **Team-size agnostic by design.** Because identity is per-recording rather than per-device,
> the app behaves identically whether your collector team ends up with 2 members or 10.

---

## 5. System architecture

```
┌────────────────────────────────────────────────────────────────┐
│  BROWSER (React PWA)                                           │
│                                                                │
│  MediaRecorder ──▶ IndexedDB queue ──▶ background uploader     │
│       │                    ▲                     │             │
│  live waveform      survives offline/            │             │
│  (AnalyserNode)     refresh/crash                │             │
└──────────────────────────────────────────────────┼─────────────┘
                                                   │ HTTPS
                          ┌────────────────────────▼─────────────┐
                          │  API (FastAPI)                       │
                          │  • issues tasks (domain+intent+scen) │
                          │  • signs upload URLs                 │
                          │  • records metadata                  │
                          └──────┬────────────────────┬──────────┘
                                 │                    │
                    ┌────────────▼────────┐   ┌───────▼────────────┐
                    │  Object storage     │   │  PostgreSQL        │
                    │  raw WebM + WAV     │   │  speakers, devices,│
                    │                     │   │  clips, tasks      │
                    └────────────┬────────┘   └────────────────────┘
                                 │
                    ┌────────────▼─────────────────────────────────┐
                    │  Worker (Celery / RQ)                        │
                    │  ffmpeg → 16 kHz mono WAV → QC → ASR → export│
                    └──────────────────────────────────────────────┘
```

The browser does the minimum (capture + queue), the API signs URLs and writes rows, and all
expensive work happens asynchronously. Nothing the volunteer does ever waits on processing.

---

## 6. Data model

### `speakers`

| Column | Type | Note |
|--------|------|------|
| `speaker_id` | text PK | `SPK_0042` — server-assigned, never chosen |
| `token` | uuid | Secret resume key |
| `age` | int | **Exact age, collected.** Internal use only — see the publication rule below |
| `age_band` | enum (generated) | Derived: `18-25`, `26-35`, `36-50`, `50+`. **This is what gets published** |
| `gender` | enum | `male`, `female`, `other`, `prefer_not_say` |
| `l1` | enum | Native language |
| `region` | enum | State |
| `consent_at` | timestamptz | Non-null enforced before any clip is accepted |
| `consent_version` | text | Which licence text was agreed to |

No name, email, or phone. The corpus never contains identifying data.

> **Age: collect exact, publish banded.** Exact age is stored so you can report precise
> demographics in the datasheet — mean, range, standard deviation across speakers. But the
> *published* per-speaker rows carry `age_band` only, because exact age is quasi-identifying at
> small speaker counts. With ~10 speakers, `22, female, Bihar, Hindi L1` plausibly identifies one
> person; `18-25, female, Bihar` does not. The export step (§17) drops the `age` column
> unconditionally. This is a schema-level guarantee, not a policy someone has to remember.
>
> `age_band` is a **generated column**, so it can never drift out of sync with `age`:
>
> ```sql
> age_band text GENERATED ALWAYS AS (
>   CASE WHEN age < 26 THEN '18-25'
>        WHEN age < 36 THEN '26-35'
>        WHEN age < 51 THEN '36-50'
>        ELSE '50+' END
> ) STORED
> ```

### `devices`

| Column | Type | Note |
|--------|------|------|
| `device_id` | uuid PK | Stored in browser localStorage |
| `first_seen` | timestamptz | |
| `ua_class` | text | Device class from user-agent (not full UA) |

### `device_speakers`

Join table — the roster of speakers who have used a device.

| Column | Type |
|--------|------|
| `device_id` | uuid FK |
| `speaker_id` | text FK |
| `last_used_at` | timestamptz |

### `tasks`

One row per (speaker × intent × scenario × example). This is the unit the three progress bars
count.

| Column | Type | Note |
|--------|------|------|
| `task_id` | uuid PK | |
| `speaker_id` | text FK | |
| `domain` | enum | `BNK` · `EDU` · `TRV` · `VAS` |
| `intent` | text | `BNK.block_card` — **server-side only** |
| `scenario_id` | text FK | Assigned by §10 algorithm |
| `scenario_no` | int | Position of this scenario within the intent — drives the **middle** bar |
| `example_no` | int | 1–3, position within the scenario — drives the **inner** bar |
| `batch_no` | int | Which horizontal slice this task belongs to (§14.1) |
| `status` | enum | `pending`, `recorded`, `skipped` |
| `redo_count` | int | Incremented on each Redo (§3.3) |

The three progress bars are derived from a single query — no separate progress state to keep in
sync:

```sql
SELECT intent, scenario_no, example_no, status
FROM tasks
WHERE speaker_id = $1 AND domain = $2 AND batch_no = $3
ORDER BY intent, scenario_no, example_no;
```

### `clips`

| Column | Type | Note |
|--------|------|------|
| `clip_id` | uuid PK | |
| `task_id` | uuid FK | Carries domain/intent/scenario provenance |
| `speaker_id` | text FK | |
| `device_id` | uuid FK | **Contamination detection (§4)** |
| `filename` | text | Canonical, see §8 |
| `raw_path` / `wav_path` | text | Original WebM / transcoded WAV |
| `duration_s` | float | Computed by worker |
| `transcript_provisional` | text | Prefilled example or speaker edit (§11) |
| `transcript_final` | text | ASR + human pass |
| `transcript_source` | enum | `example_unedited`, `speaker_edited`, `asr`, `human_verified` |
| `prompted` | bool | True if the example was revealed before recording |
| `qc_flags` | text[] | `too_short`, `clipped`, `silent`, `noisy` |
| `status` | enum | `uploaded`, `processed`, `rejected` |

### `scenarios`

| Column | Type | Note |
|--------|------|------|
| `scenario_id` | text PK | `BNK.block_card.v2.s1` |
| `intent` | text | |
| `scenario_set` | enum | `v1` / `v2` |
| `text_hi` | text | Scenario shown to the speaker |
| `examples` | text[] | Exactly 3 seed phrasings — hidden by default |
| `register` | text | Delivery note (`urgent, alarmed`) |
| `use_count` | int | Global counter driving assignment (§10) |

---

## 7. Speaker ID assignment

```
New speaker  →  POST /api/speakers  →  server assigns SPK_0042 + token
                                    →  added to this device's roster
Returning    →  pick from roster (or QR) → coverage state resumes
```

- IDs are sequential and opaque (`SPK_0001`…). No personal data encoded.
- The **server** assigns them; a client can never propose an ID (P6).
- Leads can pre-generate ID + QR pairs for in-person sessions — the volunteer scans and starts
  with zero typing and zero ambiguity about who is recording.

---

## 8. Filename & storage convention

Generated server-side at task-issue time, so malformed names cannot exist.

```
<domain>_<speaker_id>_<intent_short>_<scenario_set>_s<scenario_no>e<example_no>_<clip_short>.wav

bnk_SPK0042_block_card_v2_s2e1_9f3a1c.wav
edu_SPK0113_explain_concept_v1_s1e3_4b77de.wav
```

| Segment | Purpose |
|---------|---------|
| `domain` | Human-scannable grouping |
| `speaker_id` | Enables speaker-disjoint splitting |
| `intent_short` | Label without redundant domain prefix |
| `scenario_set` | Lets you compare v1 vs v2 elicitation |
| `s<n>e<n>` | Scenario and example position — makes the file self-describing |
| `clip_short` | 6 hex chars — uniqueness even on retry |

Encoding `s2e1` rather than a flat take number means you can tell from the filename alone that
this is the first phrasing of the second situation for that intent — useful when auditing raw
storage without a database to hand.

**Storage layout:**

```
s3://corpus/
  raw/<domain>/<speaker_id>/<clip_id>.webm    ← immutable original, never deleted
  wav/<domain>/<speaker_id>/<filename>.wav    ← 16 kHz mono deliverable
  manifests/<date>/manifest.jsonl             ← one JSON line per processed clip
```

Keeping raw WebM permanently means a transcoding bug is recoverable by re-running the worker
rather than re-recruiting volunteers.

---

## 9. The scenario bank

### 9.1 Exact inventory

Seeded from the eight domain field guides (v1.0 + v2.0 Extended). All verified unique — zero
scenario or phrasing collisions across versions or domains.

| Domain | v1 scenarios | v2 scenarios | **Total** | v1 phrasings | v2 phrasings | **Total** |
|--------|-------------:|-------------:|----------:|-------------:|-------------:|----------:|
| Banking (BNK) | 28 | 28 | **56** | 84 | 84 | **168** |
| Education (EDU) | 24 | 24 | **48** | 72 | 72 | **144** |
| Travel (TRV) | 24 | 24 | **48** | 72 | 72 | **144** |
| Assistant (VAS) | 23 | 23 | **46** | 69 | 69 | **138** |
| **TOTAL** | **99** | **99** | **198** | **297** | **297** | **594** |

Every scenario carries exactly **3** seed phrasings. Per intent this works out to roughly
**4–6 scenarios** available (2–3 in each version), which comfortably covers 2–3 takes per
speaker without repetition.

### 9.2 Seeding

A one-time script loads JSON exports of the guides into the `scenarios` table:

```
data/scenarios/{bnk,edu,trv,vas}_{v1,v2}.json
```

### 9.3 The example-reveal mechanism

Examples are **collapsed by default**, and this is a research decision, not a UI preference.

Scenario-based elicitation only works if the speaker phrases the request in their *own* words.
If the example is visible, most people read it aloud — producing exactly the parroted speech the
field guides warn against.

Revealing an example sets `prompted = true` on that clip. This gives an honest per-clip record
of which utterances were spontaneous, so you can report the ratio in the datasheet or exclude
prompted clips from the test set.

---

## 10. Scenario assignment algorithm

**Not random.** Pure random assignment fails in two specific ways: it over-samples some scenarios
while starving others, and it can hand one speaker two near-identical situations in a row.

### 10.1 What is actually being chosen

Because a batch walks **every scenario of every intent** (§14.1), the algorithm is not choosing
*which scenarios to use* — all of them get used. It chooses **which version** (v1 or v2) each
intent's scenarios are drawn from, and in what order they appear.

```
assign_scenarios(speaker, intent, batch_no):

    # 1. pick the version for this speaker × intent
    version   = argmin over {v1, v2} of:
                  use_count_version[intent][v]        # global balance
                + 2.0 × already_used_by(speaker, v)   # strong: alternate versions
                + uniform(0, 0.1)                     # jitter

    # 2. take ALL scenarios of that intent in that version
    scenarios = scenarios(intent, version)            # 2 or 3 of them
    shuffle(scenarios, seed=speaker_id)               # stable per speaker

    # 3. emit one task per (scenario, example)
    for scenario_no, s in enumerate(scenarios, 1):
        for example_no in 1..3:
            yield Task(intent, s, scenario_no, example_no, batch_no)

    increment use_count on CONFIRM, not on issue
```

### 10.2 Why each term exists

| Term | Purpose |
|------|---------|
| **`use_count_version`** | Keeps v1 and v2 evenly represented across the whole corpus, so neither elicitation set dominates. |
| **Strong alternation weight (2.0)** | If a speaker did Banking with v1 scenarios, their next Banking batch draws v2 — different situations, not repeats. |
| **Stable per-speaker shuffle** | Scenario order varies between speakers (so the corpus isn't uniformly ordered) but is reproducible for one speaker across resumed sessions. |
| **Jitter** | Breaks ties so speakers don't all walk identical paths. |

### 10.3 Two implementation rules

1. **Assign at task-issue time, not per-batch upfront.** Batches get abandoned; assigning lazily
   means counters reflect clips that actually exist.
2. **Increment `use_count` on confirmation, not on issue.** A skipped or redone task should not
   consume a scenario's budget.

### 10.4 Worked example

`BNK.block_card` has **2 scenarios** in v1 and **2** in v2. A speaker assigned v1 for this intent
generates:

| Task | scenario_id | scenario_no | example_no | Filename fragment |
|------|-------------|------------:|-----------:|-------------------|
| 1 | `BNK.block_card.v1.s1` | 1 | 1 | `..._v1_s1e1_...` |
| 2 | `BNK.block_card.v1.s1` | 1 | 2 | `..._v1_s1e2_...` |
| 3 | `BNK.block_card.v1.s1` | 1 | 3 | `..._v1_s1e3_...` |
| 4 | `BNK.block_card.v1.s2` | 2 | 1 | `..._v1_s2e1_...` |
| 5 | `BNK.block_card.v1.s2` | 2 | 2 | `..._v1_s2e2_...` |
| 6 | `BNK.block_card.v1.s2` | 2 | 3 | `..._v1_s2e3_...` |

Six recordings for this intent: two situations × three phrasings each. The progress bars read
`Scenario 1 of 2` / `Take 3 of 3` at task 3, then roll over to `Scenario 2 of 2` / `Take 1 of 3`.

A later batch for the same speaker draws v2 for this intent, giving six *different* situations
and phrasings with no repetition.

---

## 11. The transcript problem

**The tension:** you need to know what was said, but typing a Hinglish sentence after every take
would roughly triple session time and cause abandonment.

**Three-tier resolution:**

| Tier | When | Speaker cost | Accuracy |
|------|------|--------------|----------|
| **1. Provisional** | Every clip, automatic | **Zero** | Low — it's the example text, and they were told to improvise |
| **2. Optional edit** | Speaker taps ✎ on the confirm screen | ~8s, opt-in | High for that clip |
| **3. ASR + human** | Post-session, offline | Zero | Final — becomes `transcript_final` |

The confirmation screen (§3) is the natural home for tier 2 — the speaker has just heard their
clip, so if it differs from the example they are best placed to say so right then.

**Why this is correct rather than lazy:** the transcript is *not* the label. The intent label
comes from the server-issued task and is always accurate. Transcripts matter only for the
pipeline (ASR→NLU) baseline and WER — both of which require a *verified* transcript that no
volunteer typing on a phone would produce to research standard. Deferring to ASR + human is
simultaneously lower-friction and higher-quality.

> Never display `transcript_provisional` as authoritative in the admin UI. `transcript_source`
> exists precisely so nobody mistakes an unedited example for ground truth.

---

## 12. Audio capture pipeline

### 12.1 In the browser

```js
navigator.mediaDevices.getUserMedia({
  audio: {
    channelCount: 1,
    echoCancellation: false,   // OFF — these process speech and damage
    noiseSuppression: false,   // acoustic fidelity for ASR research
    autoGainControl: false     // OFF — we want true amplitude
  }
})
```

Disabling the browser's speech-enhancement chain matters: those algorithms are tuned for
telephony intelligibility, not corpus fidelity, and alter spectra in ways that contaminate
acoustic analysis.

**Format:** MediaRecorder produces WebM/Opus (MP4/AAC on some Safari versions). **Do not fight
this in the browser.** In-browser WAV encoding costs CPU, drains battery, and inflates uploads
6–8× on mobile. Opus at 32+ kbps is transparent for 16 kHz speech, so nothing meaningful is lost.

### 12.2 Offline-first queueing

Every clip is written to **IndexedDB on release**, before any upload is attempted. The UI never
waits on the network (P5). Clips survive refreshes, crashes, and tunnels.

### 12.3 Server-side normalisation

```bash
ffmpeg -i input.webm \
  -ar 16000 \        # matches HiACC, IITG-HingCoS, wav2vec2/HuBERT
  -ac 1 \            # mono
  -c:a pcm_s16le \   # 16-bit PCM
  -af "silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.15, \
       areverse, \
       silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.15, \
       areverse" \   # trim excess silence, LEAVE ~150ms padding
  output.wav
```

The padding is deliberate — the field guides require 0.2–0.5 s of silence at each end, and
clipping the first syllable of a 1.5-second command destroys the clip.

---

## 13. Friction budget

| Optimisation | Saves | How |
|--------------|-------|-----|
| **No login/password** | ~60s + abandonment | Token in localStorage, QR for in-person |
| **Steppers & dropdowns, not free text** | ~40s | Age is a ± stepper; the rest are dropdowns. No full keyboard. |
| **Mic permission once** | ~3s × N | One `getUserMedia`, stream held open all session |
| **Hold-to-record** | Whole failure class | Physical utterance boundary; no forgotten stop |
| **Optimistic upload** | 1–5s × N on mobile | Upload starts on release, before confirmation |
| **Auto-playback on confirm** | ~2s × N | They hear the clip without tapping |
| **Keep = spacebar/Enter** | ~1s × N | Default action needs no aim |
| **IndexedDB queue** | Prevents session loss | Survives offline, refresh, crash |
| **Prefilled transcript** | ~10s × N | Typing is opt-in |
| **Examples collapsed** | Improves data quality | Prevents parroting |
| **Preloaded next scenario** | ~200ms × N | Fetched during current recording |
| **Server-assigned metadata** | All manual entry | Filename, ID, domain, intent, scenario |
| **Single-screen SPA** | ~500ms × N | No route changes mid-session |

**Net:** roughly **8–12 seconds** per utterance including confirmation. A 28-recording domain batch
finishes in about **6.5 minutes**.

> **Two places friction is intentional:** the consent checkbox (legally load-bearing, §16) and
> the confirmation step (data quality, §3). Everything else bends.

---

## 14. Session logic & coverage tracking

### 14.1 Session composition

The full tree for one domain-version is large — Banking is `12 intents × 2–3 scenarios × 3
examples = 84 recordings`, roughly 15 minutes even at 10 s per take. That is well past the point
where volunteers abandon.

So a **session batch is a horizontal slice of the tree**, not a subtree:

```
Batch 1:  every intent × every scenario × example 1   →  28 recordings  (~5 min)
Batch 2:  every intent × every scenario × example 2   →  28 recordings
Batch 3:  every intent × every scenario × example 3   →  28 recordings
```

| Property | Value |
|----------|-------|
| Batch size | 23–28 recordings (varies by domain) |
| Target duration | Under 7 minutes |
| Coverage guarantee | Every batch touches **all intents** in the domain |

**Why slice horizontally rather than vertically.** A vertical slice (finish all 3 examples of
intent 1, then move on) means an abandoned session leaves some intents with 3 recordings and
others with none. A horizontal slice means an abandoned session still leaves *every* intent
evenly covered — the corpus degrades gracefully rather than lopsidedly.

On completion the speaker is offered the next batch, or a different domain. Every speaker covers
**all intents within each domain they touch**.

### 14.2 Why every speaker covers every intent

Inherited from the field guides and enforced by the task generator, not left to discipline.

If speaker A only records `check_balance` and speaker B only `block_card`, the model can learn
intent from *voice* rather than *words*. Because splits are speaker-disjoint, this inflates
results invisibly. Generating tasks as complete per-domain sets makes the confound structurally
impossible.

### 14.3 Live coverage

```sql
SELECT domain, intent,
       count(*) FILTER (WHERE status='processed') AS clips,
       count(DISTINCT speaker_id)                 AS speakers
FROM clips JOIN tasks USING (task_id)
GROUP BY domain, intent;
```

Intents below the floor (40) are highlighted, and the task generator weights new sessions toward
them automatically.

---

## 15. Quality gates

Four layers now, since confirmation adds a human one at the source.

**1. Speaker (synchronous, §3):** hears every clip and explicitly keeps or redoes it. Catches
coughs, background noise, wrong phrasing, and false starts at zero downstream cost.

**2. Client (instant, silent):** clips under 0.4 s are rejected as mis-taps and the task is
silently re-queued.

**3. Worker (async):**

| Check | Threshold | Action |
|-------|-----------|--------|
| Duration | `< 0.8s` or `> 15s` | flag `too_short` / `too_long` |
| Peak amplitude | sustained 0 dBFS | flag `clipped` |
| Speech energy | none detected | flag `silent`, reject |
| Estimated SNR | below threshold | flag `noisy` |

**4. Human (post-session):** flagged clips enter the admin review queue. The volunteer is never
told a clip failed — the task is simply reissued.

---

## 16. Consent, PII & ethics

**Consent is blocking and versioned.** No clip is accepted from a speaker without non-null
`consent_at` — enforced server-side, not merely in the UI.

- `consent_version` records exactly which licence text was agreed to, so later text changes never
  retroactively misrepresent earlier speakers
- Consent text must state: research use, public dataset release, licence (e.g. CC-BY-4.0), and
  redistribution

**PII rules baked into the product:**

- No name, email, or phone collected; speaker IDs are opaque
- **Exact age is collected but never published.** It is stored for datasheet statistics; the
  export emits `age_band` only, since exact age is quasi-identifying at small speaker counts (§6)
- The Virtual Assistant domain naturally invites real names and numbers (`"Mummy ko call lagao"`).
  Scenario text instructs first-names-only, and the review queue screens for spoken phone numbers
- Raw audio is access-controlled; only the screened corpus is published

**Withdrawal:** a speaker can request deletion via their `speaker_id`; a single cascade removes
their clips from storage and database. Support this from day one — retrofitting it later is far
more expensive.

---

## 17. Admin dashboard

Authenticated route (`/admin`) for domain leads.

- **Coverage heatmap** — domain × intent against the floor of 40
- **Speaker table** — clips, completion rate, `prompted` ratio, QC reject rate
- **Device audit** — devices with multiple speakers, flagged for contamination review (§4.3)
- **Redo-rate column** — scenarios with high `redo_count` are probably badly worded (§3.3)
- **Review queue** — flagged clips with inline playback, accept/reject
- **Transcript correction** — ASR output beside audio, editable into `transcript_final`
- **QR generator** — pre-assigns speaker IDs for in-person sessions
- **Scenario usage view** — `use_count` distribution, to confirm the assignment algorithm is
  balancing as intended
- **Export** — `manifest.jsonl` + HuggingFace `datasets` layout, split-aware. Drops the `age`
  column unconditionally, emitting `age_band` (§6)

---

## 18. API specification

Nine endpoints.

| Method | Route | Purpose |
|--------|-------|---------|
| `POST` | `/api/devices` | Register device, return `device_id` |
| `POST` | `/api/speakers` | Create speaker + consent, add to device roster |
| `GET` | `/api/devices/:id/speakers` | Roster for the switch-speaker UI |
| `GET` | `/api/session/next` | Issue task batch with assigned scenarios |
| `POST` | `/api/clips/init` | Reserve `clip_id` + filename, return signed upload URL |
| `PUT` | *(signed URL)* | Direct-to-storage upload — **never proxied through the API** |
| `POST` | `/api/clips/:id/confirm` | **Commit after speaker confirms**; attach transcript + `prompted` |
| `POST` | `/api/clips/:id/discard` | Redo — abort upload, delete blob, increment `redo_count` |
| `GET` | `/api/admin/coverage` | Dashboard data |

**Three things worth calling out:**

1. **Uploads bypass the API** via signed URLs, so the API stays fast regardless of audio volume.
2. **`domain` and `intent` are never accepted from the client** — read from the server-issued
   task via `task_id` (P6).
3. **A clip is not corpus data until `/confirm`.** The `init` → upload → `confirm` sequence means
   an abandoned or redone recording never enters the dataset.

---

## 19. Project structure

```
hinglish-s2i-recorder/
├── web/                          # React PWA
│   ├── src/
│   │   ├── screens/
│   │   │   ├── Onboarding.jsx    # consent + 4 quick fields
│   │   │   ├── Recorder.jsx      # THE screen — prompt + confirm states
│   │   │   ├── SpeakerSwitch.jsx # device roster (§4)
│   │   │   └── Complete.jsx
│   │   ├── audio/
│   │   │   ├── useRecorder.js    # getUserMedia + MediaRecorder
│   │   │   ├── usePlayback.js    # confirm-step auto-playback
│   │   │   └── useWaveform.js    # AnalyserNode
│   │   ├── queue/
│   │   │   ├── db.js             # IndexedDB wrapper
│   │   │   └── uploader.js       # optimistic upload, abort on redo
│   │   └── api/client.js
│   └── public/manifest.json      # PWA
│
├── api/
│   ├── routers/{devices,speakers,session,clips,admin}.py
│   ├── services/
│   │   ├── task_generator.py     # coverage-aware batches (§14)
│   │   ├── scenario_assign.py    # §10 algorithm
│   │   ├── naming.py             # canonical filenames (§8)
│   │   └── storage.py            # signed URLs
│   └── models/
│
├── worker/
│   ├── transcode.py              # ffmpeg → 16 kHz mono WAV
│   ├── qc.py                     # duration, clipping, silence, SNR
│   ├── asr.py                    # IndicWhisper → transcript candidate
│   └── export.py                 # manifest.jsonl + HF datasets
│
├── data/scenarios/               # 198 scenarios, 594 phrasings
│   ├── bnk_v1.json  bnk_v2.json
│   ├── edu_v1.json  edu_v2.json
│   ├── trv_v1.json  trv_v2.json
│   └── vas_v1.json  vas_v2.json
│
└── admin/
```

---

## 20. Tech stack & deployment

| Layer | Choice | Why |
|-------|--------|-----|
| Frontend | React + Vite, PWA | Installable, offline-capable, no app store |
| Audio | MediaRecorder + Web Audio API | Native, no dependencies |
| Local queue | IndexedDB (`idb`) | Durable; localStorage cannot hold blobs |
| API | FastAPI | Async, fast to build, automatic OpenAPI docs |
| DB | PostgreSQL | Relational integrity for speaker/device/task/clip provenance |
| Storage | S3-compatible (R2 / Spaces / S3) | Signed URLs; R2 has no egress fees |
| Worker | Celery or RQ + Redis | Standard |
| Hosting | Vercel/Netlify + Railway/Fly | Free tiers cover a one-month project |

**HTTPS is mandatory** — `getUserMedia` fails over plain HTTP on every modern browser except
`localhost`. This breaks most first deployments.

### Browser support

| Browser | Status |
|---------|--------|
| Chrome/Edge Android | Full — primary target |
| Safari iOS 14.3+ | Works; may emit MP4/AAC (worker handles both) |
| Firefox | Full |
| Desktop browsers | Full, plus spacebar binding |

---

## 21. Build order

**Day 1 — de-risk audio.** One HTML page: record via `getUserMedia`, play back, upload. Test on a
real Android phone **and** a real iPhone before writing anything else. Mobile audio is where the
surprises live.

**Day 2 — the spine.** Schema (including `devices` and `device_speakers`), `/api/speakers`,
`/api/session/next`, signed-URL upload, scenario seeding.

**Day 3 — the recorder screen.** Hold-to-record, waveform, **confirm state with auto-playback**,
IndexedDB queue, optimistic uploader with abort-on-redo. This screen determines success.

**Day 4 — identity + assignment.** Speaker switcher, device roster, session-start confirm, and
the §10 scenario assignment algorithm.

**Day 5 — worker + QC.** ffmpeg transcode, QC flags, manifest export.

**Day 6 — admin + polish.** Coverage heatmap, device audit, review queue, QR generator, PWA.

**Day 7 — pilot.** Three real volunteers end-to-end. Measure *seconds per utterance*; if it
exceeds ~12 s, remove friction before scaling.

> Ship Days 1–4 before touching the dashboard. A working recorder with a spreadsheet export
> collects data; a beautiful dashboard with a broken recorder collects nothing.

---

## 22. Failure modes & mitigations

| Failure | Impact | Mitigation |
|---------|--------|------------|
| **Two humans, one speaker ID** | **Speaker leakage — benchmark invalidated** | Device/speaker separation, session-start confirm, idle timeout, QR, `device_id` on every clip (§4) |
| Bad take submitted blind | Wasted utterance, late discovery | Mandatory listen-and-confirm (§3) |
| iOS Safari format differences | Clips unreadable | Worker accepts WebM *and* MP4/AAC; test on real iPhone Day 1 |
| Speaker clears browser data | Duplicate profile | Acceptable; QR pre-assignment avoids it in supervised sessions |
| Patchy mobile network | Abandonment | IndexedDB queue + background retry; UI never blocks |
| Volunteer reads the example aloud | Parroted speech | Examples collapsed; `prompted` flag records it honestly |
| Scenario over/under-use | Skewed corpus | `use_count`-weighted assignment (§10) |
| Intent coverage skew | Classes below floor | Coverage-aware task generator |
| Confusing scenario wording | High redo rate | `redo_count` surfaced in dashboard; fix prompts mid-collection |
| Consent text changes mid-collection | Ambiguous legal basis | `consent_version` per speaker, never retroactive |

---

## Companion documents

- **Intent Taxonomy & Domain Specification** — the 45-label set, script convention, annotation
  rules. The `scenarios` and `tasks` tables implement this.
- **Data Collection & Preparation Pipeline Architecture** — what happens to audio after handoff;
  this app is the Core tier's ingestion front-end.
- **Domain Collection Field Guides (v1.0 + v2.0 Extended)** — source of all 198 scenarios and 594
  phrasings, and the protocol this app automates.# Gyan-max-S2i_recorder
