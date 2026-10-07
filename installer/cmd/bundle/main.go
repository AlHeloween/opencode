// Command bundle builds and checks the robot installer bundle (plan robot-installer B1).
//
//	bundle gate <dir>                 scan a staged tree for credentials; exit 1 on any hit that is not allowed
//	bundle manifest <dir> <out>       write the sha256 manifest of <dir> to <out>
//	bundle verify <dir> <manifest>    compare <dir> with a manifest; exit 1 on any difference
//	bundle build <components.json> <out>
//	                                  stage the components into <out> (empty or absent), run the gate with the
//	                                  file's allow list, write <out>/MANIFEST.sha256; exit 1 on a gate hit
package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	"smitinstaller/bundle"
)

// composition is components.json; paths in it are relative to the file itself.
type composition struct {
	Allow      []bundle.Allow
	Components []bundle.Component
}

func main() {
	args := os.Args[1:]
	switch {
	case len(args) == 3 && args[0] == "build":
		raw, err := os.ReadFile(args[1])
		check(err)
		var c composition
		check(json.Unmarshal(raw, &c))
		base := filepath.Dir(args[1])
		for i := range c.Components {
			if !filepath.IsAbs(c.Components[i].From) {
				c.Components[i].From = filepath.Join(base, c.Components[i].From)
			}
		}
		check(bundle.Stage(c.Components, args[2]))
		hits, err := bundle.Scan(args[2], c.Allow)
		for _, h := range hits {
			fmt.Println(h)
		}
		check(err)
		if bundle.Failed(hits) {
			fmt.Printf("build: gate FAILED with %d hit(s); no manifest written\n", len(hits))
			os.Exit(1)
		}
		m, err := bundle.BuildManifest(args[2])
		check(err)
		f, err := os.Create(filepath.Join(args[2], bundle.ManifestName))
		check(err)
		check(m.Write(f))
		check(f.Close())
		var total int64
		for _, e := range m.Entries {
			total += e.Size
		}
		fmt.Printf("build: gate PASS (%d allowed), %d file(s), %d byte(s) -> %s\n", len(hits), len(m.Entries), total, args[2])
	case len(args) == 2 && args[0] == "gate":
		hits, err := bundle.Scan(args[1], nil)
		for _, h := range hits {
			fmt.Println(h)
		}
		check(err)
		fmt.Printf("gate: %d hit(s)\n", len(hits))
		if bundle.Failed(hits) {
			os.Exit(1)
		}
	case len(args) == 3 && args[0] == "manifest":
		m, err := bundle.BuildManifest(args[1])
		check(err)
		f, err := os.Create(args[2])
		check(err)
		check(m.Write(f))
		check(f.Close())
		var total int64
		for _, e := range m.Entries {
			total += e.Size
		}
		fmt.Printf("manifest: %d file(s), %d byte(s) -> %s\n", len(m.Entries), total, args[2])
	case len(args) == 3 && args[0] == "verify":
		f, err := os.Open(args[2])
		check(err)
		m, err := bundle.ParseManifest(f)
		f.Close()
		check(err)
		diffs, err := m.Verify(args[1])
		for _, d := range diffs {
			fmt.Println(d)
		}
		check(err)
		fmt.Printf("verify: %d difference(s) against %d file(s)\n", len(diffs), len(m.Entries))
		if len(diffs) > 0 {
			os.Exit(1)
		}
	default:
		fmt.Fprintln(os.Stderr, "usage: bundle gate <dir> | manifest <dir> <out> | verify <dir> <manifest> | build <components.json> <out>")
		os.Exit(2)
	}
}

// check stops with exit 2 on an error the command could not get past: an instrument that failed has said nothing.
func check(err error) {
	if err != nil {
		fmt.Fprintln(os.Stderr, "bundle:", err)
		os.Exit(2)
	}
}
