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

	"dais.local/codeintelligence/internal/capture"
	"dais.local/codeintelligence/internal/fossil"
)

type values []string

func (v *values) String() string { return fmt.Sprint([]string(*v)) }
func (v *values) Set(value string) error {
	*v = append(*v, value)
	return nil
}

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

func run(ctx context.Context, args []string, out, diagnostics io.Writer) error {
	flags := flag.NewFlagSet("dais-capture", flag.ContinueOnError)
	flags.SetOutput(diagnostics)
	bundle := flags.String("bundle", "", "New absolute directory for the immutable candidate bundle")
	scratch := flags.String("scratch", "", "Existing caller-owned directory for isolated source materialization")
	repository := flags.String("repository", "", "Absolute readonly source Fossil repository")
	fossilExecutable := flags.String("fossil", "", "Native Fossil executable")
	fossilHome := flags.String("fossil-home", "", "Existing isolated Fossil configuration directory")
	revision := flags.String("ref", "", "Full immutable source Fossil check-in hash")
	previousBundle := flags.String("previous-bundle-ref", "", "Explicit immutable prior publication whose exact three artifacts may be replaced")
	indexer := flags.String("indexer", "", "Absolute native indexer executable")
	pin := flags.String("indexer-sha256", "", "Expected SHA256 of the executable before launch")
	indexPath := flags.String("scip", "ci/index.scip", "New repository-relative SCIP artifact path")
	manifestPath := flags.String("manifest", "ci/inputs.json", "New repository-relative input manifest path")
	receiptPath := flags.String("receipt", "ci/capture.json", "New repository-relative execution receipt path")
	maxFiles := flags.Int("max-files", 10000, "Maximum source file count")
	maxSourceBytes := flags.Int64("max-source-bytes", 64<<20, "Maximum aggregate source bytes")
	maxFileBytes := flags.Int64("max-file-bytes", 8<<20, "Maximum individual source file bytes")
	maxIndexBytes := flags.Int64("max-index-bytes", 16<<20, "Maximum raw SCIP bytes")
	maxLogBytes := flags.Int64("max-log-bytes", 1<<20, "Combined process stdout/stderr hard bound")
	timeout := flags.Duration("timeout", 2*time.Minute, "Capture deadline")
	var argv, environment values
	flags.Var(&argv, "arg", "Literal indexer argument; repeat, with exactly one {index} placeholder")
	flags.Var(&environment, "env", "Explicit nonsecret KEY=VALUE environment entry; repeat; ambient environment is not inherited")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if flags.NArg() != 0 {
		return errors.New("unexpected positional arguments")
	}
	if *maxFiles < 1 || *maxSourceBytes < 1 || *maxFileBytes < 1 || *maxIndexBytes < 1 || *maxLogBytes < 1 || *timeout <= 0 {
		return errors.New("positive capture bounds are required")
	}
	if !regexp.MustCompile(`^(?:[0-9a-f]{40}|[0-9a-f]{64})$`).MatchString(*revision) {
		return errors.New("--ref requires a full lowercase Fossil check-in hash")
	}
	if *previousBundle != "" && !regexp.MustCompile(`^(?:[0-9a-f]{40}|[0-9a-f]{64})$`).MatchString(*previousBundle) {
		return errors.New("--previous-bundle-ref requires a full lowercase Fossil check-in hash")
	}
	if !regexp.MustCompile(`^[0-9a-f]{64}$`).MatchString(*pin) {
		return errors.New("--indexer-sha256 requires a full lowercase SHA256")
	}
	if !filepath.IsAbs(*bundle) || !filepath.IsAbs(*scratch) || !filepath.IsAbs(*indexer) {
		return errors.New("--bundle, --scratch and --indexer require absolute paths")
	}
	provider, err := fossil.New(fossil.Config{
		Executable: *fossilExecutable, Repository: *repository, FossilHome: *fossilHome,
		HeadRef: *revision, Timeout: min(*timeout, 30*time.Second), MaxOutputBytes: 64 << 20,
	})
	if err != nil {
		return err
	}
	receipt, captureErr := capture.Run(ctx, capture.Config{
		Provider: provider, SourceRevision: *revision, Indexer: filepath.Clean(*indexer), IndexerSHA256: *pin,
		PreviousBundleRevision: *previousBundle,
		Args:                   argv, Environment: environment, ScratchRoot: filepath.Clean(*scratch), BundleDirectory: filepath.Clean(*bundle),
		IndexPath: *indexPath, ManifestPath: *manifestPath, ReceiptPath: *receiptPath,
		MaxFiles: *maxFiles, MaxSourceBytes: *maxSourceBytes, MaxFileBytes: *maxFileBytes,
		MaxIndexBytes: *maxIndexBytes, MaxLogBytes: *maxLogBytes, Timeout: *timeout,
	})
	if receipt.Version != 0 {
		if err := json.NewEncoder(out).Encode(receipt); err != nil {
			return errors.Join(captureErr, fmt.Errorf("write capture receipt: %w", err))
		}
	}
	return captureErr
}
