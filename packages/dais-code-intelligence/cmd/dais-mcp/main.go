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
	"time"

	"dais.local/codeintelligence/internal/evidencegraph"
	"dais.local/codeintelligence/internal/fossil"
	"dais.local/codeintelligence/internal/mcpserver"
	"dais.local/codeintelligence/internal/search"
)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()
	if err := run(ctx, os.Args[1:], os.Stderr); err != nil {
		if writeErr := json.NewEncoder(os.Stderr).Encode(map[string]string{"error": err.Error()}); writeErr != nil {
			fmt.Fprintf(os.Stderr, "write error response: %v\n", writeErr)
		}
		os.Exit(1)
	}
}

func run(ctx context.Context, args []string, diagnostics io.Writer) (err error) {
	flags := flag.NewFlagSet("dais-mcp", flag.ContinueOnError)
	flags.SetOutput(diagnostics)
	indexRoot := flags.String("index-root", "", "Absolute shared search/graph index directory")
	repositoryID := flags.String("repository-id", "", "Fixed repository namespace")
	repository := flags.String("repository", "", "Absolute readonly source Fossil repository")
	fossilExecutable := flags.String("fossil", "", "Native Fossil executable")
	fossilHome := flags.String("fossil-home", "", "Existing isolated Fossil configuration directory")
	snapshot := flags.String("snapshot", "", "Explicit immutable graph snapshot ID")
	target := flags.String("target-revision", "", "Full immutable Fossil applicability target")
	profile := flags.String("profile", evidencegraph.ProfileUTF8, "Pinned SCIP projection profile")
	maxFacts := flags.Int("max-facts", 100000, "Maximum bounded graph facts")
	maxResults := flags.Int("max-results", 100, "Maximum results per tool call")
	maxResponse := flags.Int("max-response-bytes", 1<<20, "Maximum outbound protocol frame/result bytes")
	maxFrame := flags.Int("max-frame-bytes", 1<<20, "Maximum inbound SDK stdio frame bytes")
	timeout := flags.Duration("timeout", 10*time.Second, "Startup preflight and per-tool deadline")
	maxIndex := flags.Int64("max-index-bytes", 16<<20, "Maximum raw SCIP bytes")
	maxManifest := flags.Int64("max-manifest-bytes", 8<<20, "Maximum source manifest bytes")
	maxSources := flags.Int64("max-source-bytes", 64<<20, "Maximum declared source bytes")
	maxQuery := flags.Int("max-query-bytes", 4096, "Maximum Zoekt query bytes")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if flags.NArg() != 0 {
		return errors.New("unexpected positional arguments")
	}
	if !filepath.IsAbs(*indexRoot) || *repositoryID == "" || *snapshot == "" || *target == "" || *maxFacts <= 0 || *maxResults <= 0 || *maxResponse <= 0 || *maxFrame <= 0 || *timeout <= 0 || *maxIndex <= 0 || *maxManifest <= 0 || *maxSources <= 0 || *maxQuery <= 0 {
		return errors.New("explicit fixed scope and positive native MCP bounds required")
	}
	provider, err := fossil.New(fossil.Config{Executable: *fossilExecutable, Repository: *repository, FossilHome: *fossilHome, HeadRef: *target, Timeout: min(*timeout, 30*time.Second), MaxOutputBytes: 64 << 20})
	if err != nil {
		return err
	}
	adapter, err := search.New(search.Config{IndexRoot: filepath.Clean(*indexRoot), RepositoryID: *repositoryID, MaxResults: *maxResults, MaxQueryBytes: *maxQuery, MaxResponseBytes: *maxResponse, QueryTimeout: *timeout})
	if err != nil {
		return err
	}
	defer func() { err = errors.Join(err, adapter.Close()) }()
	graph, err := evidencegraph.Open(evidencegraph.Config{Provider: provider, MetadataPath: filepath.Join(*indexRoot, "metadata.sqlite"), RepositoryID: *repositoryID, Profile: *profile, MaxFacts: *maxFacts, MaxIndexBytes: *maxIndex, MaxManifestBytes: *maxManifest, MaxSourceBytes: *maxSources})
	if err != nil {
		return err
	}
	defer func() { err = errors.Join(err, graph.Close()) }()
	server, err := mcpserver.New(ctx, mcpserver.Config{Graph: graph, Search: adapter, SnapshotID: *snapshot, TargetRevision: *target, MaxResults: *maxResults, MaxResponseBytes: *maxResponse, MaxFrameBytes: *maxFrame, RequestTimeout: *timeout, Diagnostics: diagnostics})
	if err != nil {
		return err
	}
	return server.Stdio(ctx)
}
