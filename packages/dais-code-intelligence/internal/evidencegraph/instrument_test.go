package evidencegraph

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"

	wire "dais.local/codeintelligence/internal/scipwire"
)

func TestReceiptsPinExecutedInstrument(t *testing.T) {
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	file, err := os.Open(executable)
	if err != nil {
		t.Fatal(err)
	}
	digest := sha256.New()
	if _, err := io.Copy(digest, file); err != nil {
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}
	want := hex.EncodeToString(digest.Sum(nil))
	f := newGraphFixture(t)
	f.bundle(nil)
	a := f.commit("instrument")
	store := openFixtureStore(t, f, filepath.Join(t.TempDir(), "metadata.sqlite"))
	defer store.Close()
	ctx := context.Background()
	snapshot, err := store.Import(ctx, a, "index.scip", "manifest.json")
	if err != nil {
		t.Fatal(err)
	}
	receipt, err := store.Verify(ctx, snapshot.ID, a)
	if err != nil || receipt.Result != "PASS" || receipt.InstrumentSHA256 != want {
		t.Fatalf("executed instrument pin %+v %v want=%s", receipt, err, want)
	}
	var output bytes.Buffer
	if err := store.ExportSCs(ctx, snapshot.ID, &output); err != nil || !strings.Contains(output.String(), "current_instrument_sha256 "+want) {
		t.Fatalf("export instrument header %v", err)
	}
	f.index.Metadata.TextDocumentEncoding = wire.TextEncoding_UTF16
	f.bundle(nil)
	bad := f.commit("invalid import")
	if _, err := store.Import(ctx, bad, "index.scip", "manifest.json"); err == nil {
		t.Fatal("invalid import accepted")
	}
	rows, err := store.db.Query("SELECT receipt_json FROM ci_graph_receipts")
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	foundFailure := false
	for rows.Next() {
		var data []byte
		if err := rows.Scan(&data); err != nil {
			t.Fatal(err)
		}
		var stored Receipt
		if err := json.Unmarshal(data, &stored); err != nil {
			t.Fatal(err)
		}
		if stored.InstrumentSHA256 != want {
			t.Fatalf("receipt lacks tool pin %+v", stored)
		}
		foundFailure = foundFailure || stored.Result == "FAIL"
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	if !foundFailure {
		t.Fatal("import FAIL passport not retained")
	}
}
