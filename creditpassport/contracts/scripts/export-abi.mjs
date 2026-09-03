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
// The live check needs creation bytecode, not only the ABI.
const withBytecode = { LivePrecompileCheck: "LivePrecompileCheck.sol/LivePrecompileCheck.json" };

for (const dest of dests) {
  mkdirSync(dest, { recursive: true });
  for (const [name, rel] of Object.entries(artifacts)) {
    const artifact = JSON.parse(readFileSync(join(out, rel), "utf8"));
    writeFileSync(join(dest, `${name}.json`), JSON.stringify(artifact.abi, null, 2) + "\n");
  }
  console.log(`wrote ${Object.keys(artifacts).length} ABIs to ${dest}`);
}

const primary = dests[0];
for (const [name, rel] of Object.entries(withBytecode)) {
  const artifact = JSON.parse(readFileSync(join(out, rel), "utf8"));
  writeFileSync(join(primary, `${name}.json`), JSON.stringify({ abi: artifact.abi, bytecode: artifact.bytecode.object }, null, 2) + "\n");
  console.log(`wrote abi/${name}.json with bytecode`);
}
