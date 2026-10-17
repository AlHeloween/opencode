//go:build !windows

package capture

import "errors"

func publishDirectory(from, to string) error {
	return errors.New("capture directory publication requires native Windows")
}
