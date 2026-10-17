package evidencegraph

import (
	"database/sql"
	"path/filepath"
	"testing"

	_ "modernc.org/sqlite"
)

func TestSQLitePrimitive(t *testing.T) {
	path := filepath.Join(t.TempDir(), "metadata.sqlite")
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if _, err := db.Exec("CREATE TABLE primitive(value TEXT NOT NULL); INSERT INTO primitive VALUES('retained')"); err != nil {
		t.Fatal(err)
	}
	tx, err := db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec("UPDATE primitive SET value='discarded'"); err != nil {
		t.Fatal(err)
	}
	if err := tx.Rollback(); err != nil {
		t.Fatal(err)
	}
	var value string
	if err := db.QueryRow("SELECT value FROM primitive").Scan(&value); err != nil {
		t.Fatal(err)
	}
	if value != "retained" {
		t.Fatalf("rollback value %q", value)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
	reopened, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	if err := reopened.QueryRow("SELECT value FROM primitive").Scan(&value); err != nil || value != "retained" {
		t.Fatalf("readback %q %v", value, err)
	}
}
