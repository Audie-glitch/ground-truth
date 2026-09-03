import { decodeFunctionData, hexToString, isAddress, isHex, type Hex } from "viem";
import { formatAmount, formatDeadline, formatEth, isUnlimited, short } from "./format";
import { EXPLORERS, KNOWN_CONTRACTS, KNOWN_FUNCTIONS, KNOWN_TOKENS, PERMIT2, SUSPICIOUS_NAMES } from "./known";
import {
  parseRequest,
  type BatchRequest,
  type EthSignRequest,
  type ParsedRequest,
  type PersonalSignRequest,
  type TxRequest,
  type TypedDataRequest,
} from "./parse";
import {
  maxSeverity,
  offlineEnricher,
  type AddressInfo,
  type DecodedField,
  type Enricher,
  type Finding,
  type Report,
  type TokenInfo,
} from "./types";

export { ParseError } from "./parse";
export { EXPLORERS };

const NFT_STANDARDS = new Set(["erc721", "erc1155"]);

function label(address: string): string | undefined {
  return KNOWN_CONTRACTS[address.toLowerCase()];
}

async function addressInfo(enricher: Enricher, chainId: number | null, address: string): Promise<AddressInfo> {
  const info = await enricher.addressInfo(chainId, address);
  const known = label(address);
  return known ? { ...info, label: known, isContract: true, verified: info.verified ?? true } : info;
}

async function tokenInfo(enricher: Enricher, chainId: number | null, address: string): Promise<TokenInfo> {
  const info = await enricher.tokenInfo(chainId, address);
  const known = KNOWN_TOKENS[address.toLowerCase()];
  if (known && (chainId === null || known.chainId === chainId)) {
    return { ...info, symbol: info.symbol ?? known.symbol, decimals: info.decimals ?? known.decimals, standard: info.standard ?? "erc20" };
  }
  return info;
}

function describe(info: AddressInfo | null, role: string): string {
  if (!info) return role;
  if (info.label) return `${info.label} (${short(info.address)})`;
  return short(info.address);
}

/** Findings about who is being trusted, shared by every approval-shaped action. */
function counterpartyFindings(info: AddressInfo, role: string): Finding[] {
  const out: Finding[] = [];
  if (info.label) {
    out.push({ severity: "info", title: `${role} is a known contract`, detail: `${info.label} at ${info.address}.` });
    return out;
  }
  if (info.isContract === false) {
    out.push({
      severity: "critical",
      title: `${role} is a plain wallet address, not a contract`,
      detail:
        `${info.address} has no code. Applications grant permissions to their contracts; a permission granted to a wallet can only be used by whoever holds that wallet's key, at any time, with no rules. This is the signature of a drainer.`,
    });
  } else if (info.isContract === true && info.verified === false) {
    out.push({
      severity: "high",
      title: `${role} is an unverified contract`,
      detail: `${info.address} has code but no published source, so nobody can check what it does with the permission.`,
    });
  } else if (info.isContract === null) {
    out.push({
      severity: "low",
      title: `${role} could not be checked on-chain`,
      detail: `No RPC was available for this chain, so it is unknown whether ${info.address} is a contract or a wallet. Look it up on an explorer before signing.`,
    });
  }
  return out;
}

function amountFinding(amount: bigint, token: TokenInfo | null, verb: string): Finding | null {
  if (isUnlimited(amount)) {
    return {
      severity: "high",
      title: `Unlimited ${verb}`,
      detail: `The amount is the maximum representable value, so this covers every ${token?.symbol ?? "token"} you hold now and in the future until you revoke it. Legitimate apps rarely need more than the amount of the current action.`,
    };
  }
  return null;
}

function deadlineFinding(seconds: bigint, what: string): Finding | null {
  const d = formatDeadline(seconds);
  if (d.never) return { severity: "medium", title: `${what} never expires`, detail: "There is no time limit on this permission." };
  if (d.farFuture) return { severity: "low", title: `${what} is valid for a long time`, detail: `It stays valid until ${d.text}.` };
  return null;
}

// -------------------------------------------------------------------------------------------------
// Transactions
// -------------------------------------------------------------------------------------------------

interface Decoded {
  functionName: string;
  args: readonly unknown[];
}

function tryDecode(data: Hex): Decoded | null {
  try {
    const { functionName, args } = decodeFunctionData({ abi: KNOWN_FUNCTIONS, data });
    return { functionName, args: (args ?? []) as readonly unknown[] };
  } catch {
    return null;
  }
}

async function analyzeTransaction(tx: TxRequest, enricher: Enricher): Promise<Report> {
  const findings: Finding[] = [];
  const decoded: DecodedField[] = [];
  const chainId = tx.chainId;

  if (!tx.to && tx.method !== "calldata") {
    findings.push({
      severity: "medium",
      title: "Deploys a new contract",
      detail: `This transaction creates a contract from ${(tx.data.length - 2) / 2} bytes of code${tx.value > 0n ? ` and funds it with ${formatEth(tx.value)}` : ""}. Only sign if you are deploying something yourself.`,
    });
    return finish("transaction", tx.method, chainId, "Deploys a new contract.", findings, decoded, null, null, null);
  }

  const target: AddressInfo = tx.to
    ? await addressInfo(enricher, chainId, tx.to)
    : { address: "unknown", isContract: null, verified: null, label: "unknown target (calldata only)" };
  const tokenOfTarget = () =>
    tx.to ? tokenInfo(enricher, chainId, tx.to) : Promise.resolve<TokenInfo>({ address: "unknown", standard: "unknown" });
  if (tx.to) decoded.push({ name: "to", value: tx.to, note: target.label });
  if (tx.value > 0n) decoded.push({ name: "value", value: formatEth(tx.value) });

  if (tx.data === "0x" || tx.data.length <= 2) {
    const summary = tx.value > 0n ? `Sends ${formatEth(tx.value)} to ${describe(target, "the recipient")}.` : "Does nothing: no data and no value.";
    if (tx.value > 0n && target.isContract === true) {
      findings.push({ severity: "low", title: "Sending ETH to a contract", detail: "The contract's receive/fallback function decides what happens to it." });
    }
    if (tx.value === 0n) findings.push({ severity: "info", title: "Empty transaction", detail: "This would only cost gas." });
    return finish("transaction", tx.method, chainId, summary, findings, decoded, target, null, null);
  }

  const dec = tryDecode(tx.data);
  const selector = tx.data.slice(0, 10);
  if (!dec) {
    decoded.push({ name: "selector", value: selector });
    findings.push({
      severity: tx.value > 0n ? "high" : "medium",
      title: "Unknown function",
      detail: `Selector ${selector} on ${describe(target, "the target")} is not in SignLens's list. ${tx.value > 0n ? `It also sends ${formatEth(tx.value)}. ` : ""}Compare the site's explanation with the verified contract source before signing.`,
    });
    findings.push(...counterpartyFindings(target, "Target").filter((f) => f.severity !== "info"));
    return finish("transaction", tx.method, chainId, `Calls an unknown function ${selector} on ${describe(target, "a contract")}.`, findings, decoded, target, null, null);
  }

  decoded.push({ name: "function", value: dec.functionName });
  let summary = `Calls ${dec.functionName} on ${describe(target, "a contract")}.`;
  let counterparty: AddressInfo | null = null;
  let token: TokenInfo | null = null;

  switch (dec.functionName) {
    case "approve":
    case "increaseAllowance": {
      if (dec.args.length === 4) {
        // Permit2.approve(token, spender, amount, expiration)
        const [tokenAddr, spender, amount, expiration] = dec.args as [string, string, bigint, bigint];
        token = await tokenInfo(enricher, chainId, tokenAddr);
        counterparty = await addressInfo(enricher, chainId, spender);
        decoded.push({ name: "token", value: tokenAddr, note: token.symbol }, { name: "spender", value: spender, note: counterparty.label }, { name: "amount", value: formatAmount(amount, token.decimals, token.symbol) }, { name: "expiration", value: formatDeadline(expiration).text });
        summary = `Via Permit2, lets ${describe(counterparty, "the spender")} move ${formatAmount(amount, token.decimals, token.symbol)} of your ${token.symbol ?? "tokens"}, ${formatDeadline(expiration).text}.`;
        const af = amountFinding(amount, token, "Permit2 allowance");
        if (af) findings.push(af);
        const df = deadlineFinding(expiration, "The allowance");
        if (df) findings.push(df);
        findings.push(...counterpartyFindings(counterparty, "Spender"));
        break;
      }
      const [spender, amount] = dec.args as [string, bigint];
      token = await tokenOfTarget();
      counterparty = await addressInfo(enricher, chainId, spender);
      const isNft = token.standard !== undefined && NFT_STANDARDS.has(token.standard);
      decoded.push({ name: "spender", value: spender, note: counterparty.label });
      if (isNft) {
        decoded.push({ name: "tokenId", value: amount.toString() });
        summary = `Lets ${describe(counterparty, "the spender")} transfer NFT #${amount.toString()} from ${token.symbol ?? (tx.to ? short(tx.to) : "this token")} out of your wallet.`;
        findings.push({ severity: "medium", title: "Single-NFT approval", detail: "The approved address can move this one token whenever it wants until the token is transferred or the approval is reset." });
      } else {
        decoded.push({ name: "amount", value: formatAmount(amount, token.decimals, token.symbol) });
        const verb = dec.functionName === "increaseAllowance" ? "raises" : "sets";
        summary = `${verb === "sets" ? "Lets" : "Additionally lets"} ${describe(counterparty, "the spender")} move ${formatAmount(amount, token.decimals, token.symbol)} of your ${token.symbol ?? (tx.to ? short(tx.to) : "this token")}, with no expiry.`;
        const af = amountFinding(amount, token, "token allowance");
        if (af) findings.push(af);
        if (amount === 0n) findings.push({ severity: "info", title: "Revocation", detail: "An allowance of zero removes the spender's permission." });
      }
      findings.push(...counterpartyFindings(counterparty, "Spender"));
      if (tx.value > 0n) findings.push({ severity: "medium", title: "ETH attached to an approval", detail: "Approvals never need ETH. Attached value goes to the token contract's fallback, which is not normal." });
      break;
    }

    case "setApprovalForAll": {
      const [operator, approved] = dec.args as [string, boolean];
      token = await tokenOfTarget();
      counterparty = await addressInfo(enricher, chainId, operator);
      decoded.push({ name: "operator", value: operator, note: counterparty.label }, { name: "approved", value: String(approved) });
      if (approved) {
        summary = `Lets ${describe(counterparty, "the operator")} move every ${token.symbol ?? (tx.to ? short(tx.to) : "this token")} token you own or will own, with no expiry.`;
        findings.push({ severity: "high", title: "Collection-wide approval", detail: "setApprovalForAll(true) covers all current and future tokens of this collection. Marketplaces need it to list items; anyone else asking for it is a red flag." });
        findings.push(...counterpartyFindings(counterparty, "Operator"));
      } else {
        summary = `Revokes ${describe(counterparty, "the operator")}'s permission over your ${token.symbol ?? (tx.to ? short(tx.to) : "this token")} tokens.`;
        findings.push({ severity: "info", title: "Revocation", detail: "This removes a collection-wide approval." });
      }
      break;
    }

    case "transfer": {
      const [to, amount] = dec.args as [string, bigint];
      token = await tokenOfTarget();
      counterparty = await addressInfo(enricher, chainId, to);
      decoded.push({ name: "recipient", value: to, note: counterparty.label }, { name: "amount", value: formatAmount(amount, token.decimals, token.symbol) });
      summary = `Sends ${formatAmount(amount, token.decimals, token.symbol)} of ${token.symbol ?? (tx.to ? short(tx.to) : "this token")} to ${describe(counterparty, "the recipient")}.`;
      findings.push({ severity: "info", title: "Direct token transfer", detail: "Tokens leave your wallet immediately; confirm the recipient is who you intend." });
      if (isUnlimited(amount)) findings.push({ severity: "high", title: "Implausible amount", detail: "The amount is the maximum representable value." });
      break;
    }

    case "transferFrom":
    case "safeTransferFrom":
    case "safeBatchTransferFrom": {
      const from = dec.args[0] as string;
      const to = dec.args[1] as string;
      token = await tokenOfTarget();
      counterparty = await addressInfo(enricher, chainId, to);
      decoded.push({ name: "from", value: from }, { name: "recipient", value: to, note: counterparty.label });
      const third = dec.args[2];
      const idOrAmount = typeof third === "bigint" ? third : null;
      if (dec.functionName === "transferFrom" && token.standard !== "erc721") {
        decoded.push({ name: "amount", value: idOrAmount !== null ? formatAmount(idOrAmount, token.decimals, token.symbol) : "?" });
        summary = `Moves ${idOrAmount !== null ? formatAmount(idOrAmount, token.decimals, token.symbol) : "tokens"} from ${short(from)} to ${describe(counterparty, "the recipient")}.`;
      } else {
        decoded.push({ name: "tokenId", value: idOrAmount?.toString() ?? "?" });
        summary = `Transfers NFT #${idOrAmount?.toString() ?? "?"} of ${token.symbol ?? (tx.to ? short(tx.to) : "this token")} from ${short(from)} to ${describe(counterparty, "the recipient")}.`;
      }
      if (tx.from && from.toLowerCase() !== tx.from.toLowerCase()) {
        findings.push({ severity: "medium", title: "Moves someone else's tokens", detail: `The sender (${short(tx.from)}) is not the owner field (${short(from)}); this relies on an existing allowance.` });
      } else {
        findings.push({ severity: "info", title: "Transfer out of your wallet", detail: "The asset leaves immediately." });
      }
      break;
    }

    case "permit": {
      const [owner, spender, value, deadline] = dec.args as [string, string, bigint, bigint];
      token = await tokenOfTarget();
      counterparty = await addressInfo(enricher, chainId, spender);
      decoded.push({ name: "owner", value: owner }, { name: "spender", value: spender, note: counterparty.label }, { name: "value", value: formatAmount(value, token.decimals, token.symbol) }, { name: "deadline", value: formatDeadline(deadline).text });
      summary = `Submits a signed permit letting ${describe(counterparty, "the spender")} move ${formatAmount(value, token.decimals, token.symbol)} of ${short(owner)}'s ${token.symbol ?? "tokens"}.`;
      const af = amountFinding(value, token, "permit allowance");
      if (af) findings.push(af);
      findings.push(...counterpartyFindings(counterparty, "Spender"));
      break;
    }

    case "multicall": {
      const [calls] = dec.args as [readonly Hex[]];
      decoded.push({ name: "inner calls", value: String(calls.length) });
      const inner: string[] = [];
      for (const call of calls) {
        const d = tryDecode(call);
        inner.push(d ? d.functionName : `unknown ${call.slice(0, 10)}`);
        if (d && (d.functionName === "approve" || d.functionName === "setApprovalForAll" || d.functionName === "transferFrom")) {
          findings.push({ severity: "medium", title: `Bundled ${d.functionName}`, detail: "An approval or transfer is hidden inside a multicall; inspect each inner call." });
        }
      }
      decoded.push({ name: "inner functions", value: inner.join(", ") });
      summary = `Runs ${calls.length} bundled calls on ${describe(target, "a contract")}: ${inner.join(", ")}.`;
      break;
    }

    case "execute": {
      summary = `Runs a Universal Router command bundle on ${describe(target, "the router")}${tx.value > 0n ? ` with ${formatEth(tx.value)}` : ""}.`;
      findings.push({ severity: target.label ? "info" : "medium", title: target.label ? "Known router" : "Router-style call on an unknown contract", detail: target.label ? "Swaps through the Uniswap Universal Router encode their steps as commands; the wallet's simulation shows the resulting balance changes." : "The command bundle format is used by routers; on an unknown contract it can hide transfers." });
      break;
    }

    case "upgradeTo":
    case "upgradeToAndCall":
    case "transferOwnership": {
      summary = `Administrative action ${dec.functionName} on ${describe(target, "a contract")}.`;
      findings.push({ severity: "high", title: "Admin action", detail: `${dec.functionName} changes who controls a contract or what code it runs. Only sign if you administer this contract.` });
      decoded.push({ name: "argument", value: String(dec.args[0]) });
      break;
    }

    default: {
      for (let i = 0; i < dec.args.length; i++) decoded.push({ name: `arg${i}`, value: String(dec.args[i]) });
      if (SUSPICIOUS_NAMES.has(dec.functionName) && tx.value > 0n) {
        summary = `Sends ${formatEth(tx.value)} to a function called ${dec.functionName}() on ${describe(target, "a contract")}.`;
        findings.push({ severity: "high", title: "Reassuring name, ETH attached", detail: `Functions named ${dec.functionName} are common in phishing kits because wallets show the name and users relax. No real protocol needs you to send ETH to "${dec.functionName}".` });
      } else if (tx.value > 0n) {
        summary = `Calls ${dec.functionName} on ${describe(target, "a contract")} and sends ${formatEth(tx.value)}.`;
        findings.push({ severity: "low", title: "ETH sent with the call", detail: "Check the amount matches what the site showed." });
      }
      findings.push(...counterpartyFindings(target, "Target").filter((f) => f.severity !== "info"));
    }
  }

  return finish("transaction", tx.method, chainId, summary, findings, decoded, target, counterparty, token);
}

// -------------------------------------------------------------------------------------------------
// Typed data (EIP-712)
// -------------------------------------------------------------------------------------------------

function str(v: unknown): string {
  if (typeof v === "bigint") return v.toString();
  if (typeof v === "object" && v !== null) return JSON.stringify(v);
  return String(v);
}

function big(v: unknown): bigint {
  try {
    if (typeof v === "bigint") return v;
    if (typeof v === "number") return BigInt(v);
    if (typeof v === "string") return v.startsWith("0x") ? BigInt(v) : BigInt(v);
  } catch {
    // fall through
  }
  return 0n;
}

async function analyzeTypedData(td: TypedDataRequest, enricher: Enricher): Promise<Report> {
  const findings: Finding[] = [];
  const decoded: DecodedField[] = [];
  const chainId = td.chainId;
  const domainName = typeof td.domain.name === "string" ? td.domain.name : undefined;
  const verifying = typeof td.domain.verifyingContract === "string" && isAddress(td.domain.verifyingContract) ? td.domain.verifyingContract : undefined;
  const target = verifying ? await addressInfo(enricher, chainId, verifying) : null;

  decoded.push({ name: "primaryType", value: td.primaryType });
  if (domainName) decoded.push({ name: "domain.name", value: domainName });
  if (verifying) decoded.push({ name: "verifyingContract", value: verifying, note: target?.label });
  if (td.domain.chainId === undefined) findings.push({ severity: "low", title: "No chainId in domain", detail: "Signatures without a chain id can be replayed on other chains." });

  const m = td.message;
  let summary = `Signs a ${td.primaryType} message for ${domainName ?? describe(target, "an unknown domain")}.`;
  let counterparty: AddressInfo | null = null;
  let token: TokenInfo | null = null;

  const isPermit2Domain = verifying?.toLowerCase() === PERMIT2.toLowerCase();

  if (td.primaryType === "Permit" && "spender" in m && ("value" in m || "allowed" in m)) {
    // EIP-2612 (value) or DAI-style (allowed)
    const spender = String(m.spender);
    counterparty = await addressInfo(enricher, chainId, spender);
    if (verifying) token = await tokenInfo(enricher, chainId, verifying);
    const unlimited = "allowed" in m ? Boolean(m.allowed) : isUnlimited(big(m.value));
    const amountText = "allowed" in m ? (m.allowed ? "an unlimited amount" : "nothing") : formatAmount(big(m.value), token?.decimals, token?.symbol);
    const deadline = big(m.deadline ?? m.expiry);
    decoded.push({ name: "spender", value: spender, note: counterparty.label }, { name: "amount", value: amountText }, { name: "deadline", value: formatDeadline(deadline).text });
    summary = `Signs a gasless approval letting ${describe(counterparty, "the spender")} move ${amountText} of your ${token?.symbol ?? domainName ?? "tokens"}. Nothing is sent now; the spender can submit this later.`;
    findings.push({ severity: "medium", title: "Off-chain approval", detail: "Permit signatures cost no gas and do not appear in your wallet activity. The spender redeems them whenever they choose before the deadline." });
    if (unlimited) findings.push({ severity: "high", title: "Unlimited permit", detail: "The permitted amount is unlimited." });
    const df = deadlineFinding(deadline, "The permit");
    if (df) findings.push(df);
    findings.push(...counterpartyFindings(counterparty, "Spender"));
  } else if (td.primaryType === "PermitSingle" || td.primaryType === "PermitBatch") {
    const details = td.primaryType === "PermitSingle" ? [m.details as Record<string, unknown>] : ((m.details as Record<string, unknown>[]) ?? []);
    const spender = String(m.spender);
    counterparty = await addressInfo(enricher, chainId, spender);
    decoded.push({ name: "spender", value: spender, note: counterparty.label });
    const parts: string[] = [];
    for (const d of details) {
      const tAddr = String(d.token);
      const t = await tokenInfo(enricher, chainId, tAddr);
      token = token ?? t;
      const amount = big(d.amount);
      const exp = big(d.expiration);
      decoded.push({ name: `token ${short(tAddr)}`, value: `${formatAmount(amount, t.decimals, t.symbol)}, ${formatDeadline(exp).text}` });
      parts.push(`${formatAmount(amount, t.decimals, t.symbol)} of ${t.symbol ?? short(tAddr)}`);
      const af = amountFinding(amount, t, "Permit2 allowance");
      if (af) findings.push(af);
      const df = deadlineFinding(exp, "The allowance");
      if (df) findings.push(df);
    }
    summary = `Signs a Permit2 approval letting ${describe(counterparty, "the spender")} move ${parts.join(", ")} from your wallet.`;
    if (!isPermit2Domain) findings.push({ severity: "high", title: "Permit2-shaped message from a non-Permit2 contract", detail: `The verifying contract is ${verifying ?? "missing"}, not Permit2 (${PERMIT2}).` });
    findings.push({ severity: "medium", title: "Off-chain approval", detail: "Permit2 signatures are redeemed later by the spender and never show up as a transaction you sent." });
    findings.push(...counterpartyFindings(counterparty, "Spender"));
  } else if (td.primaryType === "PermitTransferFrom" || td.primaryType === "PermitBatchTransferFrom" || td.primaryType === "PermitWitnessTransferFrom" || td.primaryType === "PermitBatchWitnessTransferFrom") {
    const permitted = Array.isArray(m.permitted) ? (m.permitted as Record<string, unknown>[]) : [m.permitted as Record<string, unknown>];
    const spender = String(m.spender);
    counterparty = await addressInfo(enricher, chainId, spender);
    decoded.push({ name: "spender", value: spender, note: counterparty.label }, { name: "deadline", value: formatDeadline(big(m.deadline)).text });
    const parts: string[] = [];
    for (const p of permitted) {
      const tAddr = String(p.token);
      const t = await tokenInfo(enricher, chainId, tAddr);
      token = token ?? t;
      parts.push(formatAmount(big(p.amount), t.decimals, t.symbol) + (t.symbol ? "" : ` of ${short(tAddr)}`));
      decoded.push({ name: `token ${short(tAddr)}`, value: formatAmount(big(p.amount), t.decimals, t.symbol) });
    }
    summary = `Signs a one-time Permit2 transfer authorising ${describe(counterparty, "the spender")} to pull ${parts.join(", ")} from your wallet before ${formatDeadline(big(m.deadline)).text}.`;
    findings.push({ severity: "high", title: "Signature authorises a token pull", detail: "This is how Uniswap-style swaps take input tokens, and also how drainers empty wallets: the spender executes the transfer, not you. Only sign when the spender is the contract of the app you are using right now." });
    if (!isPermit2Domain) findings.push({ severity: "high", title: "Not the Permit2 contract", detail: `verifyingContract is ${verifying ?? "missing"}.` });
    findings.push(...counterpartyFindings(counterparty, "Spender"));
  } else if (td.primaryType === "OrderComponents" || td.primaryType === "Order") {
    const offer = Array.isArray(m.offer) ? (m.offer as Record<string, unknown>[]) : [];
    const consideration = Array.isArray(m.consideration) ? (m.consideration as Record<string, unknown>[]) : [];
    const offerer = typeof m.offerer === "string" ? m.offerer : undefined;
    decoded.push({ name: "offer items", value: String(offer.length) }, { name: "consideration items", value: String(consideration.length) });
    const toOfferer = consideration.filter((c) => offerer && String(c.recipient).toLowerCase() === offerer.toLowerCase());
    const totalToOfferer = toOfferer.reduce((acc, c) => acc + big(c.endAmount ?? c.startAmount), 0n);
    summary = `Signs a marketplace order offering ${offer.length} item${offer.length === 1 ? "" : "s"} in exchange for ${consideration.length} consideration item${consideration.length === 1 ? "" : "s"}.`;
    if (consideration.length === 0 || totalToOfferer === 0n) {
      findings.push({ severity: "critical", title: "You receive nothing", detail: "The order gives away the offered items with no payment coming back to you. This is the classic zero-price listing used to steal NFTs." });
    } else {
      findings.push({ severity: "medium", title: "Marketplace listing", detail: `${toOfferer.length} of ${consideration.length} consideration items pay you (${totalToOfferer.toString()} raw units in total). Check the price matches what the site showed.` });
    }
    if (target && !target.label) findings.push({ severity: "high", title: "Order for an unknown marketplace contract", detail: `verifyingContract ${verifying} is not a known Seaport deployment.` });
  } else {
    // Generic typed data: surface any address-valued fields that look like grants.
    const grantKeys = ["spender", "operator", "to", "recipient", "delegate", "authorized"];
    for (const [k, v] of Object.entries(m)) {
      decoded.push({ name: `message.${k}`, value: str(v).slice(0, 120) });
      if (grantKeys.includes(k) && typeof v === "string" && isAddress(v)) {
        const info = await addressInfo(enricher, chainId, v);
        counterparty = counterparty ?? info;
        findings.push({ severity: "medium", title: `Message grants something to ${short(v)}`, detail: `Field "${k}" names an address. Unknown message types with spender-like fields deserve the same care as approvals.` });
        findings.push(...counterpartyFindings(info, `Field ${k}`).filter((f) => f.severity !== "info"));
      }
    }
    findings.push({ severity: "info", title: "Unrecognised message type", detail: `SignLens does not know ${td.primaryType}. Confirm the site you are on matches domain "${domainName ?? "?"}" and the verifying contract.` });
  }

  return finish("typed-data", td.method, chainId, summary, findings, decoded, target, counterparty, token);
}

// -------------------------------------------------------------------------------------------------
// personal_sign and eth_sign
// -------------------------------------------------------------------------------------------------

const SIWE_RE = /^(?<domain>[^\s]+) wants you to sign in with your Ethereum account:\n(?<address>0x[0-9a-fA-F]{40})\n\n?(?<statement>[^\n]*)?\n*URI: (?<uri>\S+)\nVersion: (?<version>\S+)\nChain ID: (?<chainId>\d+)\nNonce: (?<nonce>\S+)\nIssued At: (?<issuedAt>\S+)/;

/** True when the decoded bytes read as text: mostly ASCII printable/whitespace, no control bytes. */
function looksLikeText(text: string): boolean {
  if (text.length === 0) return false;
  let ok = 0;
  for (const ch of text) {
    const c = ch.codePointAt(0) ?? 0;
    if (c === 9 || c === 10 || c === 13) ok++;
    else if (c >= 0x20 && c <= 0x7e) ok++;
    else if (c < 0x20 || (c >= 0x7f && c <= 0x9f)) return false;
  }
  return ok / [...text].length >= 0.7;
}

function analyzePersonalSign(req: PersonalSignRequest): Report {
  const findings: Finding[] = [];
  const decoded: DecodedField[] = [];
  let text = req.raw;
  let isHexInput = false;
  if (isHex(req.raw, { strict: false })) {
    isHexInput = true;
    try {
      text = hexToString(req.raw as Hex);
    } catch {
      text = "";
    }
  }
  const printable = looksLikeText(text);

  if (!printable) {
    if (isHexInput && req.raw.length === 66) {
      decoded.push({ name: "message", value: req.raw });
      findings.push({ severity: "high", title: "Hash-shaped message", detail: "The message is exactly 32 bytes and not text. Some drainers ask you to personal_sign a hash that is really an order or permit digest. Refuse unless the app explains exactly what the hash is." });
      return finish("personal-sign", req.method, req.chainId, "Signs an opaque 32-byte value with personal_sign.", findings, decoded, null, null, null);
    }
    decoded.push({ name: "message (hex)", value: req.raw.slice(0, 140) });
    findings.push({ severity: "medium", title: "Non-text message", detail: "The bytes do not decode to readable text, so you cannot know what you are agreeing to." });
    return finish("personal-sign", req.method, req.chainId, "Signs non-text bytes with personal_sign.", findings, decoded, null, null, null);
  }

  decoded.push({ name: "message", value: text.length > 400 ? `${text.slice(0, 400)}…` : text });
  const siwe = SIWE_RE.exec(text);
  if (siwe?.groups) {
    const { domain, uri, chainId, nonce } = siwe.groups;
    decoded.push({ name: "domain", value: domain ?? "" }, { name: "uri", value: uri ?? "" }, { name: "chainId", value: chainId ?? "" }, { name: "nonce", value: nonce ?? "" });
    let uriHost = "";
    try {
      uriHost = new URL(uri ?? "").host;
    } catch {
      uriHost = "";
    }
    if (uriHost && domain && uriHost !== domain) {
      findings.push({ severity: "medium", title: "Domain and URI disagree", detail: `The message names ${domain} but the URI points at ${uriHost}. Sign-in messages should be for the site you are actually on.` });
    } else {
      findings.push({ severity: "info", title: "Sign-In with Ethereum", detail: `A login message for ${domain}. It grants no on-chain permissions. Only sign if that is the site in your address bar.` });
    }
    return finish("personal-sign", req.method, req.chainId, `Signs in to ${domain} with your wallet (no on-chain permission granted).`, findings, decoded, null, null, null);
  }

  if (/permit|approve|allowance|authoriz/i.test(text)) {
    findings.push({ severity: "low", title: "Approval language in a plain message", detail: "personal_sign cannot grant token permissions by itself, but sites use such text to make a following approval feel routine." });
  } else {
    findings.push({ severity: "info", title: "Plain text message", detail: "Signing text proves you control the wallet. It cannot move funds on its own." });
  }
  return finish("personal-sign", req.method, req.chainId, "Signs a readable text message (no on-chain permission granted).", findings, decoded, null, null, null);
}

function analyzeEthSign(req: EthSignRequest): Report {
  return finish(
    "eth-sign",
    req.method,
    req.chainId,
    "Signs a raw 32-byte hash with eth_sign. The signature could authorise anything, including a transaction that empties the wallet.",
    [
      {
        severity: "critical",
        title: "eth_sign on a raw hash",
        detail: "eth_sign produces a signature over arbitrary bytes with no prefix and no structure. If those bytes are a transaction hash, the signature is a valid transaction. Most wallets disable this method; never enable it for a website.",
      },
    ],
    [{ name: "hash", value: req.hash }],
    null,
    null,
    null,
  );
}

// -------------------------------------------------------------------------------------------------

function finish(
  kind: Report["kind"],
  method: string,
  chainId: number | null,
  summary: string,
  findings: Finding[],
  decoded: DecodedField[],
  target: AddressInfo | null,
  counterparty: AddressInfo | null,
  token: TokenInfo | null,
): Report {
  const ordered = [...findings].sort((a, b) => {
    const order = ["critical", "high", "medium", "low", "info"];
    return order.indexOf(a.severity) - order.indexOf(b.severity);
  });
  return { kind, method, chainId, verdict: maxSeverity(ordered), summary, findings: ordered, decoded, target, counterparty, token };
}

async function analyzeBatch(batch: BatchRequest, enricher: Enricher): Promise<Report> {
  const children = await Promise.all(batch.calls.map((c) => analyzeTransaction(c, enricher)));
  const verdict = maxSeverity(children.map((c) => ({ severity: c.verdict })));
  const worst = children.find((c) => c.verdict === verdict);
  return {
    kind: "batch",
    method: batch.method,
    chainId: batch.chainId,
    verdict,
    summary: `Batch of ${children.length} calls. Worst: ${worst?.summary ?? "none"}`,
    findings: children.flatMap((c, i) => c.findings.map((f) => ({ ...f, title: `Call ${i + 1}: ${f.title}` }))),
    decoded: [{ name: "calls", value: String(children.length) }],
    target: null,
    counterparty: null,
    token: null,
    children,
  };
}

export async function analyzeParsed(req: ParsedRequest, enricher: Enricher = offlineEnricher): Promise<Report> {
  switch (req.kind) {
    case "transaction":
      return analyzeTransaction(req, enricher);
    case "batch":
      return analyzeBatch(req, enricher);
    case "typed-data":
      return analyzeTypedData(req, enricher);
    case "personal-sign":
      return analyzePersonalSign(req);
    case "eth-sign":
      return analyzeEthSign(req);
  }
}

export async function analyze(input: string, chainIdHint: number | null = null, enricher: Enricher = offlineEnricher): Promise<Report> {
  return analyzeParsed(parseRequest(input, chainIdHint), enricher);
}
