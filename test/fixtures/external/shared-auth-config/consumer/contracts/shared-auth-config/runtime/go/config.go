package sharedauthconfig

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"regexp"
	"unicode/utf8"
)

const interfacesRepository = "https://github.com/shared-auth/shared-auth-interfaces"

var (
	gitSHA = regexp.MustCompile(`^[0-9a-f]{40}$`)
	accent = regexp.MustCompile(`^#[0-9A-Fa-f]{6}$`)
)

type FactorMethod string

const (
	FactorTOTP        FactorMethod = "totp"
	FactorPasskey     FactorMethod = "passkey"
	FactorSecurityKey FactorMethod = "security-key"
	FactorEmailOTP    FactorMethod = "email-otp"
	FactorSMSOTP      FactorMethod = "sms-otp"
	FactorBackupCode  FactorMethod = "backup-code"
)

type AuthPage string

const (
	PageSignIn    AuthPage = "sign-in"
	PageSignUp    AuthPage = "sign-up"
	PageChallenge AuthPage = "challenge"
	PageRecovery  AuthPage = "recovery"
	PageConsent   AuthPage = "consent"
	PageError     AuthPage = "error"
	PageSignedOut AuthPage = "signed-out"
)

type Theme string

const (
	ThemeSystem Theme = "system"
	ThemeLight  Theme = "light"
	ThemeDark   Theme = "dark"
)

type CommitRange struct {
	Base string `json:"base"`
	Head string `json:"head"`
}

type Compatibility struct {
	Repository string       `json:"repository"`
	Commit     *string      `json:"commit,omitempty"`
	Range      *CommitRange `json:"range,omitempty"`
}

type TwoFactorPolicy struct {
	Required *bool          `json:"required,omitempty"`
	Methods  []FactorMethod `json:"methods,omitempty"`
}

type ThreeFactorPolicy struct {
	Enabled *bool          `json:"enabled,omitempty"`
	Methods []FactorMethod `json:"methods,omitempty"`
}

type FactorsPolicy struct {
	TwoFactor   *TwoFactorPolicy   `json:"two_factor,omitempty"`
	ThreeFactor *ThreeFactorPolicy `json:"three_factor,omitempty"`
}

type PagesPolicy struct {
	Show []AuthPage `json:"show,omitempty"`
}

type StylingPolicy struct {
	Theme       *Theme  `json:"theme,omitempty"`
	BrandName   *string `json:"brand_name,omitempty"`
	AccentColor *string `json:"accent_color,omitempty"`
}

type SharedAuthConfigFile struct {
	SchemaVersion int             `json:"schema_version"`
	Compatibility Compatibility   `json:"compatibility"`
	Factors       *FactorsPolicy  `json:"factors,omitempty"`
	Pages         *PagesPolicy    `json:"pages,omitempty"`
	Styling       *StylingPolicy  `json:"styling,omitempty"`
}

func ParseJSON(input []byte) (SharedAuthConfigFile, error) {
	decoder := json.NewDecoder(bytes.NewReader(input))
	decoder.DisallowUnknownFields()

	var config SharedAuthConfigFile
	if err := decoder.Decode(&config); err != nil {
		return SharedAuthConfigFile{}, err
	}
	if err := requireEOF(decoder); err != nil {
		return SharedAuthConfigFile{}, err
	}
	if err := config.Validate(); err != nil {
		return SharedAuthConfigFile{}, err
	}
	return config, nil
}

func requireEOF(decoder *json.Decoder) error {
	var extra any
	if err := decoder.Decode(&extra); errors.Is(err, io.EOF) {
		return nil
	} else if err != nil {
		return err
	}
	return errors.New("shared-auth config contains more than one JSON value")
}

func (config SharedAuthConfigFile) Validate() error {
	if config.SchemaVersion != 1 {
		return errors.New("schema_version must equal 1")
	}
	if err := config.Compatibility.Validate(); err != nil {
		return err
	}
	if config.Factors != nil {
		if config.Factors.TwoFactor != nil && config.Factors.TwoFactor.Methods != nil {
			if err := validateFactorSet(config.Factors.TwoFactor.Methods); err != nil {
				return fmt.Errorf("factors.two_factor.methods: %w", err)
			}
		}
		if config.Factors.ThreeFactor != nil && config.Factors.ThreeFactor.Methods != nil {
			if err := validateFactorSet(config.Factors.ThreeFactor.Methods); err != nil {
				return fmt.Errorf("factors.three_factor.methods: %w", err)
			}
		}
	}
	if config.Pages != nil && config.Pages.Show != nil {
		if err := validatePageSet(config.Pages.Show); err != nil {
			return fmt.Errorf("pages.show: %w", err)
		}
	}
	if config.Styling != nil {
		if config.Styling.Theme != nil && !validTheme(*config.Styling.Theme) {
			return errors.New("styling.theme is not a supported theme")
		}
		if config.Styling.BrandName != nil {
			length := utf8.RuneCountInString(*config.Styling.BrandName)
			if length < 1 || length > 80 {
				return errors.New("styling.brand_name is outside the contract bounds")
			}
		}
		if config.Styling.AccentColor != nil && !accent.MatchString(*config.Styling.AccentColor) {
			return errors.New("styling.accent_color is not a six-digit hexadecimal color")
		}
	}
	return nil
}

func (compat Compatibility) Validate() error {
	if compat.Repository != interfacesRepository {
		return errors.New("compatibility.repository is not the Shared Auth interfaces authority")
	}
	if (compat.Commit == nil) == (compat.Range == nil) {
		return errors.New("compatibility must select exactly one of commit or range")
	}
	if compat.Commit != nil {
		if !gitSHA.MatchString(*compat.Commit) {
			return errors.New("compatibility.commit is not a lowercase 40-character Git SHA")
		}
		return nil
	}
	if !gitSHA.MatchString(compat.Range.Base) || !gitSHA.MatchString(compat.Range.Head) {
		return errors.New("compatibility.range must contain lowercase 40-character Git SHAs")
	}
	return nil
}

func validFactor(value FactorMethod) bool {
	switch value {
	case FactorTOTP, FactorPasskey, FactorSecurityKey, FactorEmailOTP, FactorSMSOTP, FactorBackupCode:
		return true
	default:
		return false
	}
}

func validPage(value AuthPage) bool {
	switch value {
	case PageSignIn, PageSignUp, PageChallenge, PageRecovery, PageConsent, PageError, PageSignedOut:
		return true
	default:
		return false
	}
}

func validTheme(value Theme) bool {
	switch value {
	case ThemeSystem, ThemeLight, ThemeDark:
		return true
	default:
		return false
	}
}

func validateFactorSet(values []FactorMethod) error {
	if len(values) == 0 {
		return errors.New("must contain at least one value")
	}
	seen := make(map[FactorMethod]struct{}, len(values))
	for _, value := range values {
		if !validFactor(value) {
			return errors.New("contains an unknown factor method")
		}
		if _, duplicate := seen[value]; duplicate {
			return errors.New("contains a duplicate value")
		}
		seen[value] = struct{}{}
	}
	return nil
}

func validatePageSet(values []AuthPage) error {
	if len(values) == 0 {
		return errors.New("must contain at least one value")
	}
	seen := make(map[AuthPage]struct{}, len(values))
	for _, value := range values {
		if !validPage(value) {
			return errors.New("contains an unknown page")
		}
		if _, duplicate := seen[value]; duplicate {
			return errors.New("contains a duplicate value")
		}
		seen[value] = struct{}{}
	}
	return nil
}
