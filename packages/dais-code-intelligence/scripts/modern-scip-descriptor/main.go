package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	scip "github.com/scip-code/scip/bindings/go/scip"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/reflect/protodesc"
)

func main() {
	if err := generate(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func generate() error {
	if len(os.Args) != 3 {
		return fmt.Errorf("usage: descriptor output-directory pinned-module-directory")
	}
	out, upstream := os.Args[1], os.Args[2]
	data, err := proto.MarshalOptions{Deterministic: true}.Marshal(protodesc.ToFileDescriptorProto(scip.File_scip_proto))
	if err != nil {
		return err
	}
	pins := map[string]string{"module": "github.com/scip-code/scip/bindings/go/scip", "version": "v0.7.1"}
	for _, name := range []string{"scip.pb.go", "go.mod", "LICENSE"} {
		content, err := os.ReadFile(filepath.Join(upstream, name))
		if err != nil {
			return err
		}
		sum := sha256.Sum256(content)
		pins[name+"_sha256"] = hex.EncodeToString(sum[:])
		if name == "LICENSE" {
			if err := os.WriteFile(filepath.Join(out, name), content, 0600); err != nil {
				return err
			}
		}
	}
	sum := sha256.Sum256(data)
	pins["schema.pb_sha256"] = hex.EncodeToString(sum[:])
	pinJSON, err := json.MarshalIndent(pins, "", "  ")
	if err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(out, "schema.pb"), data, 0600); err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(out, "SOURCE.json"), append(pinJSON, '\n'), 0600)
}
