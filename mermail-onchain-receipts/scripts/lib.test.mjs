import assert from "node:assert/strict";
import {
  TRANSFER_TOPIC,
  decodeTransfers,
  extractHashes,
  formatAmount,
  formatDraftCard,
  lookupHash,
} from "./lib.mjs";

const text = `
  ignore this address 0x70997970C51812dc3A010C7d01b50e0d17dc79C8
  sepolia https://sepolia.etherscan.io/tx/0x82b08a2d376cec29b5f53d5301005504d337f99c2193b546dc5457a6a0bbc2f2
  same again 0x82b08a2d376cec29b5f53d5301005504d337f99c2193b546dc5457a6a0bbc2f2
`;
const hashes = extractHashes(text);
assert.deepEqual(hashes, ["0x82b08a2d376cec29b5f53d5301005504d337f99c2193b546dc5457a6a0bbc2f2"]);
assert.deepEqual(extractHashes("no hash here 0xabc"), []);
assert.deepEqual(
  extractHashes("Please send USDC via PayBox to 0x70997970C51812dc3A010C7d01b50e0d17dc79C8"),
  [],
);

const usdc = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
const transfers = decodeTransfers([
  {
    address: usdc,
    topics: [
      TRANSFER_TOPIC,
      "0x0000000000000000000000001111111111111111111111111111111111111111",
      "0x0000000000000000000000002222222222222222222222222222222222222222",
    ],
    data: "0x" + (1_000_000n).toString(16).padStart(64, "0"),
  },
]);
assert.equal(transfers.length, 1);
assert.equal(transfers[0].symbol, "USDC");
assert.equal(transfers[0].from, "0x1111111111111111111111111111111111111111");
assert.equal(transfers[0].to, "0x2222222222222222222222222222222222222222");
assert.equal(formatAmount(transfers[0].value, 6), "1");

const card = formatDraftCard({
  mailbox: "receipts@example.com",
  items: [
    {
      hash: hashes[0],
      status: "confirmed",
      chain: "sepolia",
      blockNumber: 11623638,
      from: "0xaaa",
      to: "0xbbb",
      transfers,
      sourceMessageId: "msg-1",
    },
  ],
});
assert.match(card, /Draft only/);
assert.match(card, /1 USDC/);
assert.doesNotMatch(card, /send_email|PayBox|pbxk1/);

const row = await lookupHash(hashes[0]);
assert.equal(row.status, "confirmed");
assert.equal(row.chain, "sepolia");
assert.equal(row.chainId, 11155111);
assert.ok(row.blockNumber > 11_000_000);
assert.ok(row.from);
console.log("ok", row.chain, row.blockNumber, row.from, "transfers", row.transfers?.length ?? 0);
