// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {EvmV1Decoder} from "@gluwa/asc-contracts/contracts/common/EvmV1Decoder.sol";

import {AttestedBase} from "./AttestedBase.sol";

/// @title CreditPassport
/// @notice A portable credit history on Creditcoin built only from payments that provably happened
///         on the source chain, plus a credit line underwritten against that history.
///
///         Flow:
///           1. A payer settles invoices through `PaymentRail` on the source chain.
///           2. Anyone submits Attestcoin inclusion proofs of those transactions here. The contract
///              decodes the receipt, keeps only `InvoicePaid` logs emitted by the registered rail, and
///              records each as on-time or late. Plain `Transfer` logs of the registered settlement
///              token are accepted as undated payments.
///           3. The underwriting agent reads the verified history and calls `underwrite`. The
///              contract caps the credit limit as a function of verified volume and on-time ratio, so
///              the agent decides within bounds set by proven data rather than by its own claims.
///           4. The payer draws `CREDIT_TOKEN` against the limit and repays.
///
///         No oracle operator signs anything. The only trust roots are the Creditcoin attestation of
///         the source chain and the owner's registration of which source contracts count.
contract CreditPassport is AttestedBase, Ownable {
    using SafeERC20 for IERC20;

    enum Action {
        InvoicePaid,
        TokenTransfer
    }

    /// @dev keccak256("InvoicePaid(bytes32,address,address,uint256,uint64,uint64)")
    bytes32 public constant INVOICE_PAID_SIG = keccak256("InvoicePaid(bytes32,address,address,uint256,uint64,uint64)");
    /// @dev keccak256("Transfer(address,address,uint256)")
    bytes32 public constant TRANSFER_SIG = keccak256("Transfer(address,address,uint256)");

    uint16 public constant MAX_SCORE = 1000;
    /// @notice Credit limit cap as a share of verified volume, in basis points (50%).
    uint256 public constant LIMIT_BPS_OF_VOLUME = 5_000;
    /// @notice Weight applied to volume that has no due date (plain transfers), in basis points.
    uint256 public constant UNDATED_WEIGHT_BPS = 5_000;
    uint256 private constant BPS = 10_000;

    struct Payment {
        bytes32 invoiceId; // zero for undated transfers
        address payer;
        address payee;
        uint256 amount;
        uint64 dueBlock; // zero for undated transfers
        uint64 paidBlock;
        uint64 sourceBlock; // block the proven transaction was included in
        uint64 sourceTxIndex; // its index in that block, so the source tx is resolvable
        bytes32 queryId;
    }

    struct Profile {
        uint256 datedVolume; // sum of InvoicePaid amounts
        uint256 undatedVolume; // sum of plain Transfer amounts
        uint32 onTimeCount;
        uint32 lateCount;
        uint32 transferCount;
        uint64 firstPaidBlock;
        uint64 lastPaidBlock;
        uint16 score;
        uint256 creditLimit;
        uint256 drawn;
        uint64 underwrittenAt;
        string memoURI;
    }

    /// @notice Token drawn against credit lines on this chain.
    IERC20 public immutable CREDIT_TOKEN;

    /// @notice Source-chain `PaymentRail` whose `InvoicePaid` logs are trusted.
    address public paymentRail;
    /// @notice Source-chain token whose `Transfer` logs are trusted as undated payments.
    address public settlementToken;
    /// @notice Address allowed to underwrite.
    address public agent;

    mapping(address payer => Profile) private _profiles;
    mapping(address payer => Payment[]) private _payments;

    event SourcesUpdated(address indexed paymentRail, address indexed settlementToken);
    event AgentUpdated(address indexed agent);
    event PaymentVerified(
        address indexed payer,
        address indexed payee,
        bytes32 indexed invoiceId,
        uint256 amount,
        uint64 dueBlock,
        uint64 paidBlock,
        bool onTime,
        bytes32 queryId
    );
    event Underwritten(address indexed user, uint16 score, uint256 creditLimit, uint256 policyMax, string memoURI);
    event Drawn(address indexed user, uint256 amount, uint256 drawn);
    event Repaid(address indexed user, uint256 amount, uint256 drawn);

    error NotAgent();
    error ZeroAddress();
    error SourcesNotSet();
    error UnsupportedTransactionType(uint8 txType);
    error SourceTransactionFailed();
    error NoMatchingLogs();
    error InvalidAction(uint8 action);
    error MalformedLog();
    error ScoreOutOfRange(uint16 score);
    error LimitExceedsPolicy(uint256 requested, uint256 policyMax);
    error LimitBelowDrawn(uint256 requested, uint256 drawn);
    error ExceedsCreditLimit(uint256 requested, uint256 available);
    error NothingToRepay();
    error ZeroAmount();

    modifier onlyAgent() {
        if (msg.sender != agent) revert NotAgent();
        _;
    }

    constructor(uint64 sourceChainKey, IERC20 creditToken, address initialOwner)
        AttestedBase(sourceChainKey)
        Ownable(initialOwner)
    {
        if (address(creditToken) == address(0)) revert ZeroAddress();
        CREDIT_TOKEN = creditToken;
    }

    // ---------------------------------------------------------------------------------------------
    // Administration
    // ---------------------------------------------------------------------------------------------

    function setSources(address rail, address token) external onlyOwner {
        if (rail == address(0) || token == address(0)) revert ZeroAddress();
        paymentRail = rail;
        settlementToken = token;
        emit SourcesUpdated(rail, token);
    }

    function setAgent(address newAgent) external onlyOwner {
        if (newAgent == address(0)) revert ZeroAddress();
        agent = newAgent;
        emit AgentUpdated(newAgent);
    }

    /// @notice Owner treasury management for the credit pool.
    function withdrawCreditToken(address to, uint256 amount) external onlyOwner {
        CREDIT_TOKEN.safeTransfer(to, amount);
    }

    // ---------------------------------------------------------------------------------------------
    // Proof processing (called by AttestedBase after verification)
    // ---------------------------------------------------------------------------------------------

    function _processAndEmitEvent(
        uint8 action,
        bytes32 queryId,
        uint64 blockHeight,
        uint64 txIndex,
        bytes memory encodedTransaction
    ) internal override {
        if (paymentRail == address(0)) revert SourcesNotSet();

        uint8 txType = EvmV1Decoder.getTransactionType(encodedTransaction);
        if (!EvmV1Decoder.isValidTransactionType(txType)) revert UnsupportedTransactionType(txType);

        EvmV1Decoder.ReceiptFields memory receipt = EvmV1Decoder.decodeReceiptFields(encodedTransaction);
        if (receipt.receiptStatus != 1) revert SourceTransactionFailed();

        Source memory source = Source({queryId: queryId, blockHeight: blockHeight, txIndex: txIndex});
        if (action == uint8(Action.InvoicePaid)) {
            _recordInvoices(receipt, source);
        } else if (action == uint8(Action.TokenTransfer)) {
            _recordTransfers(receipt, source);
        } else {
            revert InvalidAction(action);
        }
    }

    /// @dev Every `InvoicePaid` log emitted by the registered rail is recorded. Logs with the same
    ///      signature from any other emitter are ignored, so a transaction that also touches a
    ///      look-alike contract cannot smuggle records in; if nothing came from the rail, revert.
    /// @dev Identity of the proven source transaction, threaded through the recording helpers.
    struct Source {
        bytes32 queryId;
        uint64 blockHeight;
        uint64 txIndex;
    }

    function _recordInvoices(EvmV1Decoder.ReceiptFields memory receipt, Source memory source) internal {
        EvmV1Decoder.LogEntry[] memory logs = EvmV1Decoder.getLogsByEventSignature(receipt, INVOICE_PAID_SIG);
        uint256 matched;
        for (uint256 i; i < logs.length; ++i) {
            EvmV1Decoder.LogEntry memory log = logs[i];
            if (log.address_ != paymentRail) continue;
            if (log.topics.length != 4 || log.data.length != 96) revert MalformedLog();

            (uint256 amount, uint64 dueBlock, uint64 paidBlock) = abi.decode(log.data, (uint256, uint64, uint64));
            _record(
                Payment({
                    invoiceId: log.topics[1],
                    payer: address(uint160(uint256(log.topics[2]))),
                    payee: address(uint160(uint256(log.topics[3]))),
                    amount: amount,
                    dueBlock: dueBlock,
                    paidBlock: paidBlock,
                    sourceBlock: source.blockHeight,
                    sourceTxIndex: source.txIndex,
                    queryId: source.queryId
                })
            );
            ++matched;
        }
        if (matched == 0) revert NoMatchingLogs();
    }

    /// @dev Plain ERC-20 transfers of the settlement token count as undated payments by `from`.
    ///      Mints (`from == 0`) are not payments and are skipped.
    function _recordTransfers(EvmV1Decoder.ReceiptFields memory receipt, Source memory source) internal {
        EvmV1Decoder.LogEntry[] memory logs = EvmV1Decoder.getLogsByEventSignature(receipt, TRANSFER_SIG);
        uint256 matched;
        for (uint256 i; i < logs.length; ++i) {
            EvmV1Decoder.LogEntry memory log = logs[i];
            if (log.address_ != settlementToken) continue;
            if (log.topics.length != 3 || log.data.length != 32) revert MalformedLog();

            address from = address(uint160(uint256(log.topics[1])));
            if (from == address(0)) continue;

            _record(
                Payment({
                    invoiceId: bytes32(0),
                    payer: from,
                    payee: address(uint160(uint256(log.topics[2]))),
                    amount: abi.decode(log.data, (uint256)),
                    dueBlock: 0,
                    paidBlock: source.blockHeight,
                    sourceBlock: source.blockHeight,
                    sourceTxIndex: source.txIndex,
                    queryId: source.queryId
                })
            );
            ++matched;
        }
        if (matched == 0) revert NoMatchingLogs();
    }

    function _record(Payment memory p) internal {
        Profile storage profile = _profiles[p.payer];
        _payments[p.payer].push(p);

        bool dated = p.dueBlock != 0;
        bool onTime = dated && p.paidBlock <= p.dueBlock;
        if (dated) {
            profile.datedVolume += p.amount;
            if (onTime) ++profile.onTimeCount;
            else ++profile.lateCount;
        } else {
            profile.undatedVolume += p.amount;
            ++profile.transferCount;
        }
        if (profile.firstPaidBlock == 0 || p.paidBlock < profile.firstPaidBlock) profile.firstPaidBlock = p.paidBlock;
        if (p.paidBlock > profile.lastPaidBlock) profile.lastPaidBlock = p.paidBlock;

        emit PaymentVerified(p.payer, p.payee, p.invoiceId, p.amount, p.dueBlock, p.paidBlock, onTime, p.queryId);
    }

    // ---------------------------------------------------------------------------------------------
    // Underwriting policy
    // ---------------------------------------------------------------------------------------------

    /// @notice The largest credit limit the agent may grant `user`, derived only from verified history.
    /// @dev    cap = 50% of dated volume scaled by on-time ratio, plus 25% of undated volume.
    ///         A payer with more late than on-time payments gets no dated credit at all.
    function maxCreditLimit(address user) public view returns (uint256) {
        Profile storage p = _profiles[user];
        uint256 undatedCap = (p.undatedVolume * LIMIT_BPS_OF_VOLUME * UNDATED_WEIGHT_BPS) / (BPS * BPS);

        uint256 dated = uint256(p.onTimeCount) + p.lateCount;
        if (dated == 0) return undatedCap;
        if (p.lateCount > p.onTimeCount) return undatedCap;

        uint256 datedCap = (p.datedVolume * LIMIT_BPS_OF_VOLUME) / BPS;
        return undatedCap + (datedCap * p.onTimeCount) / dated;
    }

    /// @notice Record the agent's decision for `user`. The limit must fit the policy cap.
    /// @param memoURI Where the agent's underwriting memo lives (data: URI or content-addressed link).
    function underwrite(address user, uint16 score, uint256 creditLimit, string calldata memoURI) external onlyAgent {
        if (score > MAX_SCORE) revert ScoreOutOfRange(score);
        uint256 policyMax = maxCreditLimit(user);
        if (creditLimit > policyMax) revert LimitExceedsPolicy(creditLimit, policyMax);

        Profile storage p = _profiles[user];
        if (creditLimit < p.drawn) revert LimitBelowDrawn(creditLimit, p.drawn);

        p.score = score;
        p.creditLimit = creditLimit;
        p.underwrittenAt = uint64(block.number);
        p.memoURI = memoURI;

        emit Underwritten(user, score, creditLimit, policyMax, memoURI);
    }

    // ---------------------------------------------------------------------------------------------
    // Credit line
    // ---------------------------------------------------------------------------------------------

    function availableCredit(address user) public view returns (uint256) {
        Profile storage p = _profiles[user];
        return p.creditLimit > p.drawn ? p.creditLimit - p.drawn : 0;
    }

    function draw(uint256 amount) external {
        if (amount == 0) revert ZeroAmount();
        uint256 available = availableCredit(msg.sender);
        if (amount > available) revert ExceedsCreditLimit(amount, available);

        Profile storage p = _profiles[msg.sender];
        p.drawn += amount;
        CREDIT_TOKEN.safeTransfer(msg.sender, amount);
        emit Drawn(msg.sender, amount, p.drawn);
    }

    /// @notice Repay up to the outstanding balance; any excess in `amount` is ignored, not pulled.
    function repay(uint256 amount) external {
        if (amount == 0) revert ZeroAmount();
        Profile storage p = _profiles[msg.sender];
        if (p.drawn == 0) revert NothingToRepay();
        if (amount > p.drawn) amount = p.drawn;

        p.drawn -= amount;
        CREDIT_TOKEN.safeTransferFrom(msg.sender, address(this), amount);
        emit Repaid(msg.sender, amount, p.drawn);
    }

    // ---------------------------------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------------------------------

    function getProfile(address user) external view returns (Profile memory) {
        return _profiles[user];
    }

    function getPayments(address user) external view returns (Payment[] memory) {
        return _payments[user];
    }

    function paymentCount(address user) external view returns (uint256) {
        return _payments[user].length;
    }
}
