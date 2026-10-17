package capture

import "syscall"

func publishDirectory(from, to string) error {
	old, err := syscall.UTF16PtrFromString(from)
	if err != nil {
		return err
	}
	next, err := syscall.UTF16PtrFromString(to)
	if err != nil {
		return err
	}
	return syscall.MoveFile(old, next)
}
