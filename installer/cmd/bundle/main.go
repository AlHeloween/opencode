// Command bundle builds and checks the robot installer bundle (plan robot-installer B1).
//
//	bundle gate <dir>   scan a staged tree for credentials; exit 1 on any hit that is not allowed
package main

import (
	"fmt"
	"os"

	"smitinstaller/bundle"
)

func main() {
	if len(os.Args) != 3 || os.Args[1] != "gate" {
		fmt.Fprintln(os.Stderr, "usage: bundle gate <dir>")
		os.Exit(2)
	}
	hits, err := bundle.Scan(os.Args[2], nil)
	for _, h := range hits {
		fmt.Println(h)
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "gate: scan failed:", err)
		os.Exit(2)
	}
	fmt.Printf("gate: %d hit(s)\n", len(hits))
	if bundle.Failed(hits) {
		os.Exit(1)
	}
}
