// A CLI agent's chips come from its ACP config options: model, thinking (thought_level), and fast mode
// (model_config, boolean or an on/off select). Remembered choices are applied model first, and only
// ones the agent still offers.
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { chipOptions, nextRemembered, wireValue } from "../../src/acp/agentOptions";

const claudeLike: any[] = [
  { id: "mode", name: "Mode", category: "mode", type: "select", currentValue: "default", options: [{ value: "default", name: "Manual" }] },
  { id: "agent", name: "Agent", type: "select", currentValue: "default", options: [{ value: "default", name: "Default" }] },
  { id: "fast", name: "Fast mode", category: "model_config", type: "boolean", currentValue: true },
  { id: "effort", name: "Effort", category: "thought_level", type: "select", currentValue: "high", options: [{ value: "default", name: "Default" }, { value: "high", name: "High" }] },
  {
    id: "model",
    name: "Model",
    category: "model",
    type: "select",
    currentValue: "opus[1m]",
    options: [{ group: "g", name: "Opus", options: [{ value: "opus", name: "Opus" }, { value: "opus[1m]", name: "Opus" }, { value: "sonnet[1m]", name: "Sonnet (1M context)" }] }],
  },
];

test("model, thinking, and fast become chips in that order; mode and other options are left out; groups are flattened; 1M rows are labeled", () => {
  const chips = chipOptions(claudeLike);
  assert.deepEqual(chips.map((c) => `${c.kind}:${c.id}=${c.value}`), ["model:model=opus[1m]", "thinking:effort=high", "fast:fast=true"]);
  assert.deepEqual(chips[0].choices, [
    { value: "opus", name: "Opus" },
    { value: "opus[1m]", name: "Opus", description: "1M context" },
    { value: "sonnet[1m]", name: "Sonnet (1M context)" },
  ]);
  assert.equal(chips[2].type, "boolean");
  assert.deepEqual(chipOptions(undefined), []);
});

test("fast mode sent as an on/off select is a fast chip; another model_config select isn't", () => {
  const onOff = { id: "fast-mode", name: "Fast", category: "model_config", type: "select", currentValue: "off", options: [{ value: "on", name: "On" }, { value: "off", name: "Off" }] } as any;
  const other = { id: "tier", name: "Tier", category: "model_config", type: "select", currentValue: "a", options: [{ value: "a", name: "A" }, { value: "b", name: "B" }] } as any;
  assert.deepEqual(chipOptions([other, onOff]).map((c) => [c.kind, c.id, c.value]), [["fast", "fast-mode", false]]);
  assert.deepEqual(wireValue(chipOptions([onOff])[0], true), { value: "on", boolean: false });
  assert.deepEqual(wireValue(chipOptions(claudeLike)[2], false), { value: false, boolean: true });
  assert.deepEqual(wireValue(chipOptions(claudeLike)[0], "opus"), { value: "opus", boolean: false });
});

test("remembered choices apply model first, skip what's current, gone, or done", () => {
  const chips = chipOptions(claudeLike);
  const done = new Set<string>();
  const remembered = { model: "opus", effort: "max", fast: true, mode: "plan" };
  assert.deepEqual(nextRemembered(chips, remembered, done), { option: chips[0], value: "opus" });
  done.add("model");
  assert.equal(nextRemembered(chips, remembered, done), undefined, "effort 'max' isn't offered; fast is already on; mode isn't a chip");
  assert.equal(nextRemembered(chips, {}, new Set()), undefined);
});
