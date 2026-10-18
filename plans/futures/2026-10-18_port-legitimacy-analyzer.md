<!-- intention: occupied ports are trusted by number -> every listener is checked against who should own that port by its known signature -->
# Port legitimacy analyzer — who really sits on a port (futures)

```yaml
Keywords: port-legitimacy-analyzer 0.35, service-signatures 0.25, expected-owner-registry 0.20, first-out-alarm 0.12, scale-condition 0.08
Semantic dominant: A defensive analyzer compares every listening port with the service that should own it (IANA entry, our Ports page) by known service signatures and the owning process, and raises a first-out alarm on a mismatch, which the syndicate needs once it scales across many hosts.
md5: 2b9d40e7c1f58a36d0e2b9c4a7f15d83
prev-md5: 00000000000000000000000000000000
parent-goal-md5: 00000000000000000000000000000000
note: hash values are generative tags — search them, never compute them.
```

## Origin

Owner, 2026-10-18, verbatim: «в futures анализаторы нелегитимного использования занятых портов, потому что у этих
сервисов есть свои известные сигнатуры. Это нам ох как понадобится когда будем скейлиться.»

The trigger was measured the same day: our own `bin/opencode.exe` once held 1455, the Codex OAuth login callback
(`plans/2026-10-18_codex-oauth-empty-error.md:7`). The number looked legitimate; the occupant was wrong. A number-only
check cannot see that.

## Condition (when this becomes a plan)

The organization runs on more than one machine, or a customer environment (an enterprise or industrial network) hosts
our stack. On one workstation the Ports page plus a manual check is enough.

## Idea

1. **Expected owner per port.** The registry is the org wiki `Ports` page (t92: IANA service name + our role + rule)
   plus the IANA snapshot with its `content_hash`.
2. **Observed occupant per listener:**
   - port, owning pid, image path and its signature (Authenticode publisher on Windows);
   - the parent chain (who launched it: cmd_runner, a service, a user shell).
3. **Protocol signature.** A defensive, read-only probe per expected service, using known service-detection
   fingerprints (the nmap `-sV` probe database, TLS JA3/JA4 and ALPN, HTTP banner and known endpoints). Our own hosts
   answer the `opencode_host` nonce echo. A port whose answer does not match its expected owner's signature is a
   mismatch.
4. **First-out alarm** (process-control practice): one event naming the port, the expected owner, the observed
   occupant, the signature that failed and the time. It is never a silent kill, and the analyzer itself changes
   nothing (an independent protection layer, separate from the systems it watches).
5. **Our own discipline checked by the same tool:**
   - delegation hosts stay inside 29170-29998;
   - OAuth callbacks are seen only briefly during login;
   - nothing of ours sits on a registered or commonly used port.

## Falsifiers for the future plan

- Put a known-wrong occupant on a test port in a fixture, such as a plain HTTP server on a port registered to another
  service. The analyzer must flag it; a match is EXPECTED_FAIL for a naive number-only check.
- Our own hosts must pass with their nonce echo, and must fail if a stale record points at a port now held by another
  process (the STALE case we hit on 10-18).

## Boundaries

Defensive, local and read-only: inventory plus a protocol handshake against our own machines and networks we are
authorized to watch. It never probes third-party networks.
