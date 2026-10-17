package evidencegraph

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"path"
	"strings"
	"unicode"
	"unicode/utf8"

	wire "dais.local/codeintelligence/internal/scipwire"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/encoding/protowire"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/reflect/protoreflect"
)

func validPath(name string) bool {
	return name != "" && name != "." && !strings.ContainsAny(name, "\\\x00:") && !strings.HasPrefix(name, "/") && path.Clean(name) == name && name != ".." && !strings.HasPrefix(name, "../")
}

func decodeIndex(raw []byte) (*wire.Index, error) {
	remaining := raw
	first := true
	metadataCount := 0
	for len(remaining) > 0 {
		number, kind, n := protowire.ConsumeTag(remaining)
		if n < 0 {
			return nil, errors.New("invalid SCIP wire tag")
		}
		if first && number != 1 {
			return nil, errors.New("SCIP metadata must be first")
		}
		first = false
		if number == 1 {
			metadataCount++
		}
		size := protowire.ConsumeFieldValue(number, kind, remaining[n:])
		if size < 0 {
			return nil, errors.New("truncated SCIP wire field")
		}
		remaining = remaining[n+size:]
	}
	if metadataCount != 1 {
		return nil, errors.New("SCIP must contain exactly one metadata record")
	}
	index := new(wire.Index)
	if err := proto.Unmarshal(raw, index); err != nil {
		return nil, err
	}
	if err := validateMessage(index.ProtoReflect()); err != nil {
		return nil, err
	}
	if index.Metadata == nil || index.Metadata.ToolInfo == nil || index.Metadata.ToolInfo.Name == "" || index.Metadata.ToolInfo.Version == "" || index.Metadata.TextDocumentEncoding != wire.TextEncoding_UTF8 {
		return nil, errors.New("profile requires explicit indexer name/version and UTF8 encoding; UTF16 is unsupported")
	}
	root, err := url.Parse(index.Metadata.ProjectRoot)
	if err != nil || !root.IsAbs() || root.Scheme != "file" || root.Path == "" || !strings.HasPrefix(root.Path, "/") {
		return nil, errors.New("SCIP project_root must be an absolute file URI")
	}
	return index, nil
}

func validateMessage(message protoreflect.Message) error {
	if len(message.GetUnknown()) != 0 {
		return fmt.Errorf("unsupported unknown protobuf fields in %s", message.Descriptor().FullName())
	}
	var result error
	message.Range(func(field protoreflect.FieldDescriptor, value protoreflect.Value) bool {
		check := func(value protoreflect.Value) error {
			if field.Kind() == protoreflect.MessageKind {
				return validateMessage(value.Message())
			}
			if field.Kind() == protoreflect.EnumKind && field.Enum().Values().ByNumber(value.Enum()) == nil {
				return fmt.Errorf("unsupported enum value in %s", field.FullName())
			}
			return nil
		}
		if field.IsList() {
			list := value.List()
			for i := 0; i < list.Len(); i++ {
				if err := check(list.Get(i)); err != nil {
					result = err
					return false
				}
			}
			return true
		}
		result = check(value)
		return result == nil
	})
	return result
}

func (s *Store) project(raw []byte, snapshot Snapshot, bundle sourceBundle) ([]Fact, error) {
	if s.config.Profile == ProfileModernUTF8 {
		return s.projectModern(raw, snapshot, bundle)
	}
	index, err := decodeIndex(raw)
	if err != nil {
		return nil, err
	}
	facts := make([]Fact, 0)
	add := func(kind, subject, predicate, object, address, document, fileHash string, message proto.Message) error {
		if len(facts) >= s.config.MaxFacts {
			return errors.New("SCIP projection exceeds fact bound")
		}
		payload, err := (protojson.MarshalOptions{UseProtoNames: true}).Marshal(message)
		if err != nil {
			return err
		}
		var value any
		decoder := json.NewDecoder(bytes.NewReader(payload))
		decoder.UseNumber()
		if err := decoder.Decode(&value); err != nil {
			return err
		}
		payload, err = json.Marshal(value)
		if err != nil {
			return err
		}
		facts = append(facts, Fact{Kind: kind, Subject: subject, Predicate: predicate, Object: object, Origin: Origin{IndexSHA256: snapshot.IndexSHA256, Address: address, DocumentPath: document, FileHash: fileHash}, Payload: payload})
		return nil
	}
	if err := add("metadata", s.config.RepositoryID, "indexed_with", index.Metadata.ToolInfo.Name, "metadata", "", "", index.Metadata); err != nil {
		return nil, err
	}
	seen := map[string]bool{}
	for di, document := range index.Documents {
		name := document.RelativePath
		file, exists := bundle.files[name]
		if !validPath(name) || !exists || seen[name] || file.Permissions == "l" {
			return nil, fmt.Errorf("invalid, duplicate, symlink or unbound SCIP document %q", name)
		}
		seen[name] = true
		content := bundle.contents[name]
		if !utf8.Valid(content) {
			return nil, fmt.Errorf("document %q is not valid UTF8", name)
		}
		documentID := "document:" + canonicalHash([]string{s.config.RepositoryID, snapshot.Revision, name, file.Hash})
		prefix := fmt.Sprintf("documents[%d]", di)
		for si, info := range document.Symbols {
			symbol, err := s.symbolKey(snapshot.IndexSHA256, name, info.Symbol)
			if err != nil {
				return nil, err
			}
			address := fmt.Sprintf("%s.symbols[%d]", prefix, si)
			if err := add("symbol", symbol, "described_by", documentID, address, name, file.Hash, info); err != nil {
				return nil, err
			}
			for ri, relationship := range info.Relationships {
				target, err := s.symbolKey(snapshot.IndexSHA256, name, relationship.Symbol)
				if err != nil {
					return nil, err
				}
				if err := add("relationship", symbol, "scip_relationship", target, fmt.Sprintf("%s.relationships[%d]", address, ri), name, file.Hash, relationship); err != nil {
					return nil, err
				}
			}
		}
		for oi, occurrence := range document.Occurrences {
			if occurrence.SymbolRoles < 0 || occurrence.SymbolRoles&^int32(63) != 0 {
				return nil, errors.New("unsupported SCIP symbol role bits")
			}
			if err := validateRange(content, occurrence.Range); err != nil {
				return nil, fmt.Errorf("%s.occurrences[%d]: %w", prefix, oi, err)
			}
			symbol := ""
			if occurrence.Symbol != "" {
				symbol, err = s.symbolKey(snapshot.IndexSHA256, name, occurrence.Symbol)
				if err != nil {
					return nil, err
				}
			}
			if err := add("occurrence", documentID, "occurs_at", symbol, fmt.Sprintf("%s.occurrences[%d]", prefix, oi), name, file.Hash, occurrence); err != nil {
				return nil, err
			}
		}
		for fi, fold := range document.Folds {
			if err := validateRange(content, fold.Range); err != nil {
				return nil, err
			}
			if err := add("fold", documentID, "folds_at", "", fmt.Sprintf("%s.folds[%d]", prefix, fi), name, file.Hash, fold); err != nil {
				return nil, err
			}
		}
	}
	for ei, info := range index.ExternalSymbols {
		symbol, err := s.symbolKey(snapshot.IndexSHA256, "", info.Symbol)
		if err != nil {
			return nil, err
		}
		address := fmt.Sprintf("external_symbols[%d]", ei)
		if err := add("external_symbol", symbol, "described_externally", "", address, "", "", info); err != nil {
			return nil, err
		}
		for ri, relationship := range info.Relationships {
			target, err := s.symbolKey(snapshot.IndexSHA256, "", relationship.Symbol)
			if err != nil {
				return nil, err
			}
			if err := add("relationship", symbol, "scip_relationship", target, fmt.Sprintf("%s.relationships[%d]", address, ri), "", "", relationship); err != nil {
				return nil, err
			}
		}
	}
	return facts, nil
}

func (s *Store) symbolKey(indexHash, document, symbol string) (string, error) {
	if symbol == "" || !utf8.ValidString(symbol) || strings.IndexFunc(symbol, unicode.IsControl) >= 0 {
		return "", errors.New("invalid empty or control-containing SCIP symbol")
	}
	if strings.HasPrefix(symbol, "local ") {
		id := strings.TrimPrefix(symbol, "local ")
		if document == "" || id == "" || strings.IndexFunc(id, unicode.IsSpace) >= 0 {
			return "", errors.New("local SCIP symbol requires document scope and nonempty id")
		}
		return "local:" + canonicalHash([]string{s.config.RepositoryID, indexHash, document, symbol}), nil
	}
	// Preserve the complete global spelling, including escaped package headers
	// and descriptors. This profile validates the header framing, not semantics.
	remaining := symbol
	for token := 0; token < 4; token++ {
		found := false
		length := 0
		for i := 0; i < len(remaining); i++ {
			if remaining[i] != ' ' {
				length++
				continue
			}
			if i+1 < len(remaining) && remaining[i+1] == ' ' {
				length++
				i++
				continue
			}
			if length == 0 {
				return "", errors.New("empty SCIP global symbol header token")
			}
			remaining = remaining[i+1:]
			found = true
			break
		}
		if !found {
			return "", errors.New("SCIP global symbol requires scheme/package/descriptors")
		}
	}
	if remaining == "" || !strings.ContainsRune("/#.:!)]", rune(remaining[len(remaining)-1])) {
		return "", errors.New("unsupported SCIP descriptor framing")
	}
	return "global:" + canonicalHash([]string{s.config.RepositoryID, symbol}), nil
}

func validateRange(content []byte, encoded []int32) error {
	if len(encoded) != 3 && len(encoded) != 4 {
		return errors.New("SCIP range requires three or four coordinates")
	}
	startLine, startColumn := encoded[0], encoded[1]
	endLine, endColumn := startLine, encoded[2]
	if len(encoded) == 4 {
		endLine, endColumn = encoded[2], encoded[3]
	}
	if startLine < 0 || startColumn < 0 || endLine < startLine || endColumn < 0 || (startLine == endLine && endColumn < startColumn) {
		return errors.New("negative or reversed SCIP range")
	}
	lines := strings.Split(string(content), "\n")
	if int64(endLine) >= int64(len(lines)) {
		return errors.New("SCIP line outside document")
	}
	for _, position := range [][2]int32{{startLine, startColumn}, {endLine, endColumn}} {
		line := strings.TrimSuffix(lines[position[0]], "\r")
		column := int64(position[1])
		if column > int64(len(line)) {
			return errors.New("SCIP column outside document")
		}
		if column < int64(len(line)) && !utf8.RuneStart(line[column]) {
			return errors.New("SCIP UTF8 position splits code point")
		}
	}
	return nil
}
