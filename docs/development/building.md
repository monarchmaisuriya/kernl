# Building and installing locally

## Build

```bash
npm ci
npm run build                          # extension and webview into out/
node scripts/build.mjs --tests         # also every test entry
node scripts/build.mjs --production    # minified, as packaged
```

## Package and install

```bash
npm run package                        # production build, then kernl.vsix
code --install-extension kernl.vsix --force
```

Then run **Developer: Reload Window** in VS Code. Until the reload, the window keeps running the previously installed build.

On macOS without `code` on the PATH, use `"/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code"`.

## Check the installed build

The installed copy lives in `~/.vscode/extensions/local.kernl-<version>/`. To confirm it matches what you built:

```bash
cmp out/extension.cjs ~/.vscode/extensions/local.kernl-0.1.0/out/extension.cjs && echo INSTALLED MATCHES
```

The packaged README (the extension's Details page in VS Code) links into this repository on GitHub; `package.json`'s `repository` field is what lets `vsce` rewrite those links.
