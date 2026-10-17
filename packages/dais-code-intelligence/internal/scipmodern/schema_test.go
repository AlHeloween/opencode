package scipmodern

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"testing"

	"google.golang.org/protobuf/reflect/protoreflect"
	"google.golang.org/protobuf/reflect/protoregistry"
)

func TestPinnedDescriptorAndPrivateRegistry(t *testing.T) {
	data, err := os.ReadFile("SOURCE.json")
	if err != nil {
		t.Fatal(err)
	}
	var pins map[string]string
	if err := json.Unmarshal(data, &pins); err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(schema)
	if pins["schema.pb_sha256"] != hex.EncodeToString(sum[:]) || pins["module"] != "github.com/scip-code/scip/bindings/go/scip" || pins["version"] != "v0.7.1" {
		t.Fatalf("descriptor pins %+v", pins)
	}
	index, err := NewIndex()
	if err != nil {
		t.Fatal(err)
	}
	file := index.Descriptor().ParentFile()
	if file.Path() != "scip.proto" || file.Package() != "scip" {
		t.Fatalf("identity %s %s", file.Path(), file.Package())
	}
	if _, err := protoregistry.GlobalFiles.FindFileByPath("scip.proto"); err == nil {
		t.Fatal("modern schema leaked into global registry")
	}
	for name, expected := range map[string]int{"text": 5, "position_encoding": 6} {
		if int(file.Messages().ByName("Document").Fields().ByName(protoreflect.Name(name)).Number()) != expected {
			t.Fatalf("document field %s changed", name)
		}
	}
	if file.Messages().ByName("Occurrence").Fields().ByName("enclosing_range").Number() != 7 {
		t.Fatal("enclosing_range identity changed")
	}
}
