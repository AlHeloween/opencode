<!-- intention: a hand-tuned rooted-phone firewall breaks on every OS update and its owner re-reads a month of packets to rebuild it -> an on-device AI keeps the firewall's intent (what each app may reach and why) and re-derives the rules after an update, proving every allowed service still works -->
<!-- goal_sv: rooted-firewall 0.30, intent-not-rules 0.25, update-rederive 0.20, service-health-oracle 0.15, on-device-ai 0.10 -->
# Phone AI for a rooted firewall

Date: 2026-10-16 · Status: FUTURE — the owner: «но не сейчас».

```yaml
Keywords: rooted-firewall 0.30, intent-not-rules 0.25, update-rederive 0.20, service-health-oracle 0.15, on-device-ai 0.10
Semantic dominant: An on-device AI holds the firewall's intent and rebuilds the rules after every OS update, with each allowed service's health as the oracle.
md5: a3f7c1e9b5d24e8060a3f7c1e9b5d24e
prev-md5: 00000000000000000000000000000000
parent-goal-md5: 00000000000000000000000000000000
```

## Owner's words (2026-10-16, verbatim)

«По молодости был у меня пунктик - дошел до того что поставил на телефоне рутованный фаервол и вчиывался во все пакеты
за месяц прибил все лишнее, ну и че, потом ось андроида новая, по обновилось - надо делать все заново чтобы сервисы не
падали))) Кстати реально хитовый был бы проект заточить телефонный ИИ чтобы работать с руотванным фаерволом, но не
сейчас.»

Same day: «Кстати реально - в наше время поиска по открытым источникам... Это был бы хитовый проект.» — the demand
side: in an OSINT era whatever a phone leaks (trackers, ad IDs, location pings, contact uploads) becomes searchable and
joinable into a profile. The product's measurable value is the shrunken surface: third-party destinations and leaked
data categories per app, before vs after, with every allowed service still healthy.

And: «столько сколько сливает телефон больше не сливает ни одно устройство. Комп так или иначе заточен под полиси,
можно прибить, а вот в телефоне это в разы сложнее причем часто источники слива как раз легальные каналы.» — the hard
part: the leak rides LEGITIMATE channels (push, platform services, sync, crash reporting) that the phone needs, often on
the same endpoint as the function. A domain block list cannot separate them; the intent record must be per PURPOSE,
and the trade-off per service («block this and push dies») is shown with its measured consequence, never silent.

And the third answer: «Если без сообщения никак - его можно просто спуфанут - откуда - из антарктиды, утрирую.» —
so a decision per purpose is allow / block / SPOOF: the channel stays alive, the payload carries a substitute (a
coarse or fixed location, a reset ad ID, an empty contact list) the app accepts. Constraints to design for: the
substitute is consistent over time (a jumping fake is itself a fingerprint), the service-health oracle still decides
whether it broke something, and spoofing stays on data the app does not need for what the owner uses it for — never
on payments, identity checks or anti-fraud signals (owner's ethics toward services: no evasion where it harms them).

The owner's ruling on who decides: «пусть пользователь решает, как он хочет быть - это его частное пространство, мы
обеспечиваем его реальную неприкосновенность на сколько это вообще возможно.» — the phone is the user's private space;
the product executes the user's choice per purpose and makes it real, it does not override it. What the product owes
is an honest consequence before the choice (measured: «this breaks push», «payments from this app will fail», «this
may break the service's terms»). One line stays ours, not the user's: the product does not ship features whose
purpose is to defeat payment or anti-fraud checks — privacy is the goal, not fraud.

## The idea in our terms

The pain is not writing rules once — it is that rules are a REPRESENTATION that breaks when the OS changes (new
system services, renamed packages, new endpoints), while the owner's INTENT («this app may reach only its own
service; telemetry never») did not change. Store the intent, derive the rules; after an update re-derive and prove.

- Intent record per app: allowed purposes and destinations, with the evidence that justified each (packets seen,
  the service that broke without it) — the falsifiable record, not a block list.
- Re-derivation after an OS update: diff the new traffic against the intent, propose rule changes, apply the
  unambiguous ones, ask only about the rest.
- Oracle: each allowed service's health (it syncs, it notifies, it pays) checked after the change — a rule set that
  silently breaks a service is the failure the owner described.
- Our pieces that carry over: the model chain (on-device model first, a cloud fallback only for explanation), the
  falsifiable-record discipline, «security as a style, not paranoia» (owner, same day).

## Return condition

The owner opens it. Before that, nothing is built.
