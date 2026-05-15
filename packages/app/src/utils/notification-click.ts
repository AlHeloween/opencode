import * as Log from "@opencode-ai/core/util/log"

let nav: ((href: string) => void) | undefined

export const setNavigate = (fn: (href: string) => void) => {
  nav = fn
}

export const handleNotificationClick = (href?: string) => {
  window.focus()
  if (!href) return
  if (nav) return nav(href)
  Log.Default.debug("notification-click: navigate not set")
  window.location.assign(href)
}
