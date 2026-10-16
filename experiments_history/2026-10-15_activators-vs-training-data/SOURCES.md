# Source list with stamps (t50)

Status ladder: a dataset paper/card, canonical repo README, or vendor doc fetched
via webfetch = primary authority (≈ Inferred). Hashes below are the `content_hash`
values reported by the `researcher_agent` fetches on 2026-10-15/16; they were not
independently re-fetched by Smit. Snippet-only sources are excluded (Guess).

## Q1 — kernel (local reads, no URL)

- `prompt_kernel/source.py` (1218 lines): SOURCE_ROUTING :848-888; ladder :851-857;
  generic_web_rule :860; classes :861-867; routes :870-886; REWARD_FUNCTION :116;
  BUG_FIX/LEAN :130; JIDOKA :176-177; KAIZEN :181-182; G2 MANHATTAN_L1 :535 /
  LEAN_RANKING :559; G3 CLAIM rules :579-580; ORACLE/FSM sections :203-384;
  ISO comment :970; terms :997-1013; CLAIM_LEDGER :1036; SVM :1060.
  Evidence: local `read`/`grep` (Exact handles, not URL stamps).
- `prompt_kernel/addons.py:216` — style-authority string (Exact handle).

## Q2 — corpora (primary)

- Pile paper: https://arxiv.org/html/2101.00027v1 — researcher hash a97ec149cb259965bd209e173ef6630e622b56a92d00ba36a9db7a30da88168c68
- Pile abs: https://arxiv.org/abs/2101.00027
- Pile repo: https://github.com/EleutherAI/the-pile
- RedPajama paper: https://arxiv.org/html/2411.12372v1 — hash bcf22cee…
- RedPajama card: https://huggingface.co/datasets/togethercomputer/RedPajama-Data-1T — hash a5b27c03…
- RedPajama repo: https://github.com/togethercomputer/RedPajama-Data — hash 506a399d…
- Dolma paper: https://arxiv.org/html/2402.00159v2 — hash 2af9be47…
- Dolma abs: https://arxiv.org/abs/2402.00159 — hash 58d7c820…
- Dolma card: https://huggingface.co/datasets/allenai/dolma — hash 53e9a079…
- FineWeb paper: https://arxiv.org/html/2406.17557v1
- FineWeb card: https://huggingface.co/datasets/HuggingFaceFW/fineweb
- FineWeb-Edu card: https://huggingface.co/datasets/HuggingFaceFW/fineweb-edu
- FineWeb-Edu classifier: https://huggingface.co/HuggingFaceFW/fineweb-edu-classifier
- C4 documentation: https://arxiv.org/html/2104.08758v1 — DOI https://doi.org/10.18653/v1/2021.emnlp-main.98
- T5 origin: https://jmlr.org/papers/v21/20-074.html
- RefinedWeb paper: https://arxiv.org/html/2306.01116v1
- Stack v1 paper: https://arxiv.org/abs/2211.15533
- Stack v2 paper: https://arxiv.org/html/2402.19173v1
- Stack cards: https://huggingface.co/datasets/bigcode/the-stack · https://huggingface.co/datasets/bigcode/the-stack-v2
- peS2o repo/card: https://github.com/allenai/peS2o · https://huggingface.co/datasets/allenai/peS2o
- S2ORC paper: https://aclanthology.org/2020.acl-main.447/ — DOI https://doi.org/10.18653/v1/2020.acl-main.447
- S2ORC preprint: https://arxiv.org/abs/1911.02782
- ROOTS paper: https://arxiv.org/abs/2303.03915 — hash 500b88f7…
- Llama 2 report: https://arxiv.org/html/2307.09288v2
- Llama 3 report: https://arxiv.org/html/2407.21783v3
- OLMo report: https://arxiv.org/html/2402.00838v4
- DeepSeek V3 report: https://arxiv.org/html/2412.19437v2
- DeepSeek R1 report: https://arxiv.org/html/2501.12948v1
- Qwen2 report: https://arxiv.org/html/2407.10671v1
- Qwen3 report: https://arxiv.org/html/2505.09388v1
- GLM-4 report: https://arxiv.org/abs/2406.12793

## Q3 — density anchors (primary)

- PPO: https://arxiv.org/abs/1707.06347
- InstructGPT: https://arxiv.org/abs/2203.02155
- RLHF survey: https://arxiv.org/abs/2312.14925
- Pile PhilPapers §2.19: https://ar5iv.labs.arxiv.org/html/2101.00027 (canonical https://arxiv.org/abs/2101.00027)
- OpenFst: https://github.com/google-research/openfst · docs https://www.openfst.org

## Q4 — thinking-mode switches (primary vendor docs)

- DeepSeek V3.1 card (template switch): https://huggingface.co/deepseek-ai/DeepSeek-V3.1
- vLLM DeepSeek recipe: https://docs.vllm.ai/projects/recipes/en/stable/DeepSeek/DeepSeek-V3_1.html
- DeepSeek release notes (chat vs reasoner): https://api-docs.deepseek.com/news/news250821/
- DeepSeek thinking guide + API ref: https://api-docs.deepseek.com/guides/thinking_mode/ · https://api-docs.deepseek.com/api/create-chat-completion
- Qwen3 card (enable_thinking): https://huggingface.co/Qwen/Qwen3-32B
- AlibabaCloud deep-thinking: https://www.alibabacloud.com/help/en/model-studio/deep-thinking
- Z.AI thinking mode: https://docs.z.ai/guides/capabilities/thinking-mode
- Claude extended thinking: https://platform.claude.com/docs/en/build-with-claude/extended-thinking
- Claude thinking steering: https://platform.claude.com/docs/en/build-with-claude/thinking-steering-and-cost

## Q5 — 3FS vs Engram (primary)

- 3FS README: https://github.com/deepseek-ai/3FS/blob/main/README.md
- Engram repo: https://github.com/deepseek-ai/Engram
- Engram paper: https://github.com/deepseek-ai/Engram/blob/main/Engram_paper.pdf
- Engram abs: https://arxiv.org/abs/2601.07372 — repo hash 04e1ed85… / abs hash f2000be6…

## Q6 — multimodality (primary)

- Qwen2-VL: https://arxiv.org/abs/2409.12191 — full https://arxiv.org/html/2409.12191v2
- Qwen2.5-VL: https://arxiv.org/abs/2502.13923v1 — full https://arxiv.org/html/2502.13923v1
- Chameleon: https://arxiv.org/abs/2405.09818 — full https://arxiv.org/html/2405.09818v2
- Muse Spark: https://dev.meta.ai/models/muse-spark · https://openrouter.ai/meta/muse-spark-1.3
- Claude models/vision: https://platform.claude.com/docs/en/models/overview · https://www.anthropic.com/claude/fable · https://openrouter.ai/anthropic/claude-fable-5
- LongCat: https://longcat.ai/ · https://www.blackbox.ai/models/blackboxai/meituan/longcat-2.5-preview · https://openrouter.ai/meituan

## Свежие source_stamp (Smit, 2026-10-16, curl + sha256, runs 20261016T014423Z_b385fea6 / 20261016T014555Z_23f26769, оба exit 0)

Полная таблица №→URL→sha256→bytes — в REPORT.md § Source hashes. Ключ соответствия: Pile=20EE7797…; RedPajama paper=5764E981… card=E9EC149A…; Dolma paper=F83558DD… card=F8F169B1…; FineWeb paper=6A84CD4B… Edu card=C9191616…; C4=503DB4C1…; RefinedWeb=1FA0960A…; Stack v2=32BAE053… v1=07224922…; peS2o=4CBB92A4…; S2ORC=B0F4BC50…; ROOTS=6D2C8ECF…; Llama2=C72A08D3… Llama3=089F2657… OLMo=35423400… DS-V3=A1602D6E… DS-R1=1D82CC97… Qwen2=ED84C1A5… Qwen3=CF5C79D6… GLM-4=89C32D9E…; PPO=3A19E2FE… InstructGPT=44041210… RLHF-survey=A6BF9E73…; OpenFst=CB6546F3…; DS-V3.1 card=0F2E4825… DS-thinking=35350389… Qwen3-32B=F6737EF9… AlibabaCloud=EE5FC04C… Z.AI=57E4BDC2… Claude-steering=5349FCD7…; Engram repo=F72AC6FB… abs=537D8D0C…; 3FS README=170A3AA9…; Qwen2-VL=39838A43… Qwen2.5-VL=BF47A282… Chameleon=E5DC80D2…; Muse-Spark=5F142645… Claude-models=543CA5A3… longcat.ai=40D7CF93…; ar5iv-Pile=C382B5DD….

Итог: 42/42 свежих хэша; понижений Documented→Hypothetical: 0.
