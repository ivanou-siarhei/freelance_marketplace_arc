// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";

/// @title JobEscrow
/// @notice Non-upgradeable, fee-free USDC escrow with pull payments and arbiter disputes.
/// @dev Intended for the constructor-supplied Arc USDC, not fee-on-transfer or rebasing tokens.
///      Amounts use the token's native units. Direct token donations do not create claims.
///      No owner, native-token deposit entry point, or withdrawal redirection. Funding can optionally use an
///      EIP-2612 permit so a client funds in one transaction.
contract JobEscrow is ReentrancyGuard {
    using SafeERC20 for IERC20;
    using SafeCast for uint256;

    /// @notice Minimum permitted arbiter timeout.
    uint64 public constant MIN_ARBITER_TIMEOUT = 5 minutes;
    /// @notice Maximum permitted arbiter timeout.
    uint64 public constant MAX_ARBITER_TIMEOUT = 30 days;
    /// @notice Absolute minimum delivery and review period.
    uint64 public constant MIN_PERIOD_FLOOR = 1 minutes;
    /// @notice Maximum delivery window at escrow creation.
    uint64 public constant MAX_DELIVERY_PERIOD = 90 days;
    /// @notice Maximum review period.
    uint64 public constant MAX_REVIEW_PERIOD = 30 days;

    /// @notice Token used for every deposit and withdrawal.
    IERC20 public immutable usdc;
    /// @notice Delay after a dispute before anyone can release all funds to the freelancer.
    uint64 public immutable arbiterTimeout;
    /// @notice Minimum delivery window at creation.
    uint64 public immutable minDeliveryPeriod;
    /// @notice Minimum review period accepted at creation.
    uint64 public immutable minReviewPeriod;
    /// @notice Current arbiter; only this address can replace itself.
    address public arbiter;

    /// @notice Lifecycle states; None identifies an unknown escrow.
    enum Status { None, Funded, Submitted, Disputed, Released, Resolved, Cancelled }

    /// @notice Escrow terms and lifecycle timestamps, all timestamps expressed in seconds.
    struct Escrow {
        address client;
        address freelancer;
        uint256 amount;
        uint64 deliveryDeadline;
        uint64 reviewPeriod;
        uint64 submittedAt;
        uint64 reviewEndsAt;
        uint64 disputedAt;
        bytes32 jobRef;
        bytes32 deliveryHash;
        Status status;
    }

    mapping(uint256 => Escrow) private _escrows;
    /// @notice Next id to allocate; ids start at one and are never reused.
    uint256 public nextEscrowId = 1;
    /// @notice Permanent reference uniqueness keyed by client and job reference together.
    mapping(address => mapping(bytes32 => uint256)) public escrowIdByRef;
    /// @notice Full balance available for an account to withdraw.
    mapping(address => uint256) public claimable;
    /// @notice Sum of amounts in Funded, Submitted, or Disputed escrows.
    uint256 public totalEscrowed;
    /// @notice Sum of all claimable balances.
    uint256 public totalClaimable;

    error ZeroAddress();
    error InvalidArbiterTimeout(uint64 value);
    error InvalidMinDeliveryPeriod(uint64 value);
    error InvalidMinReviewPeriod(uint64 value);
    error InvalidFreelancer();
    error ArbiterConflict();
    error ZeroAmount();
    error InvalidJobRef();
    error DuplicateJobRef(address client, bytes32 jobRef);
    error InvalidDeliveryDeadline(uint64 value);
    error InvalidReviewPeriod(uint64 value);
    error UnknownEscrow(uint256 escrowId);
    error NotClient();
    error NotFreelancer();
    error NotArbiter();
    error InvalidStatus(Status actual, Status expected);
    error InvalidDeliveryHash();
    error InvalidReasonHash();
    error TooEarly(uint256 earliestTimestamp);
    error TooLate(uint256 exclusiveDeadline);
    error InvalidFreelancerAmount(uint256 requested, uint256 available);
    error NothingToWithdraw();

    event EscrowCreated(
        uint256 indexed escrowId,
        bytes32 indexed jobRef,
        address indexed client,
        address freelancer,
        uint256 amount,
        uint64 deliveryDeadline,
        uint64 reviewPeriod
    );
    event WorkSubmitted(uint256 indexed escrowId, bytes32 deliveryHash, uint64 reviewEndsAt);
    event Approved(uint256 indexed escrowId, address freelancer, uint256 amount);
    event Cancelled(uint256 indexed escrowId, address client, uint256 amount);
    event Declined(uint256 indexed escrowId, address freelancer, address client, uint256 amount);
    event TimeoutClaimed(uint256 indexed escrowId, address freelancer, uint256 amount);
    event Disputed(uint256 indexed escrowId, bytes32 reasonHash, uint64 disputedAt);
    event Resolved(uint256 indexed escrowId, uint256 freelancerAmount, uint256 clientAmount);
    event StaleResolved(uint256 indexed escrowId, address freelancer, uint256 amount);
    event Withdrawn(address indexed account, uint256 amount);
    event ArbiterChanged(address indexed oldArbiter, address indexed newArbiter);

    /// @notice Initialize immutable token and timing settings and the initial arbiter.
    /// @param usdc_ USDC token address; never hardcoded by this contract.
    /// @param arbiter_ Initial dispute arbiter.
    /// @param arbiterTimeout_ Dispute fallback delay, between five minutes and thirty days.
    /// @param minDeliveryPeriod_ Minimum delivery window, between one minute and ninety days.
    /// @param minReviewPeriod_ Minimum review period, between one minute and thirty days.
    constructor(
        address usdc_,
        address arbiter_,
        uint64 arbiterTimeout_,
        uint64 minDeliveryPeriod_,
        uint64 minReviewPeriod_
    ) {
        if (usdc_ == address(0) || arbiter_ == address(0)) revert ZeroAddress();
        if (arbiterTimeout_ < MIN_ARBITER_TIMEOUT || arbiterTimeout_ > MAX_ARBITER_TIMEOUT) {
            revert InvalidArbiterTimeout(arbiterTimeout_);
        }
        if (minDeliveryPeriod_ < MIN_PERIOD_FLOOR || minDeliveryPeriod_ > MAX_DELIVERY_PERIOD) {
            revert InvalidMinDeliveryPeriod(minDeliveryPeriod_);
        }
        if (minReviewPeriod_ < MIN_PERIOD_FLOOR || minReviewPeriod_ > MAX_REVIEW_PERIOD) {
            revert InvalidMinReviewPeriod(minReviewPeriod_);
        }
        usdc = IERC20(usdc_);
        arbiter = arbiter_;
        arbiterTimeout = arbiterTimeout_;
        minDeliveryPeriod = minDeliveryPeriod_;
        minReviewPeriod = minReviewPeriod_;
        emit ArbiterChanged(address(0), arbiter_);
    }

    /// @notice Return the number of escrows ever created, including terminal escrows.
    function escrowCount() external view returns (uint256) {
        return nextEscrowId - 1;
    }

    /// @notice Return all escrow data; unknown ids revert rather than returning empty data.
    function getEscrow(uint256 id) external view returns (Escrow memory) {
        return _getEscrow(id);
    }

    /// @notice Fund a new escrow after approving this contract to spend USDC.
    /// @dev References are unique per client, including after settlement. All effects precede transferFrom.
    /// @param jobRef Nonzero client-scoped job reference.
    /// @param freelancer Recipient of payment for the work.
    /// @param amount Deposit in USDC base units.
    /// @param deliveryDeadline Earliest timestamp after which an unsubmitted escrow can be cancelled.
    /// @param reviewPeriod Length of the review window starting at submission.
    /// @return escrowId Newly allocated id.
    function createEscrow(
        bytes32 jobRef,
        address freelancer,
        uint256 amount,
        uint64 deliveryDeadline,
        uint64 reviewPeriod
    ) external nonReentrant returns (uint256 escrowId) {
        return _createEscrow(jobRef, freelancer, amount, deliveryDeadline, reviewPeriod);
    }

    /// @notice Fund a new escrow using an EIP-2612 permit in the same transaction.
    /// @dev Permit failure is deliberately ignored so a front-run permit that consumed the nonce
    ///      does not block funding. The subsequent transferFrom reverts if allowance is insufficient.
    /// @param jobRef Nonzero client-scoped job reference.
    /// @param freelancer Recipient of payment for the work.
    /// @param amount Deposit in USDC base units and permit allowance.
    /// @param deliveryDeadline Earliest timestamp after which an unsubmitted escrow can be cancelled.
    /// @param reviewPeriod Length of the review window starting at submission.
    /// @param permitDeadline Expiration timestamp of the signed permit.
    /// @param v Permit signature recovery identifier.
    /// @param r Permit signature r component.
    /// @param s Permit signature s component.
    /// @return escrowId Newly allocated id.
    function createEscrowWithPermit(
        bytes32 jobRef,
        address freelancer,
        uint256 amount,
        uint64 deliveryDeadline,
        uint64 reviewPeriod,
        uint256 permitDeadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external nonReentrant returns (uint256 escrowId) {
        try IERC20Permit(address(usdc)).permit(msg.sender, address(this), amount, permitDeadline, v, r, s) {} catch {}
        return _createEscrow(jobRef, freelancer, amount, deliveryDeadline, reviewPeriod);
    }

    function _createEscrow(
        bytes32 jobRef,
        address freelancer,
        uint256 amount,
        uint64 deliveryDeadline,
        uint64 reviewPeriod
    ) private returns (uint256 escrowId) {
        if (freelancer == address(0)) revert ZeroAddress();
        if (freelancer == msg.sender) revert InvalidFreelancer();
        if (arbiter == msg.sender || arbiter == freelancer) revert ArbiterConflict();
        if (amount == 0) revert ZeroAmount();
        if (jobRef == bytes32(0)) revert InvalidJobRef();
        if (escrowIdByRef[msg.sender][jobRef] != 0) revert DuplicateJobRef(msg.sender, jobRef);
        if (
            uint256(deliveryDeadline) < block.timestamp + minDeliveryPeriod
                || uint256(deliveryDeadline) > block.timestamp + MAX_DELIVERY_PERIOD
        ) revert InvalidDeliveryDeadline(deliveryDeadline);
        if (reviewPeriod < minReviewPeriod || reviewPeriod > MAX_REVIEW_PERIOD) {
            revert InvalidReviewPeriod(reviewPeriod);
        }

        escrowId = nextEscrowId++;
        _escrows[escrowId] = Escrow({
            client: msg.sender,
            freelancer: freelancer,
            amount: amount,
            deliveryDeadline: deliveryDeadline,
            reviewPeriod: reviewPeriod,
            submittedAt: 0,
            reviewEndsAt: 0,
            disputedAt: 0,
            jobRef: jobRef,
            deliveryHash: bytes32(0),
            status: Status.Funded
        });
        escrowIdByRef[msg.sender][jobRef] = escrowId;
        totalEscrowed += amount;
        emit EscrowCreated(escrowId, jobRef, msg.sender, freelancer, amount, deliveryDeadline, reviewPeriod);
        usdc.safeTransferFrom(msg.sender, address(this), amount);
    }

    /// @notice Submit work as the freelancer, including late work until cancellation wins the race.
    /// @dev There is deliberately no delivery-deadline check here.
    function submitWork(uint256 escrowId, bytes32 deliveryHash) external {
        Escrow storage escrow = _getEscrow(escrowId);
        if (msg.sender != escrow.freelancer) revert NotFreelancer();
        _requireStatus(escrow, Status.Funded);
        if (deliveryHash == bytes32(0)) revert InvalidDeliveryHash();

        escrow.submittedAt = block.timestamp.toUint64();
        escrow.reviewEndsAt = (block.timestamp + escrow.reviewPeriod).toUint64();
        escrow.deliveryHash = deliveryHash;
        escrow.status = Status.Submitted;
        emit WorkSubmitted(escrowId, deliveryHash, escrow.reviewEndsAt);
    }

    /// @notice Approve submitted work as the client, without a review-window restriction.
    function approve(uint256 escrowId) external {
        Escrow storage escrow = _getEscrow(escrowId);
        if (msg.sender != escrow.client) revert NotClient();
        _requireStatus(escrow, Status.Submitted);
        _settle(escrow, Status.Released, escrow.amount);
        emit Approved(escrowId, escrow.freelancer, escrow.amount);
    }

    /// @notice Cancel unsubmitted work as the client strictly after its delivery deadline.
    function cancel(uint256 escrowId) external {
        Escrow storage escrow = _getEscrow(escrowId);
        if (msg.sender != escrow.client) revert NotClient();
        _requireStatus(escrow, Status.Funded);
        if (block.timestamp <= escrow.deliveryDeadline) {
            revert TooEarly(uint256(escrow.deliveryDeadline) + 1);
        }
        _settle(escrow, Status.Cancelled, 0);
        emit Cancelled(escrowId, escrow.client, escrow.amount);
    }

    /// @notice Decline an unsubmitted job as the freelancer and refund the client's claim balance.
    function decline(uint256 escrowId) external {
        Escrow storage escrow = _getEscrow(escrowId);
        if (msg.sender != escrow.freelancer) revert NotFreelancer();
        _requireStatus(escrow, Status.Funded);
        _settle(escrow, Status.Cancelled, 0);
        emit Declined(escrowId, escrow.freelancer, escrow.client, escrow.amount);
    }

    /// @notice Anyone may credit the freelancer at or after the review-window end.
    function claimAfterTimeout(uint256 escrowId) external {
        Escrow storage escrow = _getEscrow(escrowId);
        _requireStatus(escrow, Status.Submitted);
        if (block.timestamp < escrow.reviewEndsAt) revert TooEarly(escrow.reviewEndsAt);
        _settle(escrow, Status.Released, escrow.amount);
        emit TimeoutClaimed(escrowId, escrow.freelancer, escrow.amount);
    }

    /// @notice Dispute submitted work as the client strictly before the review-window end.
    function dispute(uint256 escrowId, bytes32 reasonHash) external {
        Escrow storage escrow = _getEscrow(escrowId);
        if (msg.sender != escrow.client) revert NotClient();
        _requireStatus(escrow, Status.Submitted);
        if (block.timestamp >= escrow.reviewEndsAt) revert TooLate(escrow.reviewEndsAt);
        if (reasonHash == bytes32(0)) revert InvalidReasonHash();
        escrow.disputedAt = block.timestamp.toUint64();
        escrow.status = Status.Disputed;
        emit Disputed(escrowId, reasonHash, escrow.disputedAt);
    }

    /// @notice Split a disputed escrow as the current, non-conflicted arbiter.
    /// @dev Allowed even after the stale deadline until someone actually calls resolveStale.
    /// @param escrowId Escrow to resolve.
    /// @param freelancerAmount Amount credited to the freelancer; the remainder goes to the client.
    function resolve(uint256 escrowId, uint256 freelancerAmount) external {
        Escrow storage escrow = _getEscrow(escrowId);
        if (msg.sender != arbiter) revert NotArbiter();
        _requireStatus(escrow, Status.Disputed);
        if (arbiter == escrow.client || arbiter == escrow.freelancer) revert ArbiterConflict();
        if (freelancerAmount > escrow.amount) {
            revert InvalidFreelancerAmount(freelancerAmount, escrow.amount);
        }
        uint256 clientAmount = escrow.amount - freelancerAmount;
        _settle(escrow, Status.Resolved, freelancerAmount);
        emit Resolved(escrowId, freelancerAmount, clientAmount);
    }

    /// @notice Anyone may resolve a stale dispute, crediting 100% to the freelancer.
    /// @dev Succeeds at the exact disputedAt + arbiterTimeout boundary.
    function resolveStale(uint256 escrowId) external {
        Escrow storage escrow = _getEscrow(escrowId);
        _requireStatus(escrow, Status.Disputed);
        uint256 staleAt = uint256(escrow.disputedAt) + arbiterTimeout;
        if (block.timestamp < staleAt) revert TooEarly(staleAt);
        _settle(escrow, Status.Resolved, escrow.amount);
        emit StaleResolved(escrowId, escrow.freelancer, escrow.amount);
    }

    /// @notice Withdraw the caller's entire claimable balance to the caller only.
    /// @return amount USDC base units withdrawn.
    function withdraw() external nonReentrant returns (uint256 amount) {
        amount = claimable[msg.sender];
        if (amount == 0) revert NothingToWithdraw();
        claimable[msg.sender] = 0;
        totalClaimable -= amount;
        emit Withdrawn(msg.sender, amount);
        usdc.safeTransfer(msg.sender, amount);
    }

    /// @notice Replace the arbiter as the current arbiter; existing escrows use the new arbiter.
    /// @dev Per-escrow conflicts after rotation are rejected by resolve; stale resolution remains available.
    function setArbiter(address newArbiter) external {
        if (msg.sender != arbiter) revert NotArbiter();
        if (newArbiter == address(0)) revert ZeroAddress();
        address oldArbiter = arbiter;
        arbiter = newArbiter;
        emit ArbiterChanged(oldArbiter, newArbiter);
    }

    /// @dev All id-based entry points, including getEscrow, reject unknown ids here.
    function _getEscrow(uint256 escrowId) private view returns (Escrow storage escrow) {
        escrow = _escrows[escrowId];
        if (escrow.status == Status.None) revert UnknownEscrow(escrowId);
    }

    /// @dev Require one exact lifecycle state before applying any transition.
    function _requireStatus(Escrow storage escrow, Status expected) private view {
        if (escrow.status != expected) revert InvalidStatus(escrow.status, expected);
    }

    /// @dev Move the entire active liability into pull-payment claims, without external calls.
    ///      Callers validate active state and freelancerAmount <= amount and emit their transition event.
    function _settle(Escrow storage escrow, Status finalStatus, uint256 freelancerAmount) private {
        uint256 amount = escrow.amount;
        uint256 clientAmount = amount - freelancerAmount;
        escrow.status = finalStatus;
        totalEscrowed -= amount;
        totalClaimable += amount;
        if (freelancerAmount != 0) claimable[escrow.freelancer] += freelancerAmount;
        if (clientAmount != 0) claimable[escrow.client] += clientAmount;
    }
}
