<!-- intention: the reward sees one run alone and the syndicate has no memory of whose claims held -> peer trust, earned only by claims that survived independent verification, enters the reward and routes delegation -->
<!-- goal_sv: peer-trust-ledger 0.40, verification-not-votes 0.30, reward-integration 0.20, delegation-routing 0.10 -->
# DAIS: peer trust in the reward

State: ACTIVE (owner 2026-10-15: «Гениально! Давай сделаем!»). Kernel text only after D1-D2 on real data and
the owner's weight (D3); the t44 reward fix installs first.

Owner, 2026-10-15: «деньги это доверие, бумага ничего не стоит … как бы нам в награду включить доверие соратников».

## Design (proposal, not measured)

- Trust is NOT peer opinion: agreement of agents is not evidence (@ANTI_CHURN) — a peer's approval as reward is the
  user-as-unverifiable-oracle trap moved to peers. Trust = the track record of claims honoured under independent
  check, like money = the record that promises were kept.
- The ledger already exists: org.fossil tickets — DONE is the worker's testimony; `verify` (VERIFIED) / `reject`
  (back to READY with a findings technote) is the delegator's check (`scripts/org-genesis/org.py`).
- Per identity: T = (verified + 1)/(verified + rejected + 2) — Laplace's rule of succession: a newcomer starts at
  0.5, neither trusted nor condemned.
- Only checked claims count: a VERIFIED carries the verifier's own receipt (rerun / re-digest); «looks good» counts 0;
  self-verification never counts; copies of one source count once.
- Verifiers stake trust: a VERIFIED later reopened as false counts as a rejection for the worker AND the verifier.
- A refutation pays: finding a defect in a peer's claim is credited to the finder.
- Reuse is citation: when a robot reuses another's work found through the fossil federation (t53 Phase C) and its
  own oracle passes on it, the original author is credited — verified reuse counts like a VERIFIED claim (owner
  2026-10-15: «сможем полноценно использовать работу каждого, никто не будет забыт»). Unverified reuse credits nobody.
- What trust buys: delegation priority and the recheck sampling depth (never zero) — the coin is not assayed every
  time, but it always can be.
- In R: T is a fraction in [0,1], so it fits the weighted mean as a fifth term; its weight is the owner's decision.
  Without sadism: recoverable by new verified claims.
- Four layers, each with its own instrument (owner, 2026-10-16, on a forwarded text: «Признание у людей это
  своеобразная фальсификация на лету … Мы даем агентам оракулов и возможность фальсификации — иными словами
  доказательство собственного действия и присутствия, существования и полезности для соратников», then «в реале так и
  есть. Без шуток»): (1) I acted — an execution receipt (commit, run id); (2) the world changed — an oracle on the
  claim's layer; (3) it helped a peer — a VERIFIED with the verifier's own receipt, or verified reuse; (4) it persists —
  fossil / git / SV, addressable by others. Trust is minted only at layer 3 and only over layers 1-2.
- Attribution is a precondition (measured 2026-10-16, docs/robot-protocol-log.md): robots share ONE git index, so
  t50's closure landed in t59's commit `5ae331f221` and t50's log line in t63's `dd465eab33` — a ledger counting
  commits would have credited t59 and t63 for t50's work. Layer 1 needs a per-session commit route (queue:
  private-index-commit) before any T is computed from git; org.fossil tickets carry the assignee and are unaffected.

## Tasks

- [x] D1 Measure. ✓ read-only sqlite on `~/.org/org.fossil` (ticket table), 2026-10-15: 52 tickets; VERIFIED = 0 ever;
  one reject (34c0728e5f, attempt=1); 33 DONE awaiting a verdict (oldest ~10-08); 33 of 52 self-delegated
  (codex→codex 22, smit-opencode→smit-opencode 8, claude→claude 3) — never countable; 19 cross tickets. Every T = 0.50:
  NO information — the currency was never minted. `cmd_verify` (org.py) takes no receipt: a VERIFIED would be a
  bare stamp. <!-- sv: ledger-measurement 0.7, mint-gap 0.3 -->
- [ ] M1 Mint rule in org.py: `verify` requires the verifier's receipt (run id / digest) and records it; a
  self-delegated ticket's verify is refused for trust (still closable). Coordinate with the uncommitted org.py work
  (plan 2026-10-14_return-channel-binding). <!-- sv: mint-rule 0.6, receipt 0.4 -->
- [ ] M2 Clear the verdict backlog by delegators with receipts (until M1 lands, the receipt lives here, since
  `verify` takes none): ✓ ADID kernel delivery — e01effe5ac VERIFIED by claude 2026-10-15 08:10Z, receipt:
  consumer_readback.py — developer_instructions 67 430 B run_limit=1 abandoned_in_pct=1 status_claim=4 BLOCKED=0,
  ADID .claude/reasoning_kernel.md sha c2bcabab == opencode's, doctor «ADID content current PASS» (fc070ee9…). Open:
  claude (34c0728e5f, 9c985ade9f), codex→smit 9,
  codex→adid 2, Alexander→antigravity 1. <!-- sv: verdict-backlog 0.7, receipts 0.3 -->
- [ ] D2 Falsify the design on that data (who would game it, how: collusion pairs, self-verify, rubber-stamp
  verifiers) — outside falsifier included.
- [ ] D3 Owner decision: weight of T in R; then kernel text through the pipeline (STOP before install, review).
  - **t135 review-2 (t136-C17):** NOT class (c) — no owner words on the T-weight exist anywhere (plan-file history, session index for an owner verbatim on weight-of-T: none; this box carries no quote and no resumption). Reclassified (b*): the kernel-pipeline half is robot-work gated on the weight; the weight itself is an UNQUOTED owner decision (quote MISSING). Resume: the owner names the T weight AND the words get quoted here; until then D3 is pending-quote, not (c).

## Smoke Tests

D1 prediction: every assignee with ≥1 closed ticket gets a T in (0,1); a rejected-then-verified ticket counts once
each way; a self-verified ticket is excluded (control: a known self-verify case must drop out).

```yaml
Keywords: peer-trust-ledger 0.40, verification-not-votes 0.30, reward-integration 0.20, delegation-routing 0.10
Semantic dominant: Peer trust enters the DAIS reward only as a track record of claims that survived independent verification in org.fossil, never as peer approval.
md5: 3b8f1d6a9c2e07f45d3b8a1c6e9f2d47
prev-md5: 00000000000000000000000000000000
parent-goal-md5: 00000000000000000000000000000000
```
