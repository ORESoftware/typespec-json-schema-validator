use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::hash::Hash;

const INTERFACES_REPOSITORY: &str = "https://github.com/shared-auth/shared-auth-interfaces";

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum FactorMethod {
    #[serde(rename = "totp")]
    Totp,
    #[serde(rename = "passkey")]
    Passkey,
    #[serde(rename = "security-key")]
    SecurityKey,
    #[serde(rename = "email-otp")]
    EmailOtp,
    #[serde(rename = "sms-otp")]
    SmsOtp,
    #[serde(rename = "backup-code")]
    BackupCode,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum AuthPage {
    #[serde(rename = "sign-in")]
    SignIn,
    #[serde(rename = "sign-up")]
    SignUp,
    #[serde(rename = "challenge")]
    Challenge,
    #[serde(rename = "recovery")]
    Recovery,
    #[serde(rename = "consent")]
    Consent,
    #[serde(rename = "error")]
    Error,
    #[serde(rename = "signed-out")]
    SignedOut,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum Theme {
    #[serde(rename = "system")]
    System,
    #[serde(rename = "light")]
    Light,
    #[serde(rename = "dark")]
    Dark,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CommitRange {
    pub base: String,
    pub head: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExactCompatibility {
    pub repository: String,
    pub commit: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RangeCompatibility {
    pub repository: String,
    pub range: CommitRange,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum Compatibility {
    Exact(ExactCompatibility),
    Range(RangeCompatibility),
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TwoFactorPolicy {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub required: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub methods: Option<Vec<FactorMethod>>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ThreeFactorPolicy {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub enabled: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub methods: Option<Vec<FactorMethod>>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FactorsPolicy {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub two_factor: Option<TwoFactorPolicy>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub three_factor: Option<ThreeFactorPolicy>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PagesPolicy {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub show: Option<Vec<AuthPage>>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StylingPolicy {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub theme: Option<Theme>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub brand_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub accent_color: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SharedAuthConfigFile {
    // `serde_json::Number` intentionally preserves JSON numeric wire semantics.
    // Draft 2020-12 `integer` admits mathematically integral spellings such as
    // `1.0`, while the canonical TOML surface still uses `schema_version = 1`.
    pub schema_version: serde_json::Number,
    pub compatibility: Compatibility,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub factors: Option<FactorsPolicy>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pages: Option<PagesPolicy>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub styling: Option<StylingPolicy>,
}

pub fn parse_shared_auth_config_json(input: &str) -> Result<SharedAuthConfigFile, String> {
    let parsed: SharedAuthConfigFile =
        serde_json::from_str(input).map_err(|error| error.to_string())?;
    validate(&parsed)?;
    Ok(parsed)
}

fn validate(config: &SharedAuthConfigFile) -> Result<(), String> {
    validate_schema_version(&config.schema_version)?;
    match &config.compatibility {
        Compatibility::Exact(value) => {
            validate_repository(&value.repository)?;
            validate_sha(&value.commit)?;
        }
        Compatibility::Range(value) => {
            validate_repository(&value.repository)?;
            validate_sha(&value.range.base)?;
            validate_sha(&value.range.head)?;
        }
    }
    if let Some(factors) = &config.factors {
        if let Some(policy) = &factors.two_factor {
            if let Some(methods) = &policy.methods {
                validate_set(methods)?;
            }
        }
        if let Some(policy) = &factors.three_factor {
            if let Some(methods) = &policy.methods {
                validate_set(methods)?;
            }
        }
    }
    if let Some(pages) = &config.pages {
        if let Some(show) = &pages.show {
            validate_set(show)?;
        }
    }
    if let Some(styling) = &config.styling {
        if let Some(brand_name) = &styling.brand_name {
            let length = brand_name.chars().count();
            if !(1..=80).contains(&length) {
                return Err("styling.brand_name is outside the contract bounds".into());
            }
        }
        if let Some(accent_color) = &styling.accent_color {
            let bytes = accent_color.as_bytes();
            if bytes.len() != 7
                || bytes[0] != b'#'
                || !bytes[1..].iter().all(u8::is_ascii_hexdigit)
            {
                return Err("styling.accent_color is not a six-digit hexadecimal color".into());
            }
        }
    }
    Ok(())
}

fn validate_schema_version(value: &serde_json::Number) -> Result<(), String> {
    let admitted = value.as_u64() == Some(1)
        || value.as_i64() == Some(1)
        || value
            .as_f64()
            .is_some_and(|number| number == 1.0 && number.fract() == 0.0);
    if admitted {
        Ok(())
    } else {
        Err("schema_version must equal integer 1".into())
    }
}

fn validate_repository(value: &str) -> Result<(), String> {
    if value == INTERFACES_REPOSITORY {
        Ok(())
    } else {
        Err("compatibility.repository does not name the Shared Auth interfaces authority".into())
    }
}

fn validate_sha(value: &str) -> Result<(), String> {
    if value.len() == 40
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        Ok(())
    } else {
        Err("compatibility revision is not a lowercase 40-character Git SHA".into())
    }
}

fn validate_set<T>(values: &[T]) -> Result<(), String>
where
    T: Eq + Hash,
{
    if values.is_empty() {
        return Err("contract set must contain at least one value".into());
    }
    let mut seen = HashSet::with_capacity(values.len());
    if values.iter().all(|value| seen.insert(value)) {
        Ok(())
    } else {
        Err("contract set contains a duplicate value".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{fs, path::PathBuf};

    fn corpus_root() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../instances/SharedAuthConfigFile")
    }

    fn fixtures(kind: &str) -> Vec<PathBuf> {
        let mut fixtures = fs::read_dir(corpus_root().join(kind))
            .expect("TJSV fixture directory must exist")
            .map(|entry| entry.expect("TJSV fixture entry must be readable").path())
            .filter(|path| path.extension().and_then(|value| value.to_str()) == Some("json"))
            .collect::<Vec<_>>();
        fixtures.sort();
        assert!(!fixtures.is_empty(), "TJSV corpus must contain {kind} fixtures");
        fixtures
    }

    fn read_fixture(path: &PathBuf) -> String {
        fs::read_to_string(path).expect("TJSV fixture must be readable as UTF-8 JSON")
    }

    #[test]
    fn ingress_matches_the_entire_tjsv_corpus() {
        for path in fixtures("valid") {
            let input = read_fixture(&path);
            parse_shared_auth_config_json(&input).unwrap_or_else(|error| {
                panic!("valid TJSV fixture {} was rejected: {error}", path.display())
            });
        }

        for path in fixtures("invalid") {
            let input = read_fixture(&path);
            assert!(
                parse_shared_auth_config_json(&input).is_err(),
                "invalid TJSV fixture {} must be rejected by Rust",
                path.display()
            );
        }
    }

    #[test]
    fn egress_preserves_every_admitted_wire_shape() {
        for path in fixtures("valid") {
            let input = read_fixture(&path);
            let parsed = parse_shared_auth_config_json(&input).unwrap_or_else(|error| {
                panic!("valid TJSV fixture {} was rejected: {error}", path.display())
            });
            let encoded = serde_json::to_string(&parsed).expect("runtime evidence must serialize");
            let expected: serde_json::Value =
                serde_json::from_str(&input).expect("fixture must be JSON");
            let emitted: serde_json::Value =
                serde_json::from_str(&encoded).expect("runtime output must be JSON");
            assert_eq!(
                expected,
                emitted,
                "Rust egress must preserve fixture {} without null/default drift",
                path.display()
            );
            let reparsed = parse_shared_auth_config_json(&encoded)
                .expect("serialized form must remain admissible");
            assert_eq!(parsed, reparsed);
        }
    }
}
