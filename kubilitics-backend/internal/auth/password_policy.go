package auth

import (
	"fmt"
	"regexp"
	"strings"
)

// PasswordPolicy defines password complexity requirements
type PasswordPolicy struct {
	MinLength        int
	RequireUppercase bool
	RequireLowercase bool
	RequireNumbers   bool
	RequireSpecial   bool
}

// DefaultPasswordPolicy returns the default password policy
func DefaultPasswordPolicy() PasswordPolicy {
	return PasswordPolicy{
		MinLength:        12,
		RequireUppercase: true,
		RequireLowercase: true,
		RequireNumbers:   true,
		RequireSpecial:   true,
	}
}

// ValidatePassword checks if password meets policy requirements
func ValidatePassword(password string, policy PasswordPolicy) error {
	if len(password) < policy.MinLength {
		return fmt.Errorf("password must be at least %d characters long", policy.MinLength)
	}

	if policy.RequireUppercase {
		hasUpper, _ := regexp.MatchString(`[A-Z]`, password)
		if !hasUpper {
			return fmt.Errorf("password must contain at least one uppercase letter")
		}
	}

	if policy.RequireLowercase {
		hasLower, _ := regexp.MatchString(`[a-z]`, password)
		if !hasLower {
			return fmt.Errorf("password must contain at least one lowercase letter")
		}
	}

	if policy.RequireNumbers {
		hasNumber, _ := regexp.MatchString(`[0-9]`, password)
		if !hasNumber {
			return fmt.Errorf("password must contain at least one number")
		}
	}

	if policy.RequireSpecial {
		hasSpecial, _ := regexp.MatchString(`[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]`, password)
		if !hasSpecial {
			return fmt.Errorf("password must contain at least one special character")
		}
	}

	return nil
}

// CalculatePasswordStrength returns a strength score (0-100) for a password
func CalculatePasswordStrength(password string) int {
	score := 0

	// Length contribution (max 40 points)
	if len(password) >= 12 {
		score += 20
	}
	if len(password) >= 16 {
		score += 10
	}
	if len(password) >= 20 {
		score += 10
	}

	// Character variety (max 40 points)
	hasUpper, _ := regexp.MatchString(`[A-Z]`, password)
	hasLower, _ := regexp.MatchString(`[a-z]`, password)
	hasNumber, _ := regexp.MatchString(`[0-9]`, password)
	hasSpecial, _ := regexp.MatchString(`[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]`, password)

	varietyCount := 0
	if hasUpper {
		varietyCount++
	}
	if hasLower {
		varietyCount++
	}
	if hasNumber {
		varietyCount++
	}
	if hasSpecial {
		varietyCount++
	}
	score += varietyCount * 10

	// Complexity bonus (max 20 points)
	if len(password) >= 12 && varietyCount >= 3 {
		score += 10
	}
	if len(password) >= 16 && varietyCount >= 4 {
		score += 10
	}

	if score > 100 {
		score = 100
	}

	return score
}

// GetPasswordStrengthLabel returns a human-readable strength label
func GetPasswordStrengthLabel(strength int) string {
	if strength < 30 {
		return "Weak"
	} else if strength < 60 {
		return "Fair"
	} else if strength < 80 {
		return "Good"
	} else {
		return "Strong"
	}
}

// CheckCommonPasswords checks if password is in a list of common passwords
func CheckCommonPasswords(password string) bool {
	commonPasswords := []string{
		"password", "123456", "123456789", "12345678", "12345",
		"1234567", "1234567890", "qwerty", "abc123", "monkey",
		"1234567890", "letmein", "trustno1", "dragon", "baseball",
		"iloveyou", "master", "sunshine", "ashley", "bailey",
		"passw0rd", "shadow", "123123", "654321", "superman",
		"qazwsx", "michael", "football", "welcome", "jesus",
		"ninja", "mustang", "password1", "123qwe", "admin",
	}

	passwordLower := strings.ToLower(password)
	for _, common := range commonPasswords {
		if passwordLower == common || strings.Contains(passwordLower, common) {
			return true
		}
	}
	return false
}
