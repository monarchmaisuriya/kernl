# Tests

```bash
npm run test:unit      # gate, backend contract, session/Stop, MCP, tracing on/off, panel click-through (jsdom)
npm run test:vscode    # real VS Code: editor edits + Undo, terminal, Stop, integrated browser, CLI agents, real panel round trips
npm run smoke          # real models with your keys (see test/smoke.ts for env vars)
npm run probe:agents   # installed CLI agents: rejected write must not happen (tiny prompt each)
npm run test:live      # installed CLI agents through the real controller: approve, follow-up, reject, Stop;
                       # Claude Code with a stored key must send only that key (localhost capture);
                       # DeepSeek checks need DEEPSEEK_API_KEY
```
