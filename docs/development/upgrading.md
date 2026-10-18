# Upgrading Deep Agents, LangChain, or VS Code

Versions are pinned. Before changing any of them:

```bash
npm run check:upgrade && npm run test:vscode
```

`check:upgrade` runs the backend contract tests and fails if `FilesystemBackend` gains a method that
`GatedBackend` does not classify, so a new write path cannot skip the gate. `test:vscode` guards the
undocumented `requestCDPProxy` browser mechanism and shell integration.
