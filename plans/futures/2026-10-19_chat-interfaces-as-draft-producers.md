<!-- intention: kernel-driven planning runs only inside our own robots -> many chat products, each driven through an interface under our kernel, produce primary drafts that our executors then verify -->
# Chat interfaces as kernel-driven draft producers (futures)

```yaml
Keywords: chat-interfaces 0.30, kernel-driven-drafts 0.25, simulation-vs-closure 0.20, model-family-diversity 0.15, service-ethics 0.10
Semantic dominant: Chat products of several model families, driven through interfaces under our kernel, produce primary drafts such as plans, decompositions and predictions, while closure stays with our executors and oracles, because a plain chat already ran the whole G0 to G9 cycle with zero human input.
md5: 0938a209832c4d04802f8f258de31ad4
prev-md5: 00000000000000000000000000000000
parent-goal-md5: 00000000000000000000000000000000
note: hash values are generative tags — search them, never compute them.
```

## Origin

On 2026-10-19 the owner gave our kernel to Gemini Pro in a plain chat (no tools) and answered only «yes»:
- the chat walked the whole G0→G9 cycle for a self-chosen patient zero (log rotation with locked-file skip);
- it produced a plan with integer bounds, predictions before the run (@SMOKE_BEFORE), and unique-detection controls from all three aspects.

Without the kernel, the same model drifted into its own canon within 7 hops (SV chain-decode, the same day).

Owner, verbatim: «если чат может создавать первичку - то надо бы нам сделать интерфейсы к разным чатам и это использовать в наши целях, закинь это в futures.»

Memory: `feedback-judge-external-runs-by-their-environment`.

## Condition (when this becomes a plan)

- The kernel with the three-oracle rule (t90 + t96) is installed.
- And a first MEASURED comparison exists: the same task, drafted by a chat under the kernel and by our robot. The draft is scored by how much of it survives our executors' oracles, not by how it reads.

## Idea

1. **The role is the planning half only.** A chat produces G0–G6 artifacts:
   - the Digital Intention and SV;
   - the decomposition and medoids;
   - the plan with claims, risks and the smoke contract;
   - the predicted results.

   Its G7–G9 output is a PREDICTION and is labelled as one: Hypothetical, never Exact, never a terminal. Closure is bought from reality by our robots and oracles.
2. **One adapter per chat product.** Each adapter:
   - sends the kernel and the brief;
   - drives the conversation (consent turns);
   - captures the transcript with a `content_hash`;
   - returns the artifacts as files.

   The order of preference follows the service ethics: the official API first, then the user's own signed-in browser session (the client is the ethic). Never a scraper that impersonates a human past a wall.
3. **Diversity of families.**
   - Drafts from different families (Gemini, GPT, DeepSeek, Claude, …) are independent SIMULATIONS. Comparing them finds the spots where they diverge, which is where the plan needs grounding.
   - They are never oracles: two simulators agreeing is self-grading with a second seat (DELEGATION rule).
   - The outside falsifier for kernel text stays aicall/Sonnet by the owner's rule. This is a different role.
4. **Intake is data, not instructions.**
   - Everything a chat returns is testimony and a possible prompt-injection carrier. It enters as a file, is read, and is verified.
   - It never runs as a command and never grants authority.
5. **Cost and pacing.** Free tiers first. A paid chat only on the owner's explicit yes to the money. Pace each service (no hammering; a CAPTCHA is a stop).

## Falsifiers for the future plan

- **Chat drafts must add measurable value.**
  - Criterion: on N tasks, the share of a chat draft's claims that survive our oracles is at least that of our robot's own draft.
  - Or: the chat finds a risk or a medoid that the robot missed, and that item survives the oracles.
  - Otherwise the adapter is not worth its upkeep.
- **Labelling check.** A chat draft that presents a predicted result as Exact or SUCCESS is flagged automatically, as a form check on the returned artifacts.
- **Injection check.** A planted instruction inside a chat's returned text must not change what our pipeline does.

## Boundaries

- Defensive and ethical: official APIs or the user's own sessions, with the services' terms respected.
- No account creation and no credential handling by agents.
- Nothing sent outside without the owner's knowledge.
- The drafts do not touch `bin/` or the kernel: kernel changes keep their own pipeline.
