import {
  T3nClient,
  createEthAuthInput,
  eth_get_address,
  fetchTrustedManifest,
  loadWasmComponent,
  metamask_sign,
  setEnvironment,
} from "@terminal3/t3n-sdk";

import { requireEnv } from "./session.ts";

export async function connect(envName: string) {
  setEnvironment("testnet");
  const apiKey = requireEnv(envName);
  const wasmComponent = await loadWasmComponent();
  const address = eth_get_address(apiKey);
  const t3n = new T3nClient({
    trustAnchor: await fetchTrustedManifest("testnet"),
    wasmComponent,
    handlers: {
      EthSign: metamask_sign(address, undefined, apiKey),
    },
  });
  await t3n.handshake();
  const did = await t3n.authenticate(createEthAuthInput(address));
  return { t3n, did: did.value as string, address };
}
