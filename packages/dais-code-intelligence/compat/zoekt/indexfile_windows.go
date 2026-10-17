// Copyright 2016 Google Inc. All rights reserved.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//    http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//
// Windows portability implementation of the Zoekt IndexFile contract.

//go:build windows

package index

import (
	"fmt"
	"log"
	"math"
	"os"
	"unsafe"

	"golang.org/x/sys/windows"
)

type windowsIndexFile struct {
	name string
	size uint32
	addr uintptr
	data []byte
}

func (f *windowsIndexFile) Read(off, size uint32) ([]byte, error) {
	if off > f.size || size > f.size-off {
		return nil, fmt.Errorf("out of bounds: offset %d, size %d, len %d, name %s", off, size, f.size, f.name)
	}
	if f.data == nil && f.size != 0 {
		return nil, fmt.Errorf("index file is closed: %s", f.name)
	}
	return f.data[off : off+size], nil
}

func (f *windowsIndexFile) Name() string          { return f.name }
func (f *windowsIndexFile) Size() (uint32, error) { return f.size, nil }

func (f *windowsIndexFile) Close() {
	if f.addr == 0 {
		return
	}
	if err := windows.UnmapViewOfFile(f.addr); err != nil {
		log.Printf("WARN failed to unmap %s: %v", f.name, err)
		return
	}
	f.addr = 0
	f.data = nil
}

// NewIndexFile takes ownership of f, matching the Unix implementation.
func NewIndexFile(f *os.File) (IndexFile, error) {
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		return nil, err
	}
	if info.Size() < 0 || info.Size() >= math.MaxUint32 {
		return nil, fmt.Errorf("file %s too large: %d", f.Name(), info.Size())
	}
	result := &windowsIndexFile{name: f.Name(), size: uint32(info.Size())}
	if result.size == 0 {
		return result, nil
	}
	mapping, err := windows.CreateFileMapping(windows.Handle(f.Fd()), nil, windows.PAGE_READONLY, 0, 0, nil)
	if err != nil {
		return nil, err
	}
	defer func() {
		if err := windows.CloseHandle(mapping); err != nil {
			log.Printf("WARN failed to close mapping handle %s: %v", f.Name(), err)
		}
	}()
	result.addr, err = windows.MapViewOfFile(mapping, windows.FILE_MAP_READ, 0, 0, uintptr(result.size))
	if err != nil {
		return nil, err
	}
	result.data = unsafe.Slice((*byte)(unsafe.Pointer(result.addr)), int(result.size))
	return result, nil
}
