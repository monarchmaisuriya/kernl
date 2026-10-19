// Which shell commands fold in with the agent's reads and searches: only ones that can't write a
// file or run another program.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { lookupKind } from "../../src/acp/readOnlyCommand";

test("the agent's usual lookups fold in: searches and reads, through pipes and with errors thrown away", () => {
  // The four commands from M's Claude Code run.
  assert.equal(lookupKind(`cd /Users/m/Develop/js-client && grep -n "buildRewardsUrl" -A20 src/extension-shared/loyalty/utils/helpers.ts | head -40`), "search");
  assert.equal(lookupKind(`grep -rn "useRewards(" src extensions 2>/dev/null | grep -v node_modules | grep -v ".test."`), "search");
  assert.equal(lookupKind(`grep -rln "useRewards" src extensions 2>/dev/null | grep -v node_modules`), "search");
  assert.equal(lookupKind(`grep -n "useRewards" -A8 extensions/loyalty/src/Catalog.tsx extensions/loyalty/src/Profile.tsx`), "search");
  assert.equal(lookupKind("rg --files src | wc -l"), "search", "the first lookup decides");
  assert.equal(lookupKind("find src -name '*.ts' -type f"), "search");
  assert.equal(lookupKind("ls -la src; ls test"), "search");
  assert.equal(lookupKind("cat package.json"), "read");
  assert.equal(lookupKind("head -n 50 src/a.ts && tail -n 20 src/a.ts"), "read");
  assert.equal(lookupKind("sed -n '1,80p' src/a.ts"), "read");
  assert.equal(lookupKind("sed -n -e '/start/,/end/p' -e '$=' src/a.ts"), "read", "addresses with p and =");
  assert.equal(lookupKind("sed -n '15,40p;100p' src/a.ts"), "read");
  assert.equal(lookupKind("wc -l src/*.ts 2>&1"), "read");
  assert.equal(lookupKind(`grep "a|b; c && d > e" src`), "search", "operators inside quotes are just text");
  assert.equal(lookupKind("grep foo src >/dev/null"), "search");
  // From M's run: a separator echoed between two lookups.
  assert.equal(lookupKind(`grep -rn "useRewardsLoyalty\\|hooks/useRewards\\|from '.*extension-shared/loyalty'" . --exclude-dir=node_modules --exclude-dir=dist | head -50; echo ---; sed -n 15,40p src/extension-shared/loyalty/index.ts`), "search");
});

test("anything that could write a file or run a program stays a command", () => {
  for (const command of [
    "grep foo src > out.txt",
    "cat a.ts >> b.ts",
    "grep foo src 2> errors.log",
    "cat < input.txt",
    "find . -name '*.tmp' -delete",
    "find . -exec rm {} \;",
    "find . -fprint list.txt",
    "sed -i 's/a/b/' src/a.ts",
    "sed -n -i 's/a/b/p' src/a.ts",
    "sed 's/a/b/' src/a.ts",
    "sed -n '/x/w out.txt' src/a.ts",
    "sed -n '1e date' src/a.ts",
    // From the review: sed forms that write or run, which a list of forbidden forms missed.
    "sed -n 's/a/b/gw out.txt' f",
    "sed -n 's/a/b/ge' f",
    "sed -n '$w out' f",
    "sed -n '/x/Iw out' f",
    "sed -n 's/a/b/w/tmp/out' f",
    "sed -n -f script.sed f",
    "sed -n 's/a/b/p' f",
    "rg --pre ./script.sh foo",
    "grep foo $(cat files.txt)",
    'grep "$(whoami)" src',
    "grep `whoami` src",
    "ls & rm -rf /tmp/x",
    "ls; rm -rf build",
    "cat a | xargs rm",
    "npm test",
    "(cd src && ls)",
    "grep 'unclosed src",
    "cd src",
    "echo hello",
    "echo secret > notes.txt",
    "ls; echo $(rm -rf build)",
    "",
  ]) assert.equal(lookupKind(command), undefined, command);
});
