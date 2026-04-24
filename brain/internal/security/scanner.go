package security

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

// Severity represents vulnerability severity levels
type Severity string

const (
	SeverityCritical Severity = "CRITICAL"
	SeverityHigh     Severity = "HIGH"
	SeverityMedium   Severity = "MEDIUM"
	SeverityLow      Severity = "LOW"
	SeverityInfo     Severity = "INFO"
	SeverityUnknown  Severity = "UNKNOWN"
)

// Vulnerability represents a CVE vulnerability
type Vulnerability struct {
	CVEID         string    `json:"cve_id"`
	Severity      Severity  `json:"severity"`
	Score         float64   `json:"score"` // CVSS score
	Package       string    `json:"package"`
	Version       string    `json:"version"`
	FixedVersion  string    `json:"fixed_version,omitempty"`
	Description   string    `json:"description"`
	PublishedDate time.Time `json:"published_date"`
	LastModified  time.Time `json:"last_modified"`
	References    []string  `json:"references,omitempty"`
}

// ImageScanResult represents the scan result for a container image
type ImageScanResult struct {
	Image           string          `json:"image"`
	Tag             string          `json:"tag"`
	Digest          string          `json:"digest,omitempty"`
	ScanTime        time.Time       `json:"scan_time"`
	Vulnerabilities []Vulnerability `json:"vulnerabilities"`
	Summary         VulnSummary     `json:"summary"`

	// Flat convenience fields (mirrors Summary + risk assessment)
	VulnerabilityCount int     `json:"vulnerability_count"`
	CriticalCount      int     `json:"critical_count"`
	HighCount          int     `json:"high_count"`
	MediumCount        int     `json:"medium_count"`
	LowCount           int     `json:"low_count"`
	InfoCount          int     `json:"info_count"`
	RiskScore          float64 `json:"risk_score"` // 0-100
	RiskLevel          string  `json:"risk_level"` // CRITICAL, HIGH, MEDIUM, LOW, MINIMAL
}

// VulnSummary provides a summary of vulnerabilities
type VulnSummary struct {
	Total    int `json:"total"`
	Critical int `json:"critical"`
	High     int `json:"high"`
	Medium   int `json:"medium"`
	Low      int `json:"low"`
	Unknown  int `json:"unknown"`
}

// Scanner performs vulnerability scanning
type Scanner struct {
	vulnDB *VulnerabilityDatabase
}

// NewScanner creates a new vulnerability scanner
func NewScanner() *Scanner {
	return &Scanner{
		vulnDB: NewVulnerabilityDatabase(),
	}
}

// ScanImage scans a container image for vulnerabilities
func (s *Scanner) ScanImage(image string) (*ImageScanResult, error) {
	// Parse image name and tag
	imageName, tag := parseImageName(image)

	// In production, this would:
	// 1. Pull image manifest
	// 2. Extract layers
	// 3. Scan for packages
	// 4. Query CVE databases
	// 5. Return vulnerabilities

	// For now, return simulated vulnerabilities based on image patterns
	vulns := s.simulateVulnerabilityScan(imageName, tag)

	summary := calculateSummary(vulns)

	riskScore, riskLevel := calculateRisk(summary)

	result := &ImageScanResult{
		Image:              image, // preserve original full image string
		Tag:                tag,
		ScanTime:           time.Now(),
		Vulnerabilities:    vulns,
		Summary:            summary,
		VulnerabilityCount: summary.Total,
		CriticalCount:      summary.Critical,
		HighCount:          summary.High,
		MediumCount:        summary.Medium,
		LowCount:           summary.Low,
		InfoCount:          summary.Unknown,
		RiskScore:          riskScore,
		RiskLevel:          riskLevel,
	}

	return result, nil
}

// simulateVulnerabilityScan simulates vulnerability scanning
func (s *Scanner) simulateVulnerabilityScan(image, tag string) []Vulnerability {
	vulns := make([]Vulnerability, 0)

	// Simulate vulnerabilities based on common patterns
	// In production, this would query actual CVE databases

	// Old versions have more vulnerabilities
	if strings.Contains(tag, "latest") || tag == "" {
		// Latest might have fewer issues
		vulns = append(vulns, s.generateSampleVulnerabilities(2, 3, 5)...)
	} else if isOldVersion(tag) {
		// Old versions have more critical issues
		vulns = append(vulns, s.generateSampleVulnerabilities(5, 8, 12)...)
	} else {
		// Recent versions have moderate issues
		vulns = append(vulns, s.generateSampleVulnerabilities(1, 4, 8)...)
	}

	// Base image vulnerabilities
	if strings.Contains(image, "alpine") {
		vulns = append(vulns, Vulnerability{
			CVEID:         "CVE-2024-1234",
			Severity:      SeverityMedium,
			Score:         5.5,
			Package:       "musl-libc",
			Version:       "1.2.3",
			FixedVersion:  "1.2.4",
			Description:   "Buffer overflow in musl libc string handling",
			PublishedDate: time.Now().AddDate(0, -2, 0),
		})
	}

	if strings.Contains(image, "ubuntu") || strings.Contains(image, "debian") {
		vulns = append(vulns, Vulnerability{
			CVEID:         "CVE-2024-5678",
			Severity:      SeverityLow,
			Score:         3.2,
			Package:       "openssl",
			Version:       "1.1.1",
			FixedVersion:  "1.1.1w",
			Description:   "Memory leak in OpenSSL certificate validation",
			PublishedDate: time.Now().AddDate(0, -1, 0),
		})
	}

	// Node.js vulnerabilities
	if strings.Contains(image, "node") {
		vulns = append(vulns, Vulnerability{
			CVEID:         "CVE-2024-9012",
			Severity:      SeverityHigh,
			Score:         8.1,
			Package:       "node",
			Version:       "16.0.0",
			FixedVersion:  "16.20.2",
			Description:   "Prototype pollution in Node.js HTTP parser",
			PublishedDate: time.Now().AddDate(0, -1, -15),
			References: []string{
				"https://nodejs.org/en/blog/vulnerability/",
			},
		})
	}

	return vulns
}

// generateSampleVulnerabilities generates sample vulnerabilities
func (s *Scanner) generateSampleVulnerabilities(critical, high, medium int) []Vulnerability {
	vulns := make([]Vulnerability, 0)

	// Critical vulnerabilities
	for i := 0; i < critical; i++ {
		vulns = append(vulns, Vulnerability{
			CVEID:         fmt.Sprintf("CVE-2024-%04d", 1000+i),
			Severity:      SeverityCritical,
			Score:         9.0 + float64(i%10)/10,
			Package:       fmt.Sprintf("package-%d", i),
			Version:       "1.0.0",
			FixedVersion:  "1.0.1",
			Description:   "Critical security vulnerability",
			PublishedDate: time.Now().AddDate(0, 0, -i),
		})
	}

	// High vulnerabilities
	for i := 0; i < high; i++ {
		vulns = append(vulns, Vulnerability{
			CVEID:         fmt.Sprintf("CVE-2024-%04d", 2000+i),
			Severity:      SeverityHigh,
			Score:         7.0 + float64(i%10)/10,
			Package:       fmt.Sprintf("package-%d", i+100),
			Version:       "2.0.0",
			FixedVersion:  "2.0.1",
			Description:   "High severity security issue",
			PublishedDate: time.Now().AddDate(0, 0, -i*2),
		})
	}

	// Medium vulnerabilities
	for i := 0; i < medium; i++ {
		vulns = append(vulns, Vulnerability{
			CVEID:         fmt.Sprintf("CVE-2024-%04d", 3000+i),
			Severity:      SeverityMedium,
			Score:         4.0 + float64(i%10)/10,
			Package:       fmt.Sprintf("package-%d", i+200),
			Version:       "3.0.0",
			FixedVersion:  "3.0.1",
			Description:   "Medium severity security issue",
			PublishedDate: time.Now().AddDate(0, 0, -i*3),
		})
	}

	return vulns
}

// parseImageName parses image name into name and tag
func parseImageName(image string) (string, string) {
	parts := strings.Split(image, ":")
	if len(parts) == 2 {
		return parts[0], parts[1]
	}
	return image, "latest"
}

// isOldVersion checks if a tag represents an old version
func isOldVersion(tag string) bool {
	// Simple heuristic: versions < 2.0 or tags with "old", "legacy"
	if strings.Contains(tag, "old") || strings.Contains(tag, "legacy") {
		return true
	}

	// Check semantic version
	if strings.HasPrefix(tag, "1.") || strings.HasPrefix(tag, "0.") {
		return true
	}

	return false
}

// calculateSummary calculates vulnerability summary
func calculateSummary(vulns []Vulnerability) VulnSummary {
	summary := VulnSummary{
		Total: len(vulns),
	}

	for _, v := range vulns {
		switch v.Severity {
		case SeverityCritical:
			summary.Critical++
		case SeverityHigh:
			summary.High++
		case SeverityMedium:
			summary.Medium++
		case SeverityLow:
			summary.Low++
		default:
			summary.Unknown++
		}
	}

	return summary
}

// calculateRisk computes a 0-100 risk score and level from a vulnerability summary.
func calculateRisk(s VulnSummary) (float64, string) {
	// Weighted scoring: critical=10, high=5, medium=2, low=0.5
	raw := float64(s.Critical)*10 + float64(s.High)*5 + float64(s.Medium)*2 + float64(s.Low)*0.5
	// Normalize: cap at 100
	score := raw
	if score > 100 {
		score = 100
	}

	var level string
	switch {
	case s.Critical > 0 || score >= 80:
		level = "CRITICAL"
	case s.High > 0 || score >= 60:
		level = "HIGH"
	case s.Medium > 0 || score >= 30:
		level = "MEDIUM"
	case s.Low > 0 || score >= 10:
		level = "LOW"
	default:
		level = "MINIMAL"
	}

	return score, level
}

// GetVulnerabilityByID retrieves details for a specific CVE
func (s *Scanner) GetVulnerabilityByID(cveID string) (*Vulnerability, error) {
	return s.vulnDB.GetVulnerability(cveID)
}

// FilterVulnerabilities filters vulnerabilities by severity
func FilterVulnerabilities(vulns []Vulnerability, minSeverity Severity) []Vulnerability {
	severityOrder := map[Severity]int{
		SeverityCritical: 4,
		SeverityHigh:     3,
		SeverityMedium:   2,
		SeverityLow:      1,
		SeverityUnknown:  0,
	}

	minLevel := severityOrder[minSeverity]
	filtered := make([]Vulnerability, 0)

	for _, v := range vulns {
		if severityOrder[v.Severity] >= minLevel {
			filtered = append(filtered, v)
		}
	}

	return filtered
}

// VulnerabilityDatabase simulates a CVE database
type VulnerabilityDatabase struct {
	vulns map[string]*Vulnerability
}

// NewVulnerabilityDatabase creates a new vulnerability database
func NewVulnerabilityDatabase() *VulnerabilityDatabase {
	return &VulnerabilityDatabase{
		vulns: make(map[string]*Vulnerability),
	}
}

// GetVulnerability retrieves a vulnerability by CVE ID
func (db *VulnerabilityDatabase) GetVulnerability(cveID string) (*Vulnerability, error) {
	// In production, this would query NVD, GitHub Security Advisories, etc.
	if v, exists := db.vulns[cveID]; exists {
		return v, nil
	}

	// Return simulated vulnerability
	return &Vulnerability{
		CVEID:         cveID,
		Severity:      SeverityMedium,
		Score:         5.0,
		Description:   fmt.Sprintf("Vulnerability %s", cveID),
		PublishedDate: time.Now().AddDate(0, -1, 0),
	}, nil
}

// ToJSON converts ImageScanResult to JSON
func (r *ImageScanResult) ToJSON() (string, error) {
	bytes, err := json.MarshalIndent(r, "", "  ")
	if err != nil {
		return "", err
	}
	return string(bytes), nil
}
