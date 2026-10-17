package evidencegraph

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"strings"
	"unicode"
	"unicode/utf8"

	"dais.local/codeintelligence/internal/scipmodern"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/encoding/protowire"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/reflect/protoreflect"
)

func modernField(message protoreflect.Message, name protoreflect.Name) protoreflect.Value {
	return message.Get(message.Descriptor().Fields().ByName(name))
}

func modernRange(message protoreflect.Message, name protoreflect.Name) []int32 {
	values := modernField(message, name).List()
	result := make([]int32, values.Len())
	for i := range result {
		result[i] = int32(values.Get(i).Int())
	}
	return result
}

func modernRangeBounds(encoded []int32) [4]int32 {
	if len(encoded) == 3 {
		return [4]int32{encoded[0], encoded[1], encoded[0], encoded[2]}
	}
	return [4]int32{encoded[0], encoded[1], encoded[2], encoded[3]}
}

func validModernProjectRoot(value string) bool {
	if root, err := url.Parse(value); err == nil && root.IsAbs() && root.Scheme == "file" && strings.HasPrefix(root.Path, "/") && utf8.ValidString(root.Path) && strings.IndexFunc(root.Path, unicode.IsControl) < 0 {
		return true
	}
	// scip-go v0.2.7 on Windows emits file://D:%5Cpath. Retain that
	// spelling as metadata; it is never used to resolve source files.
	if !strings.HasPrefix(value, "file://") {
		return false
	}
	path, err := url.PathUnescape(strings.TrimPrefix(value, "file://"))
	return err == nil && utf8.ValidString(path) && len(path) >= 3 && ((path[0] >= 'A' && path[0] <= 'Z') || (path[0] >= 'a' && path[0] <= 'z')) && path[1] == ':' && (path[2] == '\\' || path[2] == '/') && strings.IndexFunc(path, unicode.IsControl) < 0
}

func decodeModernIndex(raw []byte) (protoreflect.Message, error) {
	remaining, metadataCount := raw, 0
	for len(remaining) > 0 {
		number, kind, n := protowire.ConsumeTag(remaining)
		if n < 0 {
			return nil, errors.New("invalid SCIP wire tag")
		}
		if len(remaining) == len(raw) && number != 1 {
			return nil, errors.New("SCIP metadata must be first")
		}
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
	index, err := scipmodern.NewIndex()
	if err != nil {
		return nil, err
	}
	if err := proto.Unmarshal(raw, index); err != nil {
		return nil, err
	}
	if err := validateMessage(index); err != nil {
		return nil, err
	}
	metadata := modernField(index, "metadata").Message()
	tool := modernField(metadata, "tool_info").Message()
	if modernField(tool, "name").String() == "" || modernField(tool, "version").String() == "" || modernField(metadata, "text_document_encoding").Enum() != 1 {
		return nil, errors.New("modern profile requires explicit indexer name/version and UTF8 text encoding")
	}
	if !validModernProjectRoot(modernField(metadata, "project_root").String()) {
		return nil, errors.New("SCIP project_root must be an absolute file URI")
	}
	return index, nil
}

func (s *Store) projectModern(raw []byte, snapshot Snapshot, bundle sourceBundle) ([]Fact, error) {
	index, err := decodeModernIndex(raw)
	if err != nil {
		return nil, err
	}
	facts := make([]Fact, 0)
	var roleMask int64
	roleValues := index.Descriptor().ParentFile().Enums().ByName("SymbolRole").Values()
	for i := 0; i < roleValues.Len(); i++ {
		roleMask |= int64(roleValues.Get(i).Number())
	}
	add := func(kind, subject, predicate, object, address, document, fileHash string, message protoreflect.Message) error {
		if len(facts) >= s.config.MaxFacts {
			return errors.New("SCIP projection exceeds fact bound")
		}
		payload, err := (protojson.MarshalOptions{UseProtoNames: true}).Marshal(message.Interface())
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
	metadata := modernField(index, "metadata").Message()
	if err := add("metadata", s.config.RepositoryID, "indexed_with", modernField(modernField(metadata, "tool_info").Message(), "name").String(), "metadata", "", "", metadata); err != nil {
		return nil, err
	}
	addSymbol := func(info protoreflect.Message, document, fileHash, documentID, address string, external bool) error {
		symbol, err := s.symbolKey(snapshot.IndexSHA256, document, modernField(info, "symbol").String())
		if err != nil {
			return err
		}
		kind, predicate := "symbol", "described_by"
		if external {
			kind, predicate = "external_symbol", "described_externally"
		}
		if err := add(kind, symbol, predicate, documentID, address, document, fileHash, info); err != nil {
			return err
		}
		relations := modernField(info, "relationships").List()
		for i := 0; i < relations.Len(); i++ {
			relation := relations.Get(i).Message()
			target, err := s.symbolKey(snapshot.IndexSHA256, document, modernField(relation, "symbol").String())
			if err != nil {
				return err
			}
			if err := add("relationship", symbol, "scip_relationship", target, fmt.Sprintf("%s.relationships[%d]", address, i), document, fileHash, relation); err != nil {
				return err
			}
		}
		return nil
	}
	seen := map[string]bool{}
	documents := modernField(index, "documents").List()
	for di := 0; di < documents.Len(); di++ {
		document := documents.Get(di).Message()
		name := modernField(document, "relative_path").String()
		file, exists := bundle.files[name]
		if !validPath(name) || !exists || seen[name] || file.Permissions == "l" {
			return nil, fmt.Errorf("invalid, duplicate, symlink or unbound SCIP document %q", name)
		}
		seen[name] = true
		content := bundle.contents[name]
		if !utf8.Valid(content) {
			return nil, fmt.Errorf("document %q is not valid UTF8", name)
		}
		if modernField(document, "position_encoding").Enum() != 1 {
			return nil, fmt.Errorf("document %q requires explicit UTF8 position_encoding; unspecified, UTF16 and UTF32 are unsupported", name)
		}
		if text := modernField(document, "text").String(); text != "" && text != string(content) {
			return nil, fmt.Errorf("document %q text differs from pinned source", name)
		}
		documentID := "document:" + canonicalHash([]string{s.config.RepositoryID, snapshot.Revision, name, file.Hash})
		prefix := fmt.Sprintf("documents[%d]", di)
		// Keep every document field without duplicating the symbol/occurrence lists.
		header := proto.Clone(document.Interface()).ProtoReflect()
		header.Clear(header.Descriptor().Fields().ByName("symbols"))
		header.Clear(header.Descriptor().Fields().ByName("occurrences"))
		if err := add("document", documentID, "document_metadata", "", prefix, name, file.Hash, header); err != nil {
			return nil, err
		}
		symbols := modernField(document, "symbols").List()
		for si := 0; si < symbols.Len(); si++ {
			if err := addSymbol(symbols.Get(si).Message(), name, file.Hash, documentID, fmt.Sprintf("%s.symbols[%d]", prefix, si), false); err != nil {
				return nil, err
			}
		}
		occurrences := modernField(document, "occurrences").List()
		for oi := 0; oi < occurrences.Len(); oi++ {
			occurrence := occurrences.Get(oi).Message()
			roles := modernField(occurrence, "symbol_roles").Int()
			if roles < 0 || roles & ^roleMask != 0 {
				return nil, errors.New("unsupported modern SCIP symbol role bits")
			}
			address := fmt.Sprintf("%s.occurrences[%d]", prefix, oi)
			if err := validateRange(content, modernRange(occurrence, "range")); err != nil {
				return nil, fmt.Errorf("%s.range: %w", address, err)
			}
			if enclosing := modernRange(occurrence, "enclosing_range"); len(enclosing) != 0 {
				if err := validateRange(content, enclosing); err != nil {
					return nil, fmt.Errorf("%s.enclosing_range: %w", address, err)
				}
				outer, inner := modernRangeBounds(enclosing), modernRangeBounds(modernRange(occurrence, "range"))
				if outer[0] > inner[0] || (outer[0] == inner[0] && outer[1] > inner[1]) || outer[2] < inner[2] || (outer[2] == inner[2] && outer[3] < inner[3]) {
					return nil, fmt.Errorf("%s.enclosing_range does not enclose occurrence range", address)
				}
			}
			symbol := ""
			if spelling := modernField(occurrence, "symbol").String(); spelling != "" {
				symbol, err = s.symbolKey(snapshot.IndexSHA256, name, spelling)
				if err != nil {
					return nil, err
				}
			}
			if err := add("occurrence", documentID, "occurs_at", symbol, address, name, file.Hash, occurrence); err != nil {
				return nil, err
			}
		}
	}
	external := modernField(index, "external_symbols").List()
	for i := 0; i < external.Len(); i++ {
		if err := addSymbol(external.Get(i).Message(), "", "", "", fmt.Sprintf("external_symbols[%d]", i), true); err != nil {
			return nil, err
		}
	}
	return facts, nil
}
