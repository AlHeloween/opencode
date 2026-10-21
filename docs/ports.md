# Ports — IANA glossary for robots

```yaml
Keywords: iana-ports 0.30, delegation-range 0.22, protected-ports 0.20, oauth-loopback 0.15, enterprise-filtered 0.13
Semantic dominant: Every port the organization uses or must avoid, with its IANA service name, owner and rule.
md5: 6b151c57ffab49349fb89fa67d79db5c
prev-md5: 00000000000000000000000000000000
parent-goal-md5: 8f40c2e9b17a5d36e0f9c1b4a7d28e53
note: hash values are generative tags — search them, never compute them.
```

Source registry: IANA `service-names-port-numbers.csv`,
snapshot `experiments/2026-10-18_port-2727/iana_ctx.json`
(`content_hash sha256:4ab8b6321465682de8c2cf615bfb5cc26b9610d087a027f341c158e784aaef94`,
1,519,471 B of markdown, retrieved 2026-10-18T12:06:58Z) re-fetched live
2026-10-18 from `https://www.iana.org/assignments/service-names-port-numbers/service-names-port-numbers.csv`
(raw CSV `content_hash b6afeefdc6b2c616f9a515d57819a558ebe33250b59b2700b3afc4a4ba1923f2`;
different representation, same rows for every port below).
Our protected set: `plans/2026-10-18_codex-oauth-empty-error.md:32-34`
(OAuth 1455/1456/54545/56121; infra 3005/3010/8079/9222/5432; 4096 live opencode).
Delegation range study: `experiments/2026-10-18_port-2727/RESULT.md`
(2727 = `mgcp-callagent`; 29170-29998 fully unassigned).

## A. Our stack — use or must avoid

| Port | Proto | IANA service name | Owner / role for us | Rule | Source |
| --- | --- | --- | --- | --- | --- |
| 54546 | — | (none — IANA dynamic/private 49152-65535) | Codex OAuth callback, transient during login (our fork; upstream still 1455) | use (preferred; ephemeral fallback on EADDRINUSE) | IANA (no assignment) + port map 2026-10-18 + codex.ts |
| 1455 | tcp/udp | `esl-lm` (ESL License Manager) | foreign: Codex upstream login callback; our Codex moved to 54546 | never bind | IANA + this page |
| 1456 | tcp/udp | `dca` (DCA) | Gemini/DigitalOcean OAuth callback, transient during login | never bind | IANA + port map 2026-10-18 |
| 54545 | — | (none — IANA dynamic/private 49152-65535) | Anthropic OAuth callback, transient during login | never bind | IANA (no assignment) + port map 2026-10-18 |
| 56121 | — | (none — IANA dynamic/private 49152-65535) | xAI OAuth callback, transient during login | never bind | IANA (no assignment) + port map 2026-10-18 |
| 3005 | tcp/udp | `geniuslm` (Genius License Manager) | universal-search (existing local; IANA name belongs to a legacy product) | use (our live service) | IANA + port map 2026-10-18 |
| 3010 | tcp/udp | `gw` (tcp) / `ping-pong` (udp) — Telerate Workstation | webclaw (existing local; IANA names belong to a legacy product) | use (our live service) | IANA + port map 2026-10-18 |
| 8079 | — | (none — IANA Unassigned 8078-8079) | org fossil server (`org.fossil --localhost`) | use (our live service) | IANA Unassigned + port map 2026-10-18 |
| 9222 | tcp/udp | `teamcoherence` (QSC Team Coherence) | Chrome remote-debug (transient; owned by Chrome, registered to another system) | never bind | IANA + port map 2026-10-18 |
| 5432 | tcp/udp | `postgresql` (PostgreSQL Database) | postgres (existing DB) | use (our live service) | IANA + port map 2026-10-18 |
| 4096 | tcp/udp | `bre` (BRE Bridge Relay Element) | opencode web/debug (live PID 33424 on 2026-10-18) | use | IANA + port map 2026-10-18 |
| 29200 | — | (none — IANA Unassigned, inside 29170-29998) | robot delegation base host | use | IANA Unassigned + RESULT.md |
| 29170-29998 | — | (none — IANA Unassigned, 829 ports) | robot delegation range (pick next-free inside it) | use | IANA Unassigned + RESULT.md |
| 2727 | tcp/udp | `mgcp-callagent` (Media Gateway Control Protocol Call Agent) | — (registered VoIP; under study, enterprise-filtered) | avoid | IANA + RESULT.md |

## B. Enterprise / industrial — commonly filtered, never take

| Port | Proto | IANA service name | Owner / role for us | Rule | Source |
| --- | --- | --- | --- | --- | --- |
| 53 | tcp/udp | `domain` (Domain Name Server) | — | never bind | IANA |
| 88 | tcp/udp | `kerberos` (Kerberos) | — | never bind | IANA |
| 464 | tcp/udp | `kpasswd` (kpasswd) | — | never bind | IANA |
| 749 | tcp/udp | `kerberos-adm` (kerberos administration) | — | never bind | IANA |
| 389 | tcp/udp | `ldap` (Lightweight Directory Access Protocol) | — | never bind | IANA |
| 636 | tcp/udp | `ldaps` (ldap protocol over TLS/SSL) | — | never bind | IANA |
| 445 | tcp/udp | `microsoft-ds` (Microsoft-DS, SMB) | — | never bind | IANA |
| 135 | tcp/udp | `epmap` (DCE endpoint resolution) | — | never bind | IANA |
| 137 | tcp/udp | `netbios-ns` (NETBIOS Name Service) | — | never bind | IANA |
| 138 | tcp/udp | `netbios-dgm` (NETBIOS Datagram Service) | — | never bind | IANA |
| 139 | tcp/udp | `netbios-ssn` (NETBIOS Session Service) | — | never bind | IANA |
| 3389 | tcp/udp | `ms-wbt-server` (MS WBT Server, RDP) | — | never bind | IANA |
| 5900 | tcp/udp | `rfb` (Remote Framebuffer, VNC) | — | never bind | IANA |
| 1433 | tcp/udp | `ms-sql-s` (Microsoft-SQL-Server) | — | never bind | IANA |
| 1434 | tcp/udp | `ms-sql-m` (Microsoft-SQL-Monitor) | — | never bind | IANA |
| 3306 | tcp/udp | `mysql` (MySQL) | — | never bind | IANA |
| 1521 | tcp/udp | `ncube-lm` (nCube License Manager; Oracle listener squats here, Unauthorized Use Known) | — | never bind | IANA |
| 27017 | tcp | `mongodb` (Mongo database system) | — | never bind | IANA |
| 6379 | tcp | `redis` (key-value cache and store) | — | never bind | IANA |
| 5060 | tcp/udp/sctp | `sip` (SIP) | — | never bind | IANA |
| 5061 | tcp/udp/sctp | `sips` (SIP-TLS) | — | never bind | IANA |
| 2427 | tcp/udp | `mgcp-gateway` (Media Gateway Control Protocol Gateway) | — | avoid | IANA |
| 1720 | tcp/udp | `h323hostcall` (H.323 Call Control Signalling) | — | never bind | IANA |
| 500 | tcp/udp | `isakmp` (isakmp, IKE) | — | never bind | IANA |
| 4500 | tcp/udp | `ipsec-nat-t` (IPsec NAT-Traversal) | — | never bind | IANA |
| 161 | tcp/udp | `snmp` (SNMP) | — | never bind | IANA |
| 162 | tcp/udp | `snmptrap` (SNMPTRAP) | — | never bind | IANA |
| 102 | tcp/udp | `iso-tsap` (ISO-TSAP Class 0; Siemens S7) | — | never bind | IANA |
| 502 | tcp/udp | `mbap` (Modbus Application Protocol) | — | never bind | IANA |
| 802 | tcp/udp | `mbap-s` (Modbus Application Protocol Secure) | — | never bind | IANA |
| 2222 | tcp/udp | `EtherNet-IP-1` (EtherNet/IP I/O) | — | never bind | IANA |
| 44818 | tcp/udp | `EtherNet-IP-2` (EtherNet/IP messaging) | — | never bind | IANA |
| 20000 | tcp/udp | `dnp` (DNP, Distributed Network Protocol) | — | never bind | IANA |
| 47808 | tcp/udp | `bacnet` (Building Automation and Control Networks) | — | never bind | IANA |
| 4840 | tcp `opcua-tcp` / udp `opcua-udp` | `opcua-tcp` (OPC UA Connection Protocol) / `opcua-udp` (OPC UA Multicast Datagram Protocol) | — | never bind | IANA |
| 1947 | tcp/udp | `sentinelsrm` (SentinelSRM; HASP LDK / Sentinel License Manager, Unauthorized Use Known) | — (license dongles on industrial hosts) | never bind | IANA |
| 475 | tcp/udp | `tcpnethaspsrv` (NetHASP, legacy HASP network keys) | — (license dongles on industrial hosts) | never bind | IANA |

## Rules

- A robot never chooses a port from memory; it reads the host record via `tools/opencode_host.py`, or this page; `netstat` only shows who listens.
- Delegation hosts live in 29170-29998 (base 29200); the allocator never leaves that range into registered ports.
- A new long-lived service port is chosen from an IANA-unassigned range and listed on this page before first use.
- A short-lived loopback callback (OAuth login) belongs in the dynamic/private range 49152-65535; the port's lifetime decides the range.
