package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"os/signal"
	"path/filepath"
	"regexp"
	"time"

	"dais.local/codeintelligence/internal/evidencegraph"
	"dais.local/codeintelligence/internal/fossil"
)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()
	if err := run(ctx, os.Args[1:], os.Stdout, os.Stderr); err != nil {
		if encodeErr := json.NewEncoder(os.Stderr).Encode(map[string]string{"error": err.Error()}); encodeErr != nil {
			fmt.Fprintf(os.Stderr, "write error response: %v\n", encodeErr)
		}
		os.Exit(1)
	}
}

func run(ctx context.Context, args []string, out, diagnostics io.Writer) (resultErr error) {
	if len(args) == 0 {
		return errors.New("usage: dais-graph import|status|facts|verify|reference-impact|export-scs|export-scip [flags]")
	}
	command := args[0]
	switch command {
	case "import", "status", "facts", "verify", "reference-impact", "export-scs", "export-scip":
	default:
		return fmt.Errorf("unknown command %q", command)
	}
	flags := flag.NewFlagSet(command, flag.ContinueOnError)
	flags.SetOutput(diagnostics)
	indexRoot := flags.String("index-root", "", "Absolute directory for derived metadata.sqlite")
	repositoryID := flags.String("repository-id", "", "Stable repository namespace")
	snapshot := flags.String("snapshot", "", "Explicit graph snapshot ID")
	repository := flags.String("repository", "", "Absolute Fossil repository path")
	fossilExecutable := flags.String("fossil", "", "Native Fossil executable")
	fossilHome := flags.String("fossil-home", "", "Existing isolated Fossil configuration directory")
	revision := flags.String("ref", "", "Full Fossil check-in hash for import")
	target := flags.String("target-revision", "", "Full Fossil check-in hash for verification")
	beforeSnapshot := flags.String("before-snapshot", "", "Explicit before graph snapshot for reference impact")
	beforeTarget := flags.String("before-target-revision", "", "Full before Fossil check-in hash for reference impact")
	maxResponseBytes := flags.Int("max-response-bytes", 2<<20, "Maximum serialized reference-impact response bytes")
	indexPath := flags.String("scip", "", "Tracked repository-relative binary SCIP path")
	manifestPath := flags.String("manifest", "", "Tracked repository-relative input-manifest path")
	profile := flags.String("profile", evidencegraph.ProfileUTF8, "Supported import profile")
	limit := flags.Int("limit", 100, "Maximum facts returned")
	maxFacts := flags.Int("max-facts", 100000, "Maximum imported assertions")
	maxIndexBytes := flags.Int64("max-index-bytes", 16<<20, "Maximum binary SCIP bytes")
	maxManifestBytes := flags.Int64("max-manifest-bytes", 2<<20, "Maximum input manifest bytes")
	maxSourceBytes := flags.Int64("max-source-bytes", 8<<20, "Maximum aggregate bytes of workspace inputs")
	timeout := flags.Duration("timeout", 2*time.Minute, "Whole-command deadline")
	if err := flags.Parse(args[1:]); err != nil {
		return err
	}
	if flags.NArg() != 0 {
		return errors.New("unexpected positional arguments")
	}
	if !filepath.IsAbs(*indexRoot) || *repositoryID == "" {
		return errors.New("absolute --index-root and --repository-id are required")
	}
	if *limit < 1 || *limit > *maxFacts || *maxFacts < 1 || *maxIndexBytes < 1 || *maxManifestBytes < 1 || *maxSourceBytes < 1 || *maxResponseBytes < 1 || *timeout <= 0 {
		return errors.New("positive input, fact, result and timeout bounds are required; limit must not exceed max-facts")
	}
	if command != "import" && command != "status" && *snapshot == "" {
		return errors.New("--snapshot is required for this command")
	}
	if command == "import" && (*indexPath == "" || *manifestPath == "") {
		return errors.New("import requires tracked --scip and --manifest paths")
	}
	if command == "reference-impact" && (*beforeSnapshot == "" || !regexp.MustCompile(`^(?:[0-9a-f]{40}|[0-9a-f]{64})$`).MatchString(*beforeTarget)) {
		return errors.New("reference-impact requires --before-snapshot and full lowercase --before-target-revision")
	}
	ctx, cancel := context.WithTimeout(ctx, *timeout)
	defer cancel()
	var provider *fossil.Provider
	if command == "import" || command == "verify" || command == "reference-impact" {
		ref := *revision
		if command == "verify" || command == "reference-impact" {
			ref = *target
		}
		if !regexp.MustCompile(`^(?:[0-9a-f]{40}|[0-9a-f]{64})$`).MatchString(ref) {
			return errors.New("import/verify requires an explicit full lowercase Fossil check-in hash")
		}
		var err error
		provider, err = fossil.New(fossil.Config{
			Executable: *fossilExecutable, Repository: *repository, FossilHome: *fossilHome,
			HeadRef: ref, Timeout: min(*timeout, 30*time.Second), MaxOutputBytes: 64 << 20,
		})
		if err != nil {
			return err
		}
	}
	metadata := filepath.Join(*indexRoot, "metadata.sqlite")
	if command != "import" {
		if _, err := os.Stat(metadata); err != nil {
			return fmt.Errorf("existing graph metadata required: %w", err)
		}
	}
	store, err := evidencegraph.Open(evidencegraph.Config{
		Provider: provider, MetadataPath: metadata, RepositoryID: *repositoryID, Profile: *profile,
		MaxIndexBytes: *maxIndexBytes, MaxManifestBytes: *maxManifestBytes,
		MaxSourceBytes: *maxSourceBytes, MaxFacts: *maxFacts,
	})
	if err != nil {
		return err
	}
	defer func() {
		if err := store.Close(); err != nil {
			if resultErr == nil {
				resultErr = fmt.Errorf("close graph store: %w", err)
				return
			}
			fmt.Fprintf(diagnostics, "close graph store: %v\n", err)
		}
	}()
	encoder := json.NewEncoder(out)
	switch command {
	case "import":
		s, err := store.Import(ctx, *revision, *indexPath, *manifestPath)
		if err != nil {
			return err
		}
		return encoder.Encode(s)
	case "status":
		s, err := store.Current(ctx)
		if err != nil {
			return err
		}
		return encoder.Encode(s)
	case "facts":
		page, err := store.Facts(ctx, *snapshot, *limit)
		if err != nil {
			return err
		}
		return encoder.Encode(page)
	case "verify":
		receipt, err := store.Verify(ctx, *snapshot, *target)
		if err != nil {
			return err
		}
		if err := encoder.Encode(receipt); err != nil {
			return err
		}
		if receipt.Result != "PASS" {
			return fmt.Errorf("verification %s; retained receipt %s", receipt.Result, receipt.ID)
		}
		return nil
	case "reference-impact":
		impact, err := store.ReferenceImpact(ctx, evidencegraph.ImpactRequest{BeforeSnapshotID: *beforeSnapshot, BeforeTargetRevision: *beforeTarget, AfterSnapshotID: *snapshot, AfterTargetRevision: *target, Limit: *limit})
		if err != nil {
			return err
		}
		if err := evidencegraph.ValidateReferenceImpactSize(impact, *maxResponseBytes); err != nil {
			return err
		}
		return writeBoundedJSON(out, impact, *maxResponseBytes)
	case "export-scs":
		return store.ExportSCs(ctx, *snapshot, out)
	case "export-scip":
		data, err := store.ExportSCIP(ctx, *snapshot)
		if err != nil {
			return err
		}
		_, err = out.Write(data)
		return err
	}
	return errors.New("unreachable graph command")
}

func writeBoundedJSON(out io.Writer, value any, maximum int) error {
	if maximum <= 0 {
		return errors.New("positive response byte bound required")
	}
	encoded, err := json.Marshal(value)
	if err != nil {
		return err
	}
	if len(encoded) >= maximum {
		return errors.New("reference-impact response exceeds configured byte bound")
	}
	encoded = append(encoded, '\n')
	written, err := out.Write(encoded)
	if err == nil && written != len(encoded) {
		return io.ErrShortWrite
	}
	return err
}
