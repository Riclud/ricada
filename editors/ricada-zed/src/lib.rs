use zed_extension_api as zed;

const DEV_SERVER_PATH: &str = "/home/user/REPOSITORIES/PUBLIC/ricada/packages/lsp/src/server.ts";

struct RicadaExtension;

impl zed::Extension for RicadaExtension {
    fn new() -> Self {
        RicadaExtension
    }

    fn language_server_command(
        &mut self,
        _language_server_id: &zed::LanguageServerId,
        worktree: &zed::Worktree,
    ) -> zed::Result<zed::Command> {
        let bun = worktree
            .which("bun")
            .ok_or_else(|| "bun was not found in PATH".to_string())?;

        let root = worktree.root_path();
        let relative = "packages/lsp/src/server.ts";

        let server = match worktree.read_text_file(relative) {
            Ok(_) => format!("{root}/{relative}"),
            Err(_) => DEV_SERVER_PATH.to_string(),
        };

        Ok(zed::Command {
            command: bun,
            args: vec!["run".to_string(), server, "--stdio".to_string()],
            env: Vec::new(),
        })
    }
}

zed::register_extension!(RicadaExtension);
