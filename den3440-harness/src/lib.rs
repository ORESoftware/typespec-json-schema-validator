mod admission;

mod state {
    use std::sync::Arc;

    #[derive(Clone)]
    pub(crate) struct Config {
        pub(crate) github_recovery_enabled: bool,
        pub(crate) github_recovery_token: Option<String>,
    }

    #[derive(Clone, Debug)]
    pub(crate) struct Database;

    #[derive(Clone)]
    pub(crate) struct AppState {
        pub(crate) config: Arc<Config>,
        pub(crate) db: Option<Database>,
    }
}

mod db {
    use crate::state::Database;

    pub(crate) async fn record_recovery_receipt_strict(
        _db: &Database,
        _recovery_key: &str,
        _repo: &str,
        _head_sha: &str,
        _action: &str,
    ) -> Result<bool, ()> {
        Ok(true)
    }
}

#[allow(dead_code)]
mod recovery;
