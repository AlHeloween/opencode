package evidencegraph

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"dais.local/codeintelligence/internal/fossil"
	"dais.local/codeintelligence/internal/scipmodern"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/encoding/protowire"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/reflect/protoreflect"
)

func TestModernProfileOpen(t *testing.T) {
	f := newGraphFixture(t)
	s, err := Open(Config{Provider: f.provider(), MetadataPath: filepath.Join(t.TempDir(), "metadata.sqlite"), RepositoryID: "modern-fixture", Profile: "dais-scip-modern-utf8-v1", MaxIndexBytes: 1 << 20, MaxManifestBytes: 1 << 20, MaxSourceBytes: 1 << 20, MaxFacts: 1000})
	if err != nil {
		t.Fatal(err)
	}
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
}

func TestModernOfficialUnspecifiedPositionsRefused(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("testdata", "modern", "official-unspecified.scip"))
	if err != nil {
		t.Fatal(err)
	}
	index, err := decodeModernIndex(raw)
	if err != nil {
		t.Fatal(err)
	}
	bundle := sourceBundle{files: map[string]fossil.File{}, contents: map[string][]byte{}}
	for _, name := range []string{"go.mod", "math.go", "use.go"} {
		content, err := os.ReadFile(filepath.Join("testdata", "modern", name))
		if err != nil {
			t.Fatal(err)
		}
		bundle.files[name] = fossil.File{Hash: digestTest(content)}
		bundle.contents[name] = content
	}
	if modernField(modernDocument(index), "position_encoding").Enum() != 0 {
		t.Fatal("official fixture no longer demonstrates unspecified positions")
	}
	store := &Store{config: Config{RepositoryID: "fixture", Profile: ProfileModernUTF8, MaxFacts: 1000}}
	if _, err := store.project(raw, Snapshot{}, bundle); err == nil || !strings.Contains(err.Error(), "requires explicit UTF8 position_encoding") {
		t.Fatalf("unspecified producer was not refused: %v", err)
	}
}

func modernBundle(t *testing.T, f *graphFixture, raw []byte) {
	t.Helper()
	manifest := Manifest{Version: 1, IndexSHA256: digestTest(raw)}
	for path, data := range f.sources {
		f.put(path, data)
		manifest.Inputs = append(manifest.Inputs, Input{Path: path, SHA256: digestTest(data)})
	}
	f.put("index.scip", raw)
	data, err := json.Marshal(manifest)
	if err != nil {
		t.Fatal(err)
	}
	f.put("manifest.json", data)
}

func TestModernNativeProducerRoundTrip(t *testing.T) {
	f := newGraphFixture(t)
	f.sources = map[string][]byte{}
	for _, path := range []string{"go.mod", "math.go", "use.go"} {
		data, err := os.ReadFile(filepath.Join("testdata", "modern", path))
		if err != nil {
			t.Fatal(err)
		}
		f.sources[path] = data
	}
	raw, err := os.ReadFile(filepath.Join("testdata", "modern", "native.scip"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := decodeIndex(raw); err == nil {
		t.Fatal("real modern fixture unexpectedly accepted by legacy decoder")
	}
	modernBundle(t, f, raw)
	a := f.commit("modern A sv:33333333333333333333333333333333")
	store, err := Open(Config{Provider: f.provider(), MetadataPath: filepath.Join(t.TempDir(), "metadata.sqlite"), RepositoryID: "modern-fixture", Profile: ProfileModernUTF8, MaxIndexBytes: 1 << 20, MaxManifestBytes: 1 << 20, MaxSourceBytes: 1 << 20, MaxFacts: 1000})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := store.Close(); err != nil {
			t.Error(err)
		}
	})
	ctx := context.Background()
	snapshot, err := store.Import(ctx, a, "index.scip", "manifest.json")
	if err != nil {
		t.Fatal(err)
	}
	if snapshot.Profile != ProfileModernUTF8 || snapshot.SVRef != "33333333333333333333333333333333" {
		t.Fatalf("provenance %+v", snapshot)
	}
	repeat, err := store.Import(ctx, a, "index.scip", "manifest.json")
	if err != nil || repeat.ID != snapshot.ID {
		t.Fatalf("idempotence %+v %v", repeat, err)
	}
	index, err := decodeModernIndex(raw)
	if err != nil {
		t.Fatal(err)
	}
	page, err := store.Facts(ctx, snapshot.ID, 1000)
	if err != nil {
		t.Fatal(err)
	}
	documents, occurrences, enclosing := 0, 0, 0
	for _, fact := range page.Facts {
		if fact.Kind == "document" {
			documents++
		}
		if fact.Kind == "occurrence" {
			occurrences++
			if strings.Contains(string(fact.Payload), "enclosing_range") {
				enclosing++
			}
		}
		if fact.Origin.IndexSHA256 != digestTest(raw) {
			t.Fatal("raw index stamp lost")
		}
	}
	if documents != modernField(index, "documents").List().Len() || occurrences == 0 || enclosing == 0 {
		t.Fatalf("incomplete projection docs=%d occurrences=%d enclosing=%d", documents, occurrences, enclosing)
	}
	exported, err := store.ExportSCIP(ctx, snapshot.ID)
	if err != nil || !bytes.Equal(exported, raw) {
		t.Fatalf("raw identity %v", err)
	}
	receipt, err := store.Verify(ctx, snapshot.ID, a)
	if err != nil || receipt.Result != "PASS" || receipt.SemanticStatus != "unknown" {
		t.Fatalf("receipt %+v %v", receipt, err)
	}
	wrongConfig := store.config
	wrongConfig.Profile = ProfileUTF8
	wrong, err := Open(wrongConfig)
	if err != nil {
		t.Fatal(err)
	}
	wrongReceipt, wrongErr := wrong.Verify(ctx, snapshot.ID, a)
	if closeErr := wrong.Close(); closeErr != nil {
		t.Fatal(closeErr)
	}
	if wrongErr == nil || !strings.Contains(wrongErr.Error(), "does not match configured profile") || wrongReceipt.Result != "" {
		t.Fatalf("wrong profile produced a verdict %+v %v", wrongReceipt, wrongErr)
	}
	b := f.commit("modern no-op sv:44444444444444444444444444444444")
	newer, err := store.Import(ctx, b, "index.scip", "manifest.json")
	if err != nil || newer.ID == snapshot.ID {
		t.Fatalf("history %+v %v", newer, err)
	}
	historical, err := store.ExportSCIP(ctx, snapshot.ID)
	if err != nil || !bytes.Equal(historical, raw) {
		t.Fatalf("historical identity %v", err)
	}
	bad := append(append([]byte{}, raw...), protowire.AppendVarint(protowire.AppendTag(nil, 99, protowire.VarintType), 1)...)
	modernBundle(t, f, bad)
	c := f.commit("modern unknown index field")
	if _, err := store.Import(ctx, c, "index.scip", "manifest.json"); err == nil {
		t.Fatal("unknown field accepted")
	}
	current, err := store.Current(ctx)
	if err != nil || current.ID != newer.ID {
		t.Fatalf("failed import altered current %+v %v", current, err)
	}
}

func syntheticModern(t *testing.T) protoreflect.Message {
	t.Helper()
	index, err := scipmodern.NewIndex()
	if err != nil {
		t.Fatal(err)
	}
	data := `{"metadata":{"tool_info":{"name":"modern-fixture","version":"1","arguments":["--utf8"]},"project_root":"file:///fixture","text_document_encoding":"UTF8"},"documents":[{"relative_path":"a.go","language":"go","text":"😀 alpha\n","position_encoding":"UTF8CodeUnitOffsetFromLineStart","symbols":[{"symbol":"local 0","documentation":["doc"],"kind":"Function","display_name":"alpha","enclosing_symbol":"scip-go gomod example.org/pkg v1 Owner#","signature_documentation":{"language":"go","text":"func alpha()"},"relationships":[{"symbol":"scip-go gomod example.org/pkg v2 beta().","is_reference":true,"is_implementation":true,"is_type_definition":true,"is_definition":true}]}],"occurrences":[{"range":[0,5,10],"symbol":"local 0","symbol_roles":65,"override_documentation":["override"],"enclosing_range":[0,0,10],"diagnostics":[{"severity":"Warning","code":"sample","message":"notice","source":"fixture","tags":["Deprecated"]}]},{"range":[0,0,4],"symbol":"local 0"}]}]}`
	if err := protojson.Unmarshal([]byte(data), index); err != nil {
		t.Fatal(err)
	}
	return index
}

func TestModernFieldsRangesAndRefusals(t *testing.T) {
	content := []byte("😀 alpha\n")
	bundle := sourceBundle{files: map[string]fossil.File{"a.go": {Hash: strings.Repeat("a", 40)}}, contents: map[string][]byte{"a.go": content}}
	store := &Store{config: Config{RepositoryID: "synthetic", Profile: ProfileModernUTF8, MaxFacts: 100}}
	snapshot := Snapshot{Revision: "revision", IndexSHA256: strings.Repeat("b", 64)}
	encode := func(index protoreflect.Message) []byte {
		t.Helper()
		raw, err := (proto.MarshalOptions{Deterministic: true}).Marshal(index.Interface())
		if err != nil {
			t.Fatal(err)
		}
		return raw
	}
	facts, err := store.project(encode(syntheticModern(t)), snapshot, bundle)
	if err != nil {
		t.Fatal(err)
	}
	var payload strings.Builder
	for _, fact := range facts {
		payload.Write(fact.Payload)
	}
	for _, field := range []string{"position_encoding", "text", "kind", "display_name", "enclosing_symbol", "signature_documentation", "is_definition", "enclosing_range", "override_documentation", "diagnostics", "65"} {
		if !strings.Contains(payload.String(), field) {
			t.Fatalf("field lost %s: %s", field, payload.String())
		}
	}
	cases := []struct {
		name, diagnostic string
		mutate           func(protoreflect.Message)
	}{
		{"unknown-index", "unknown protobuf", func(m protoreflect.Message) {
			m.SetUnknown(protowire.AppendVarint(protowire.AppendTag(nil, 99, protowire.VarintType), 1))
		}},
		{"unknown-occurrence", "unknown protobuf", func(m protoreflect.Message) {
			modernOccurrence(m).SetUnknown(protowire.AppendVarint(protowire.AppendTag(nil, 99, protowire.VarintType), 1))
		}},
		{"unknown-enum", "unsupported enum", func(m protoreflect.Message) {
			d := modernDocument(m)
			d.Set(d.Descriptor().Fields().ByName("position_encoding"), protoreflect.ValueOfEnum(99))
		}},
		{"utf16", "position_encoding", func(m protoreflect.Message) {
			d := modernDocument(m)
			d.Set(d.Descriptor().Fields().ByName("position_encoding"), protoreflect.ValueOfEnum(2))
		}},
		{"utf32", "position_encoding", func(m protoreflect.Message) {
			d := modernDocument(m)
			d.Set(d.Descriptor().Fields().ByName("position_encoding"), protoreflect.ValueOfEnum(3))
		}},
		{"unspecified", "position_encoding", func(m protoreflect.Message) {
			d := modernDocument(m)
			d.Clear(d.Descriptor().Fields().ByName("position_encoding"))
		}},
		{"different-text", "text differs", func(m protoreflect.Message) {
			d := modernDocument(m)
			d.Set(d.Descriptor().Fields().ByName("text"), protoreflect.ValueOfString("different"))
		}},
		{"split-codepoint", "splits code point", func(m protoreflect.Message) {
			modernField(modernOccurrence(m), "range").List().Set(1, protoreflect.ValueOfInt32(1))
		}},
		{"enclosing-outside", "enclosing_range", func(m protoreflect.Message) {
			modernField(modernOccurrence(m), "enclosing_range").List().Set(2, protoreflect.ValueOfInt32(99))
		}},
		{"enclosing-does-not-contain", "does not enclose", func(m protoreflect.Message) {
			modernField(modernOccurrence(m), "enclosing_range").List().Set(1, protoreflect.ValueOfInt32(6))
		}},
		{"unknown-role", "symbol role", func(m protoreflect.Message) {
			o := modernOccurrence(m)
			o.Set(o.Descriptor().Fields().ByName("symbol_roles"), protoreflect.ValueOfInt32(128))
		}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			index := syntheticModern(t)
			tc.mutate(index)
			if _, err := store.project(encode(index), snapshot, bundle); err == nil || !strings.Contains(err.Error(), tc.diagnostic) {
				t.Fatalf("wanted %s, got %v", tc.diagnostic, err)
			}
		})
	}
	raw := encode(syntheticModern(t))
	metadata := modernField(syntheticModern(t), "metadata").Message()
	metaRaw, err := proto.Marshal(metadata.Interface())
	if err != nil {
		t.Fatal(err)
	}
	duplicate := append(append([]byte{}, raw...), protowire.AppendBytes(protowire.AppendTag(nil, 1, protowire.BytesType), metaRaw)...)
	if _, err := store.project(duplicate, snapshot, bundle); err == nil || !strings.Contains(err.Error(), "exactly one") {
		t.Fatalf("duplicate metadata: %v", err)
	}
	if _, err := store.project(append(protowire.AppendBytes(protowire.AppendTag(nil, 2, protowire.BytesType), nil), raw...), snapshot, bundle); err == nil || !strings.Contains(err.Error(), "metadata must be first") {
		t.Fatalf("metadata order: %v", err)
	}
}

func modernDocument(index protoreflect.Message) protoreflect.Message {
	return modernField(index, "documents").List().Get(0).Message()
}
func modernOccurrence(index protoreflect.Message) protoreflect.Message {
	return modernField(modernDocument(index), "occurrences").List().Get(0).Message()
}

func TestModernWindowsProjectRootDialect(t *testing.T) {
	for _, value := range []string{"file:///fixture", "file:///D:/source", "file://D:%5Csource%5C%D0%BA%D0%BE%D0%B4"} {
		if !validModernProjectRoot(value) {
			t.Fatalf("absolute root refused %q", value)
		}
	}
	for _, value := range []string{"D:/source", "file://D:relative", "file://D:%00source", "file://D:%5C%ff", "file://D:%GGsource", "https://example.test/source"} {
		if validModernProjectRoot(value) {
			t.Fatalf("invalid root accepted %q", value)
		}
	}
}
