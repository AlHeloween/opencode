package bundle

import (
	"bytes"
	"context"
	"fmt"
	"os/exec"
	"strings"
	"syscall"
	"time"
)

// StoreKey hands a user's API key to the installed robot (plan robot-installer B4). The robot stays the one writer of
// its credential store: `providers login -p <provider> --key-stdin` writes auth.json.enc under the robot's own
// per-install key (packages/opencode/src/cli/cmd/providers.ts storeApiKey). The key goes through stdin, never argv —
// a process list shows argv. env is the robot's environment (nil = inherit). The returned error carries the robot's
// own message, which names the provider and never the key.
func StoreKey(robotExe, provider, key string, env []string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, robotExe, "providers", "login", "-p", provider, "--key-stdin")
	cmd.Env = env
	cmd.Stdin = strings.NewReader(key)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000} // CREATE_NO_WINDOW
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		msg := strings.TrimSpace(stderr.String())
		if i := strings.Index(msg, "\n"); i > 0 {
			msg = msg[:i] // the robot's own line; its «Bugs encountered» summary, if any, follows
		}
		return fmt.Errorf("store key for %s: %v: %s", provider, err, msg)
	}
	return nil
}
