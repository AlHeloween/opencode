package capture

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"regexp"
	"sort"
	"strings"
	"unicode/utf8"

	"dais.local/codeintelligence/internal/fossil"
)

var revisionDigest = regexp.MustCompile(`^(?:[0-9a-f]{40}|[0-9a-f]{64})$`)

func outputPaths(c Config) []string {
	paths := []string{c.IndexPath, c.ManifestPath, c.ReceiptPath}
	sort.Strings(paths)
	return paths
}

func replacePrevious(ctx context.Context, c Config, current []fossil.File) ([]fossil.File, *PreviousBundle, error) {
	prior, err := c.Provider.ListFiles(ctx, c.PreviousBundleRevision)
	if err != nil {
		return nil, nil, fmt.Errorf("previous bundle revision: %w", err)
	}
	if len(prior) > 3 && len(prior)-3 > c.MaxFiles {
		return nil, nil, errors.New("previous revision file count exceeds capture bound")
	}
	paths := outputPaths(c)
	find := func(files []fossil.File, name string) (fossil.File, error) {
		var found fossil.File
		for _, file := range files {
			if file.Path == name {
				if found.Path != "" {
					return found, errors.New("duplicate bundle artifact path")
				}
				found = file
				continue
			}
			if overlaps(file.Path, name) {
				return found, fmt.Errorf("bundle artifact path collision: %s", file.Path)
			}
		}
		if found.Path == "" || (found.Permissions != "" && found.Permissions != "x") {
			return found, fmt.Errorf("regular exact bundle artifact required: %s", name)
		}
		return found, nil
	}
	data := make(map[string][]byte, 3)
	binding := &PreviousBundle{Revision: c.PreviousBundleRevision, Artifacts: make([]Input, 0, 3)}
	var total int64
	for _, name := range paths {
		old, err := find(prior, name)
		if err != nil {
			return nil, nil, err
		}
		now, err := find(current, name)
		if err != nil {
			return nil, nil, err
		}
		if old.Hash != now.Hash {
			return nil, nil, fmt.Errorf("current artifact differs from pinned previous bundle: %s", name)
		}
		contents, err := c.Provider.ReadArtifacts(ctx, []string{old.Hash})
		if err != nil {
			return nil, nil, err
		}
		raw := contents[old.Hash]
		maximum := c.MaxFileBytes
		if name == c.IndexPath {
			maximum = c.MaxIndexBytes
		}
		if len(raw) == 0 || int64(len(raw)) > maximum || int64(len(raw)) > c.MaxSourceBytes-total {
			return nil, nil, fmt.Errorf("previous artifact bytes outside bounds: %s", name)
		}
		total += int64(len(raw))
		data[name] = raw
		binding.Artifacts = append(binding.Artifacts, Input{Path: name, SHA256: hash(raw)})
	}
	var receipt Receipt
	if err := strictJSON(data[c.ReceiptPath], &receipt); err != nil {
		return nil, nil, fmt.Errorf("previous receipt: %w", err)
	}
	if receipt.Version != 1 || receipt.Result != "CAPTURED" || receipt.ExitCode != 0 || receipt.SemanticStatus != "unknown" || receipt.Diagnostics != "" || !revisionDigest.MatchString(receipt.SourceRevision) || !hexDigest.MatchString(receipt.IndexSHA256) || !hexDigest.MatchString(receipt.SourceInputDigest) {
		return nil, nil, errors.New("previous receipt has invalid capture identity/status")
	}
	if !hexDigest.MatchString(receipt.Indexer.SHA256) || receipt.Indexer.Path == "" || len(receipt.Indexer.Args) == 0 {
		return nil, nil, errors.New("previous receipt has invalid indexer declaration")
	}
	if int64(len(receipt.Stdout))+int64(len(receipt.Stderr)) > c.MaxLogBytes {
		return nil, nil, errors.New("previous diagnostics exceed capture bound")
	}
	if err := validateInputs(receipt.SourceInputs, c.MaxFiles, paths); err != nil {
		return nil, nil, fmt.Errorf("previous source inputs: %w", err)
	}
	encoded, err := json.Marshal(receipt.SourceInputs)
	if err != nil {
		return nil, nil, err
	}
	if hash(encoded) != receipt.SourceInputDigest {
		return nil, nil, errors.New("previous source input digest mismatch")
	}
	if receipt.PreviousBundle != nil {
		if !revisionDigest.MatchString(receipt.PreviousBundle.Revision) || len(receipt.PreviousBundle.Artifacts) != 3 {
			return nil, nil, errors.New("invalid direct previous-bundle declaration")
		}
		if err := validateInputs(receipt.PreviousBundle.Artifacts, 3, nil); err != nil {
			return nil, nil, err
		}
		for i, in := range receipt.PreviousBundle.Artifacts {
			if in.Path != paths[i] {
				return nil, nil, errors.New("direct previous-bundle artifact paths differ")
			}
		}
	}
	indexHash := hash(data[c.IndexPath])
	if receipt.IndexSHA256 != indexHash {
		return nil, nil, errors.New("previous receipt/raw index digest mismatch")
	}
	var manifest Manifest
	if err := strictJSON(data[c.ManifestPath], &manifest); err != nil {
		return nil, nil, fmt.Errorf("previous manifest: %w", err)
	}
	if manifest.Version != 1 || manifest.IndexSHA256 != indexHash || len(manifest.Inputs) != len(receipt.SourceInputs)+1 {
		return nil, nil, errors.New("previous manifest version/index/input count mismatch")
	}
	if err := validateInputs(manifest.Inputs, len(receipt.SourceInputs)+1, nil); err != nil {
		return nil, nil, fmt.Errorf("previous manifest inputs: %w", err)
	}
	want := append(append([]Input{}, receipt.SourceInputs...), Input{Path: c.ReceiptPath, SHA256: hash(data[c.ReceiptPath])})
	sort.Slice(want, func(i, j int) bool { return want[i].Path < want[j].Path })
	for i, in := range manifest.Inputs {
		if in != want[i] {
			return nil, nil, errors.New("previous manifest must contain exactly source inputs and raw receipt hash")
		}
	}
	filtered := make([]fossil.File, 0, len(current)-3)
	for _, file := range current {
		if file.Path != c.IndexPath && file.Path != c.ManifestPath && file.Path != c.ReceiptPath {
			filtered = append(filtered, file)
		}
	}
	return filtered, binding, nil
}

func validateInputs(inputs []Input, maximum int, excluded []string) error {
	if len(inputs) == 0 || len(inputs) > maximum {
		return errors.New("input count outside bounds")
	}
	seen := make(map[string]bool, len(inputs))
	for i, in := range inputs {
		if err := repositoryPath(in.Path); err != nil {
			return err
		}
		if !hexDigest.MatchString(in.SHA256) {
			return errors.New("invalid input SHA256")
		}
		if i > 0 && inputs[i-1].Path >= in.Path {
			return errors.New("input paths must be unique and sorted")
		}
		key := strings.ToUpper(in.Path)
		if seen[key] {
			return errors.New("input path case alias")
		}
		seen[key] = true
		for _, out := range excluded {
			if overlaps(in.Path, out) {
				return errors.New("source input overlaps reserved output")
			}
		}
	}
	for _, in := range inputs {
		parts := strings.Split(in.Path, "/")
		for i := 1; i < len(parts); i++ {
			if seen[strings.ToUpper(strings.Join(parts[:i], "/"))] {
				return errors.New("input file/directory prefix alias")
			}
		}
	}
	return nil
}

func strictJSON(raw []byte, destination any) error {
	if !utf8.Valid(raw) {
		return errors.New("JSON must be UTF-8")
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	if err := uniqueJSONValue(decoder, 0); err != nil {
		return err
	}
	if _, err := decoder.Token(); err != io.EOF {
		return errors.New("trailing JSON data")
	}
	decoder = json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	return decoder.Decode(destination)
}

func uniqueJSONValue(decoder *json.Decoder, depth int) error {
	if depth > 64 {
		return errors.New("JSON nesting bound exceeded")
	}
	token, err := decoder.Token()
	if err != nil {
		return err
	}
	delimiter, container := token.(json.Delim)
	if !container {
		return nil
	}
	switch delimiter {
	case '{':
		keys := map[string]bool{}
		for decoder.More() {
			token, err := decoder.Token()
			if err != nil {
				return err
			}
			key, ok := token.(string)
			folded := strings.ToLower(key)
			if !ok || keys[folded] {
				return errors.New("duplicate/invalid JSON field")
			}
			keys[folded] = true
			if err := uniqueJSONValue(decoder, depth+1); err != nil {
				return err
			}
		}
	case '[':
		for decoder.More() {
			if err := uniqueJSONValue(decoder, depth+1); err != nil {
				return err
			}
		}
	default:
		return errors.New("unexpected JSON delimiter")
	}
	_, err = decoder.Token()
	return err
}
