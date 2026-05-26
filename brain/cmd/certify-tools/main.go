// certify-tools runs the Kubilitics certification engine against all 157 MCP
// tools and writes a signed report to reports/certification/tool-certifications.json.
//
// Usage:
//
//	certify-tools [--output <path>] [--inputs <path>]
//
// --output   Path for the JSON report (default: reports/certification/tool-certifications.json)
// --inputs   Path to a JSON file mapping tool names to quality signals (optional)
//
// When run without --inputs, all tools receive zero-value Inputs (no signal data),
// which grades every non-destructive tool as Provisional and every destructive tool
// as Uncertified (contract + live signals both fail → blocked by the gate).
// Provide --inputs to inject real signal data from CI (coverage, live validation, chaos).
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"os"

	"github.com/vellankikoti/kubilitics/brain/internal/mcp/certification"
)

func main() {
	outputPath := flag.String("output", "reports/certification/tool-certifications.json", "path for the certification report JSON")
	inputsPath := flag.String("inputs", "", "path to JSON file mapping tool names → certification Inputs (optional)")
	flag.Parse()

	engine := certification.NewEngine()

	if *inputsPath != "" {
		inputs, err := loadInputs(*inputsPath)
		if err != nil {
			log.Fatalf("certify-tools: loading inputs: %v", err)
		}
		engine.SetInputsBulk(inputs)
		log.Printf("certify-tools: loaded quality signals for %d tools from %s", len(inputs), *inputsPath)
	}

	report := engine.Certify()

	if err := certification.WriteJSON(report, *outputPath); err != nil {
		log.Fatalf("certify-tools: %v", err)
	}

	fmt.Printf("Certification report written to %s\n", *outputPath)
	fmt.Printf("  Total tools : %d\n", report.TotalTools)
	fmt.Printf("  Certified   : %d\n", report.Certified)
	fmt.Printf("  Provisional : %d\n", report.Provisional)
	fmt.Printf("  Uncertified : %d\n", report.Uncertified)

	// Print blocked tools for operator awareness.
	blocked := certification.BlockedTools(report)
	if len(blocked) > 0 {
		fmt.Printf("\nBlocked tools (%d) — destructive + uncertified:\n", len(blocked))
		for name, reason := range blocked {
			fmt.Printf("  ✗ %s: %s\n", name, reason)
		}
	} else {
		fmt.Println("\nNo tools blocked — all destructive tools are certified.")
	}
}

// loadInputs reads a JSON file of the form:
//
//	{ "tool_name": { "contract_pass": true, "statement_coverage": 82.5, ... }, ... }
func loadInputs(path string) (map[string]certification.Inputs, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("open %s: %w", path, err)
	}
	defer f.Close()

	// JSON uses snake_case keys matching the Inputs field names via a helper struct.
	type jsonInputs struct {
		ContractPass         bool    `json:"contract_pass"`
		ContractNotes        string  `json:"contract_notes"`
		LiveValidationPass   bool    `json:"live_validation_pass"`
		LiveValidationTested bool    `json:"live_validation_tested"`
		LiveValidationNotes  string  `json:"live_validation_notes"`
		StatementCoverage    float64 `json:"statement_coverage"`
		ChaosPass            bool    `json:"chaos_pass"`
		ChaosTestedCount     int     `json:"chaos_tested_count"`
	}

	raw := make(map[string]jsonInputs)
	if err := json.NewDecoder(f).Decode(&raw); err != nil {
		return nil, fmt.Errorf("decode %s: %w", path, err)
	}

	out := make(map[string]certification.Inputs, len(raw))
	for name, ji := range raw {
		out[name] = certification.Inputs{
			ContractPass:         ji.ContractPass,
			ContractNotes:        ji.ContractNotes,
			LiveValidationPass:   ji.LiveValidationPass,
			LiveValidationTested: ji.LiveValidationTested,
			LiveValidationNotes:  ji.LiveValidationNotes,
			StatementCoverage:    ji.StatementCoverage,
			ChaosPass:            ji.ChaosPass,
			ChaosTestedCount:     ji.ChaosTestedCount,
		}
	}
	return out, nil
}
