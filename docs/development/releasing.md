# Releasing

kernl uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html) and keeps a [changelog](../../CHANGELOG.md) in the [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format.

## Versions

- **Patch** (0.2.1): fixes only.
- **Minor** (0.3.0): new features. Before 1.0.0, a breaking change (a renamed setting, a removed command) is also a minor release, and its changelog line says what to change.
- **Major** (1.0.0): from 1.0.0 on, breaking changes.

## With every change

Add a line under `## [Unreleased]` in `CHANGELOG.md`, in the same commit, under **Added**, **Changed**, **Fixed**, **Removed**, or **Security**. Write it for someone using kernl: what changed for them, not which files.

## Making a release

From a clean `main`:

```bash
npm run release -- minor --dry-run
```

```bash
npm run release -- minor
```

The script refuses on another branch, with uncommitted changes, with an empty "Unreleased", or when the tag exists. Otherwise it runs the unit tests, raises the version in `package.json` and `package-lock.json`, moves "Unreleased" to the new version with today's date, builds `kernl-X.Y.Z.vsix`, commits "Release vX.Y.Z", and makes the annotated tag `vX.Y.Z`. Run `npm run test:vscode` before it: the release script runs only the unit tests.

It pushes nothing. It prints the two publish commands:

```bash
git push origin main vX.Y.Z
```

```bash
gh release create vX.Y.Z kernl-X.Y.Z.vsix --title "kernl X.Y.Z" --notes-file out/release-notes-X.Y.Z.md
```

## Installing a release

Download `kernl-X.Y.Z.vsix` from the GitHub release, then:

```bash
code --install-extension kernl-X.Y.Z.vsix --force
```

Reload the window (**Developer: Reload Window**) to start the new version.

## Undoing a release

Delete the GitHub release and its tag (`gh release delete vX.Y.Z --cleanup-tag`), then revert the release commit. Released VSIX files people already installed keep working.
