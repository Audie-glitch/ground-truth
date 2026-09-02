// Copies compiled ABIs into ../abi so the agent and web app import stable JSON instead of
// reaching into Foundry's out/ directory.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "..", "out");
const dests = [join(here, "..", "..", "abi"), join(here, "..", "..", "web", "src", "lib", "abi")];

const artifacts = {
  CreditPassport: "CreditPassport.sol/CreditPassport.json",
  PaymentRail: "PaymentRail.sol/PaymentRail.json",
  TestUSD: "TestUSD.sol/TestUSD.json",
};

for (const dest of dests) {
  mkdirSync(dest, { recursive: true });
  for (const [name, rel] of Object.entries(artifacts)) {
    const artifact = JSON.parse(readFileSync(join(out, rel), "utf8"));
    writeFileSync(join(dest, `${name}.json`), JSON.stringify(artifact.abi, null, 2) + "\n");
  }
  console.log(`wrote ${Object.keys(artifacts).length} ABIs to ${dest}`);
}
