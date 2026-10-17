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
	"time"

	"dais.local/codeintelligence/internal/fossil"
	"dais.local/codeintelligence/internal/search"
)

type stringList []string

func (s *stringList) String() string { return fmt.Sprint([]string(*s)) }
func (s *stringList) Set(value string) error {
	*s = append(*s, value)
	return nil
}

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()
	if err := run(ctx, os.Args[1:], os.Stdout, os.Stderr); err != nil {
		_ = json.NewEncoder(os.Stderr).Encode(map[string]string{"error": err.Error()})
		os.Exit(1)
	}
}

func run(ctx context.Context, args []string, out, diagnostics io.Writer) error {
	if len(args) == 0 {
		return errors.New("usage: dais-ci index|search|status [flags]")
	}
	if args[0] != "index" && args[0] != "search" && args[0] != "status" {
		return fmt.Errorf("unknown command %q; expected index, search or status", args[0])
	}
	flags := flag.NewFlagSet(args[0], flag.ContinueOnError)
	flags.SetOutput(diagnostics)
	indexRoot := flags.String("index-root", "", "Directory for derived search indexes and publication metadata")
	repositoryID := flags.String("repository-id", "", "Stable identity of the indexed repository")
	repository := flags.String("repository", "", "Absolute path to the source Fossil repository")
	fossilExecutable := flags.String("fossil", "", "Fossil executable")
	fossilHome := flags.String("fossil-home", "", "Existing directory for isolated Fossil configuration")
	ref := flags.String("ref", "", "Explicit Fossil branch or full check-in hash to index")
	mode := flags.String("mode", "full", "Index mode: full or delta")
	kind := flags.String("kind", "code", "Search kind: code, regex, filename or symbol_text")
	query := flags.String("query", "", "Search expression")
	limit := flags.Int("limit", 100, "Maximum returned matches")
	maxResults := flags.Int("max-results", 1000, "Search result hard bound")
	maxFileBytes := flags.Int("max-file-bytes", 1<<20, "Maximum indexed bytes per file; larger files are reported as omitted")
	maxQueryBytes := flags.Int("max-query-bytes", 4096, "Maximum search expression bytes")
	queryTimeout := flags.Duration("query-timeout", 5*time.Second, "Search deadline")
	commandTimeout := flags.Duration("fossil-timeout", 30*time.Second, "Deadline per Fossil SQL call")
	maxOutputBytes := flags.Int64("fossil-output-bytes", 64<<20, "Combined Fossil stdout/stderr hard bound")
	expectRevision := flags.String("expect-revision", "", "Reject a publication at any other full Fossil check-in hash")
	var excluded stringList
	flags.Var(&excluded, "exclude", "Excluded repository path pattern; may be repeated")
	if err := flags.Parse(args[1:]); err != nil {
		return err
	}
	if flags.NArg() != 0 {
		return fmt.Errorf("unexpected positional arguments: %v", flags.Args())
	}
	if *indexRoot == "" || *repositoryID == "" {
		return errors.New("--index-root and --repository-id are required")
	}
	var provider *fossil.Provider
	if args[0] == "index" {
		var err error
		provider, err = fossil.New(fossil.Config{
			Executable: *fossilExecutable, Repository: *repository, HeadRef: *ref,
			FossilHome: *fossilHome, Timeout: *commandTimeout, MaxOutputBytes: *maxOutputBytes,
		})
		if err != nil {
			return err
		}
	}
	adapter, err := search.New(search.Config{
		IndexRoot: *indexRoot, RepositoryID: *repositoryID, Provider: provider,
		Exclude: excluded, MaxFileBytes: *maxFileBytes, MaxQueryBytes: *maxQueryBytes,
		MaxResults: *maxResults, QueryTimeout: *queryTimeout,
	})
	if err != nil {
		return err
	}
	defer func() {
		if err := adapter.Close(); err != nil {
			fmt.Fprintf(diagnostics, "close search adapter: %v\n", err)
		}
	}()
	if args[0] == "index" {
		revision, err := provider.Head(ctx)
		if err != nil {
			return err
		}
		if *expectRevision != "" && revision.Hash != *expectRevision {
			return fmt.Errorf("target revision mismatch: got %s, expected %s", revision.Hash, *expectRevision)
		}
		snapshot, err := adapter.Index(ctx, revision, *mode)
		if err != nil {
			return err
		}
		return json.NewEncoder(out).Encode(snapshot)
	}
	snapshot, err := adapter.Status(ctx)
	if err != nil {
		return err
	}
	if *expectRevision != "" && snapshot.Revision != *expectRevision {
		return fmt.Errorf("published revision mismatch: got %s, expected %s", snapshot.Revision, *expectRevision)
	}
	if args[0] == "status" {
		return json.NewEncoder(out).Encode(snapshot)
	}
	response, err := adapter.Search(ctx, search.Request{Kind: *kind, Query: *query, Limit: *limit})
	if err != nil {
		return err
	}
	if *expectRevision != "" && response.Snapshot.Revision != *expectRevision {
		return fmt.Errorf("search revision mismatch: got %s, expected %s", response.Snapshot.Revision, *expectRevision)
	}
	return json.NewEncoder(out).Encode(response)
}
