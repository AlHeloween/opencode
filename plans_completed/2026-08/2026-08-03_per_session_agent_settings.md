# Per-Session Agent Settings

**Date:** 2026-08-03
**Completed:** 2026-08-03T12:35 UTC
**Status:** ✅ DONE

---

## 1. Goal

Настройки агентов (модель, вариант) должны быть per-session:
- **Нет активной сессии** → изменения пишутся в глобальный конфиг (`opencode.jsonc`) — это дефолты для новых сессий
- **Есть активная сессия** → изменения пишутся ТОЛЬКО в сессионный файл (`sessions/{id}.jsonc`)
- **Новая сессия** → копирует глобальные настройки агентов как стартовые

---

## 2. Current State

### 2.1 `model.set()` (local.tsx:434-485)

Всегда пишет в глобальный `opencode.jsonc` (строки 447-460), плюс дублирует в сессию (461-473):

```typescript
// ТЕКУЩЕЕ поведение — всегда global write
if (options?.agent) {
  void sdk.client.global.config.update({   // ← ГЛОБАЛЬНАЯ запись ВСЕГДА
    config: { agent: { [agentName]: { model: ... } } },
  })
  // Плюс сессионная копия
  const ss = sessionSettings()
  setSessionSettings({ ...ss, agent: { ... } })
}
```

### 2.2 `saveAll()` (local.tsx:194-216)

Пишет `model.json` (глобальный) + `sessions/{id}.jsonc` (сессионный). `agent` поле сохраняется только в сессию.

### 2.3 `forAgent()` (local.tsx:321-332)

Читает сначала сессию, потом global config — **read path уже правильный**.

### 2.4 Инициализация сессии

При создании сессии глобальные настройки НЕ копируются в сессию. Сессия начинает с пустых настроек, и `forAgent()` fallback-ает к global config.

---

## 3. Changes

### 3.1 `model.set()` — conditional global write

```diff
  set(model, options) {
    // ...
-   if (options?.agent) {
+   // Only write to global config when NO session is active.
+   // When a session is active, settings are session-local.
+   const sid = getActiveSessionID()
+   if (options?.agent && !sid) {
      void sdk.client.global.config.update({
        config: { agent: { [agentName]: { model: ... } } },
      })
+   }
+   if (options?.agent) {
      // Always capture in session-specific overrides when session active
      const ss = sessionSettings()
      setSessionSettings({ ...ss, agent: { ... } })
    }
    // ...
  }
```

### 3.2 Session init — copy global defaults

При открытии/создании сессии, если `sessionSettings().agent` пуст для текущего агента — взять модель из глобального `Agent.Info.model` и записать в сессию.

**Место:** `refreshSessionSettings()` (local.tsx:166-191) — после загрузки сессионных настроек, если `settings.agent` отсутствует или не содержит запись для текущего агента, дополнить из `sync.data.agent`.

```typescript
async function refreshSessionSettings() {
  const sid = getActiveSessionID()
  if (!sid) return
  let settings = await loadSessionSettings(sid)
  // Seed from global agent configs if no per-session override exists
  if (!settings) settings = {} as SessionSettings
  let seeded = false
  const agentOverrides = settings.agent ?? {}
  for (const a of sync.data.agent) {
    if (!agentOverrides[a.name] && a.model) {
      agentOverrides[a.name] = {
        model: `${a.model.providerID}/${a.model.modelID}`,
        variant: a.variant,
      }
      seeded = true
    }
  }
  if (seeded) {
    settings.agent = agentOverrides
    await saveSessionSettings(sid, settings)
  }
  setSessionSettings(settings)
  // ... merge recent/favorite/variant/agentVariant
}
```

### 3.3 `saveAll()` — без изменений

Уже пишет agent только в сессию (через `saveSessionSettings`). Глобальный `model.json` хранит recent/favorite/variant — это ок, они глобальные.

---

## 4. Smoke Tests

### 4.1 Model change in session ≠ global

1. Открыть сессию
2. Сменить модель для build agent через TUI
3. Закрыть сессию, открыть другую (новую)
4. **Проверить:** в новой сессии модель = глобальный дефолт (не из первой сессии)

### 4.2 Model change without session = global default

1. Без активной сессии открыть настройки
2. Сменить модель для build agent
3. Создать новую сессию
4. **Проверить:** новая сессия использует новую глобальную модель

### 4.3 Session inherits global defaults

1. Установить глобально модель "A" для build agent
2. Создать новую сессию
3. **Проверить:** сессия использует модель "A"
4. Сменить в сессии на модель "B"
5. **Проверить:** глобальная осталась "A"
6. Создать ещё одну новую сессию
7. **Проверить:** новая сессия использует "A"

### 4.4 Persistence across restart

1. В сессии сменить модель
2. Перезапустить TUI, открыть ту же сессию
3. **Проверить:** модель сохранилась (из `sessions/{id}.jsonc`)

---

## 5. Prior Art

- `session-settings.ts` уже имеет `SessionAgentOverride` с `model` и `variant`
- `forAgent()` уже правильно читает сессию → глобал
- Нужно только поправить WRITE path
