import test from "node:test";
import assert from "node:assert/strict";
import { parseLabConfig } from "../src/js/utils/antibiogram-engine.js";
import { getActiveLabConfigDetails } from "../src/js/pages/resource-explorer.js";
import { state } from "../src/js/state/store.js";

test("parseLabConfig parses antibiotics and test codes into drugCodes and testCodes sets", () => {
  const cfgContent = `
[WHONET Configuration File]
Laboratory Name=General Hospital Lab
Country=Sample Country

[Antibiotics]
AMK_ND30,Amikacin,14,15-16,17
CIP_ND5,Ciprofloxacin,15,16-20,21
CRO_NM,Ceftriaxone,4,2,1

[Antibiotic Species-Specific Breakpoints]
sau,FOX_ND30,21,22
eco,CRO_NM,4,1
`;

  const parsed = parseLabConfig(cfgContent);
  assert.ok(parsed, "Config should parse successfully");
  assert.equal(parsed.metadata["Laboratory Name"], "General Hospital Lab");

  assert.ok(parsed.drugCodes.has("AMK"));
  assert.ok(parsed.drugCodes.has("CIP"));
  assert.ok(parsed.drugCodes.has("CRO"));
  assert.ok(parsed.drugCodes.has("FOX"));

  assert.ok(parsed.testCodes.has("AMK_ND30"));
  assert.ok(parsed.testCodes.has("CIP_ND5"));
  assert.ok(parsed.testCodes.has("CRO_NM"));
  assert.ok(parsed.testCodes.has("FOX_ND30"));
  assert.ok(parsed.speciesCodes.has("sau"));
  assert.ok(parsed.speciesCodes.has("eco"));
});

test("getActiveLabConfigDetails detects customLabConfig and schema AST columns", () => {
  const origLab = state.customLabConfig;
  const origSchema = state.schema;

  try {
    state.customLabConfig = {
      filename: "WHO_TST.CFG",
      drugCodes: new Set(["AMK", "GEN", "CIP"]),
      testCodes: new Set(["AMK_ND30", "GEN_ND10", "CIP_ND5"]),
    };
    state.schema = {
      columns: {
        Isolates: ["ROW_IDX", "ORGANISM", "SPEC_DATE", "AMK_ND30", "CIP_ND5", "CRO_NM"],
      },
    };

    const details = getActiveLabConfigDetails();
    assert.equal(details.isAvailable, true);
    assert.equal(details.source, "WHO_TST.CFG");
    assert.ok(details.drugCodes.has("AMK"));
    assert.ok(details.drugCodes.has("GEN"));
    assert.ok(details.drugCodes.has("CIP"));
    assert.ok(details.drugCodes.has("CRO")); // from schema column fallback
    assert.ok(details.testCodes.has("CRO_NM"));
  } finally {
    state.customLabConfig = origLab;
    state.schema = origSchema;
  }
});
