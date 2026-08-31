import { DialogSelect } from "@tui/ui/dialog-select"

/**
 * Generic yes/no confirmation dialog (2026-08-31).
 *
 * Used before destructive or cross-project writes — currently the GLOBAL
 * config scope (policy, Alexander: saving to global requires explicit
 * confirmation). No hardcoded paths in copy: the real config location is
 * Global.Path.config (executable-adjacent in this fork, NOT ~/.config).
 */
export function DialogConfirm(props: {
  title: string
  description?: string
  confirm?: string
  onConfirm: () => void
  onCancel?: () => void
}) {
  return (
    <DialogSelect
      title={props.title}
      options={[
        {
          title: props.confirm ?? "Yes, write to global config",
          value: "confirm",
          description: props.description,
          onSelect: () => props.onConfirm(),
        },
        {
          title: "No",
          value: "cancel",
          onSelect: () => props.onCancel?.(),
        },
      ]}
      flat={true}
    />
  )
}
