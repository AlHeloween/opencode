@echo off
python experiments_history\2026-10-14_independent-glm-cache-probe\cache_probe.py --request experiments_history\2026-10-14_independent-glm-cache-probe\retention.json --endpoint https://opencode.ai/inference/go/v1/chat/completions --auth-file bin\auth.json --idle-seconds 360 --live --out experiments\2026-10-14_glm-cache-live\retention-live
exit /b %ERRORLEVEL%
