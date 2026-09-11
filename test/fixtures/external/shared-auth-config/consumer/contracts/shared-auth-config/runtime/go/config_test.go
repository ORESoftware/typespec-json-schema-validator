package sharedauthconfig

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"sort"
	"strings"
	"testing"
)

func fixtureRoot(t *testing.T) string {
	t.Helper()
	_, current, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime.Caller could not locate Go evidence package")
	}
	return filepath.Clean(filepath.Join(filepath.Dir(current), "..", "..", "instances", "SharedAuthConfigFile"))
}

func fixtureNames(t *testing.T, kind string) []string {
	t.Helper()
	entries, err := os.ReadDir(filepath.Join(fixtureRoot(t), kind))
	if err != nil {
		t.Fatalf("read %s fixture directory: %v", kind, err)
	}
	var fixtures []string
	for _, entry := range entries {
		if !entry.IsDir() && strings.HasSuffix(entry.Name(), ".json") {
			fixtures = append(fixtures, filepath.ToSlash(filepath.Join(kind, entry.Name())))
		}
	}
	sort.Strings(fixtures)
	if len(fixtures) == 0 {
		t.Fatalf("TJSV corpus must contain %s fixtures", kind)
	}
	return fixtures
}

func readFixture(t *testing.T, relative string) []byte {
	t.Helper()
	data, err := os.ReadFile(filepath.Join(fixtureRoot(t), filepath.FromSlash(relative)))
	if err != nil {
		t.Fatalf("read fixture %s: %v", relative, err)
	}
	return data
}

func semanticJSON(t *testing.T, input []byte) any {
	t.Helper()
	var value any
	if err := json.Unmarshal(input, &value); err != nil {
		t.Fatalf("decode semantic JSON: %v", err)
	}
	return value
}

func TestIngressMatchesEntireTJSVCorpus(t *testing.T) {
	for _, fixture := range fixtureNames(t, "valid") {
		fixture := fixture
		t.Run(fixture, func(t *testing.T) {
			if _, err := ParseJSON(readFixture(t, fixture)); err != nil {
				t.Fatalf("valid TJSV fixture rejected: %v", err)
			}
		})
	}

	for _, fixture := range fixtureNames(t, "invalid") {
		fixture := fixture
		t.Run(fixture, func(t *testing.T) {
			if _, err := ParseJSON(readFixture(t, fixture)); err == nil {
				t.Fatal("invalid TJSV fixture was admitted")
			}
		})
	}
}

func TestEgressPreservesEveryAdmittedWireShape(t *testing.T) {
	for _, fixture := range fixtureNames(t, "valid") {
		fixture := fixture
		t.Run(fixture, func(t *testing.T) {
			raw := readFixture(t, fixture)
			parsed, err := ParseJSON(raw)
			if err != nil {
				t.Fatalf("valid TJSV fixture rejected: %v", err)
			}
			emitted, err := json.Marshal(parsed)
			if err != nil {
				t.Fatalf("marshal Go runtime evidence: %v", err)
			}
			if !reflect.DeepEqual(semanticJSON(t, raw), semanticJSON(t, emitted)) {
				t.Fatalf("Go egress altered the admitted wire shape\noriginal: %s\nemitted: %s", raw, emitted)
			}
			if _, err := ParseJSON(emitted); err != nil {
				t.Fatalf("Go egress was not re-admitted: %v", err)
			}
		})
	}
}
