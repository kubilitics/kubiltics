// Phase 2 / Gap 5 — E2E round-trip regression for the AI Settings flow.
//
// Tests exercise save → simulated-restart → load → test_llm_connection
// end-to-end using the encrypted file store (secure_store). No OS keychain
// is touched; a temp directory is used for YAML + secrets.

use serde_json::json;
use wiremock::matchers::{header, method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

use super::*;

fn scoped_config_dir() -> tempfile::TempDir {
    // Route secure_store and app_config_dir() into a temp directory so tests
    // don't clobber the developer's real kubilitics config.
    let tmp = tempfile::tempdir().expect("tempdir");
    // secure_store uses dirs::config_dir() which reads HOME on macOS and
    // XDG_CONFIG_HOME on Linux.
    unsafe {
        std::env::set_var("XDG_CONFIG_HOME", tmp.path());
        std::env::set_var("HOME", tmp.path());
    }
    tmp
}

#[tokio::test]
#[serial_test::serial(ai_config_global_state)]
async fn e2e_save_restart_load_roundtrip_preserves_keychain() {
    let _tmp = scoped_config_dir();

    let cfg = AIConfig {
        provider: "openai".to_string(),
        model: "gpt-4o".to_string(),
        base_url: "".to_string(),
        api_key: Some("sk-roundtrip-0123456789abcdef".to_string()),
        has_api_key: false,
    };

    save_ai_config_inner(&cfg, "").await.expect("save");

    // --- simulate process restart ---
    // There's no in-memory struct to drop; calling load_ai_config in
    // a fresh async scope is sufficient to prove the YAML + secure store
    // survived across what would be a binary relaunch.

    let loaded = load_ai_config().await.expect("load");
    assert_eq!(loaded.provider, "openai");
    assert_eq!(loaded.model, "gpt-4o");
    assert_eq!(loaded.base_url, "");
    assert!(loaded.has_api_key, "secure store round-trip lost the key");
    assert!(
        loaded.api_key.is_none(),
        "load_ai_config must NEVER return the raw key to the webview"
    );
}

#[tokio::test]
#[serial_test::serial(ai_config_global_state)]
async fn e2e_test_llm_connection_sends_stored_key_as_bearer() {
    let _tmp = scoped_config_dir();

    // 1) Stash the key via save_ai_config.
    let stored_key = "sk-bearer-check-9876543210";
    save_ai_config_inner(&AIConfig {
        provider: "openai".to_string(),
        model: "gpt-4o".to_string(),
        base_url: "".to_string(),
        api_key: Some(stored_key.to_string()),
        has_api_key: false,
    }, "")
    .await
    .expect("save");

    // 2) Spin up a mock OpenAI-compatible endpoint that REQUIRES the
    //    Authorization header to match the stored key.
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/chat/completions"))
        .and(header(
            "authorization",
            format!("Bearer {}", stored_key).as_str(),
        ))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "choices": [{"message": {"role": "assistant", "content": "pong"}}]
        })))
        .expect(1)
        .mount(&server)
        .await;

    // 3) Invoke test_llm_connection with the mock's URL + NO api_key in
    //    the payload — the secure_store path is the only way the handler
    //    can assemble the Bearer header, so a 200 response proves the
    //    stored key was retrieved + sent.
    let res = test_llm_connection(AIConfig {
        provider: "openai".to_string(),
        model: "gpt-4o".to_string(),
        base_url: server.uri(),
        api_key: None,
        has_api_key: true,
    })
    .await
    .expect("test_llm_connection returned an error");
    assert!(res.ok, "HTTP round-trip failed: {:?}", res.error);
    assert_eq!(res.status, 200);
    // wiremock's `.expect(1)` makes the mock panic on Drop if the
    // request never fired or the headers didn't match.
}
