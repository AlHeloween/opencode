package mcpserver

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"
	"regexp"
	"time"

	"dais.local/codeintelligence/internal/evidencegraph"
	"dais.local/codeintelligence/internal/search"
	"github.com/modelcontextprotocol/go-sdk/jsonrpc"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

type Config struct {
	Graph                                       *evidencegraph.Store
	Search                                      *search.Adapter
	SnapshotID, TargetRevision                  string
	MaxResults, MaxResponseBytes, MaxFrameBytes int
	RequestTimeout                              time.Duration
	Diagnostics                                 io.Writer
}

type Server struct {
	config         Config
	sdk            *mcp.Server
	snapshot       evidencegraph.Snapshot
	searchSnapshot SearchSnapshot
}

type NavigationArgs struct {
	DocumentPath string `json:"document_path"`
	Line         int    `json:"line"`
	Character    int    `json:"character"`
	Limit        int    `json:"limit"`
}
type SearchArgs struct {
	Kind  string `json:"kind"`
	Query string `json:"query"`
	Limit int    `json:"limit"`
}
type SearchSnapshot struct {
	Generation   string `json:"generation"`
	RepositoryID string `json:"repository_id"`
	Revision     string `json:"revision"`
	SVRef        string `json:"sv_ref"`
	IndexedFiles int    `json:"indexed_files"`
	OmittedFiles int    `json:"omitted_files"`
}
type SearchMatch struct {
	Generation   string `json:"generation"`
	RepositoryID string `json:"repository_id"`
	Revision     string `json:"revision"`
	SVRef        string `json:"sv_ref"`
	Path         string `json:"path"`
	ArtifactHash string `json:"artifact_hash"`
	Line         int    `json:"line"`
	Content      string `json:"content"`
}
type NavigationResponse struct {
	Query          NavigationArgs                 `json:"query"`
	Navigation     evidencegraph.NavigationResult `json:"navigation"`
	Verification   evidencegraph.Receipt          `json:"verification"`
	SearchSnapshot SearchSnapshot                 `json:"search_snapshot"`
}
type SearchResponse struct {
	Query          SearchArgs             `json:"query"`
	Snapshot       evidencegraph.Snapshot `json:"snapshot"`
	Verification   evidencegraph.Receipt  `json:"verification"`
	SearchSnapshot SearchSnapshot         `json:"search_snapshot"`
	Results        []SearchMatch          `json:"results"`
	Returned       int                    `json:"returned"`
	Complete       bool                   `json:"complete"`
	Truncated      bool                   `json:"truncated"`
	LineBase       int                    `json:"line_base"`
	SemanticStatus string                 `json:"semantic_status"`
}
type StatusResponse struct {
	Snapshot       evidencegraph.Snapshot `json:"snapshot"`
	Verification   evidencegraph.Receipt  `json:"verification"`
	SearchSnapshot SearchSnapshot         `json:"search_snapshot"`
	SemanticStatus string                 `json:"semantic_status"`
}

func convertSnapshot(value search.Snapshot) SearchSnapshot {
	return SearchSnapshot{Generation: value.Generation, RepositoryID: value.RepositoryID, Revision: value.Revision, SVRef: value.SVRef, IndexedFiles: value.IndexedFiles, OmittedFiles: value.OmittedFiles}
}

func New(ctx context.Context, c Config) (*Server, error) {
	if c.Graph == nil || c.Search == nil || c.MaxResults <= 0 || c.MaxResponseBytes <= 0 || c.MaxFrameBytes <= 0 || c.RequestTimeout <= 0 || !regexp.MustCompile(`^[a-f0-9]{64}$`).MatchString(c.SnapshotID) || !regexp.MustCompile(`^(?:[a-f0-9]{40}|[a-f0-9]{64})$`).MatchString(c.TargetRevision) {
		return nil, errors.New("graph/search, explicit snapshot/target and positive MCP bounds required")
	}
	ctx, cancel := context.WithTimeout(ctx, c.RequestTimeout)
	defer cancel()
	snapshot, err := c.Graph.Snapshot(ctx, c.SnapshotID)
	if err != nil {
		return nil, err
	}
	published, err := c.Search.Status(ctx)
	if err != nil {
		return nil, err
	}
	if published.Generation == "" || published.Revision != c.TargetRevision || published.RepositoryID != snapshot.RepositoryID {
		return nil, errors.New("search publication does not match fixed graph repository/target")
	}
	server := &Server{config: c, snapshot: snapshot, searchSnapshot: convertSnapshot(published)}
	if _, err := server.verify(ctx); err != nil {
		return nil, fmt.Errorf("MCP preflight: %w", err)
	}
	diagnostics := c.Diagnostics
	if diagnostics == nil {
		diagnostics = os.Stderr
	}
	server.sdk = mcp.NewServer(&mcp.Implementation{Name: "dais-code-intelligence", Version: "1"}, &mcp.ServerOptions{Logger: slog.New(slog.NewTextHandler(diagnostics, &slog.HandlerOptions{Level: slog.LevelWarn}))})
	navigationSchema := objectSchema(map[string]any{"document_path": map[string]any{"type": "string"}, "line": map[string]any{"type": "integer", "minimum": 0}, "character": map[string]any{"type": "integer", "minimum": 0}, "limit": map[string]any{"type": "integer", "minimum": 1, "maximum": c.MaxResults}}, []string{"document_path", "line", "character", "limit"})
	mcp.AddTool[NavigationArgs, any](server.sdk, &mcp.Tool{Name: "symboldefinition", Description: "Definitions at a pinned source position: zero-based lines and UTF8 byte characters, with executed verification.", InputSchema: navigationSchema}, server.navigation(evidencegraph.Definitions))
	mcp.AddTool[NavigationArgs, any](server.sdk, &mcp.Tool{Name: "symbolreferences", Description: "References at a pinned source position: zero-based lines and UTF8 byte characters, with executed verification.", InputSchema: navigationSchema}, server.navigation(evidencegraph.References))
	mcp.AddTool[SearchArgs, any](server.sdk, &mcp.Tool{Name: "codesearch", Description: "Case-sensitive Zoekt text/filename/regex search in the fixed verified generation; result lines are one-based.", InputSchema: objectSchema(map[string]any{"kind": map[string]any{"type": "string", "enum": []string{"code", "regex", "filename", "symbol_text"}}, "query": map[string]any{"type": "string", "minLength": 1}, "limit": map[string]any{"type": "integer", "minimum": 1, "maximum": c.MaxResults}}, []string{"kind", "query", "limit"})}, server.codeSearch)
	mcp.AddTool[struct{}, any](server.sdk, &mcp.Tool{Name: "indexstatus", Description: "Check the fixed graph/target/search generation and return executed verification evidence.", InputSchema: objectSchema(map[string]any{}, []string{})}, server.status)
	return server, nil
}

func objectSchema(properties map[string]any, required []string) map[string]any {
	return map[string]any{"type": "object", "properties": properties, "required": required, "additionalProperties": false}
}

func (s *Server) checkSearch(ctx context.Context) error {
	current, err := s.config.Search.Status(ctx)
	if err != nil {
		return err
	}
	if convertSnapshot(current) != s.searchSnapshot {
		return errors.New("search generation changed from fixed startup scope")
	}
	return nil
}
func (s *Server) verify(ctx context.Context) (evidencegraph.Receipt, error) {
	if err := s.checkSearch(ctx); err != nil {
		return evidencegraph.Receipt{}, err
	}
	receipt, err := s.config.Graph.Verify(ctx, s.config.SnapshotID, s.config.TargetRevision)
	if err != nil {
		return receipt, err
	}
	if receipt.Result != "PASS" || receipt.SemanticStatus != "unknown" || receipt.InstrumentSHA256 == "" {
		return receipt, fmt.Errorf("pinned graph verification %s: %s", receipt.Result, receipt.Details)
	}
	return receipt, s.checkSearch(ctx)
}

func (s *Server) navigation(mode evidencegraph.NavigationMode) mcp.ToolHandlerFor[NavigationArgs, any] {
	return func(ctx context.Context, _ *mcp.CallToolRequest, args NavigationArgs) (*mcp.CallToolResult, any, error) {
		ctx, cancel := context.WithTimeout(ctx, s.config.RequestTimeout)
		defer cancel()
		receipt, err := s.verify(ctx)
		if err != nil {
			return nil, nil, err
		}
		result, err := s.config.Graph.Navigate(ctx, s.config.SnapshotID, evidencegraph.Position{DocumentPath: args.DocumentPath, Line: args.Line, Character: args.Character}, mode, args.Limit)
		if err != nil {
			return nil, nil, err
		}
		if err := s.checkSearch(ctx); err != nil {
			return nil, nil, err
		}
		return s.finish(NavigationResponse{Query: args, Navigation: result, Verification: receipt, SearchSnapshot: s.searchSnapshot})
	}
}
func (s *Server) codeSearch(ctx context.Context, _ *mcp.CallToolRequest, args SearchArgs) (*mcp.CallToolResult, any, error) {
	ctx, cancel := context.WithTimeout(ctx, s.config.RequestTimeout)
	defer cancel()
	receipt, err := s.verify(ctx)
	if err != nil {
		return nil, nil, err
	}
	response, err := s.config.Search.Search(ctx, search.Request{Kind: args.Kind, Query: args.Query, Limit: args.Limit})
	if err != nil {
		return nil, nil, err
	}
	if convertSnapshot(response.Snapshot) != s.searchSnapshot {
		return nil, nil, errors.New("search response differs from pinned startup generation")
	}
	if err := s.checkSearch(ctx); err != nil {
		return nil, nil, err
	}
	result := SearchResponse{Query: args, Snapshot: s.snapshot, Verification: receipt, SearchSnapshot: s.searchSnapshot, Results: []SearchMatch{}, Returned: len(response.Results), Complete: response.Complete, Truncated: response.Truncated, LineBase: 1, SemanticStatus: "unknown"}
	for _, value := range response.Results {
		if value.Generation != s.searchSnapshot.Generation || value.Revision != s.config.TargetRevision || value.RepositoryID != s.snapshot.RepositoryID || value.ArtifactHash == "" {
			return nil, nil, errors.New("search location lacks matching fixed provenance")
		}
		result.Results = append(result.Results, SearchMatch{Generation: value.Generation, RepositoryID: value.RepositoryID, Revision: value.Revision, SVRef: value.SVRef, Path: value.Path, ArtifactHash: value.ArtifactHash, Line: value.Line, Content: value.Content})
	}
	return s.finish(result)
}
func (s *Server) status(ctx context.Context, _ *mcp.CallToolRequest, _ struct{}) (*mcp.CallToolResult, any, error) {
	ctx, cancel := context.WithTimeout(ctx, s.config.RequestTimeout)
	defer cancel()
	receipt, err := s.verify(ctx)
	if err != nil {
		return nil, nil, err
	}
	return s.finish(StatusResponse{Snapshot: s.snapshot, Verification: receipt, SearchSnapshot: s.searchSnapshot, SemanticStatus: "unknown"})
}
func (s *Server) finish(value any) (*mcp.CallToolResult, any, error) {
	raw, err := json.Marshal(value)
	if err != nil {
		return nil, nil, err
	}
	result := &mcp.CallToolResult{Content: []mcp.Content{&mcp.TextContent{Text: string(raw)}}, StructuredContent: json.RawMessage(raw)}
	encoded, err := json.Marshal(result)
	if err != nil {
		return nil, nil, err
	}
	if len(encoded) > s.config.MaxResponseBytes {
		return nil, nil, errors.New("tool result exceeds configured response byte bound")
	}
	return result, json.RawMessage(raw), nil
}

func (s *Server) Run(ctx context.Context, transport mcp.Transport) error {
	return s.sdk.Run(ctx, boundedTransport{Transport: transport, maximum: s.config.MaxResponseBytes})
}
func (s *Server) Stdio(ctx context.Context) error {
	return s.Run(ctx, &mcp.StdioTransport{MaxLineLength: s.config.MaxFrameBytes})
}

type boundedTransport struct {
	mcp.Transport
	maximum int
}

func (t boundedTransport) Connect(ctx context.Context) (mcp.Connection, error) {
	connection, err := t.Transport.Connect(ctx)
	if err != nil {
		return nil, err
	}
	return boundedConnection{Connection: connection, maximum: t.maximum}, nil
}

type boundedConnection struct {
	mcp.Connection
	maximum int
}

func (c boundedConnection) Write(ctx context.Context, message jsonrpc.Message) error {
	raw, err := jsonrpc.EncodeMessage(message)
	if err != nil {
		return err
	}
	if len(raw) > c.maximum {
		return errors.Join(errors.New("MCP outbound frame exceeds configured response byte bound"), c.Connection.Close())
	}
	return c.Connection.Write(ctx, message)
}
