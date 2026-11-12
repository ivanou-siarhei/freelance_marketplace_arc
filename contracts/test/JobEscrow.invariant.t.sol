// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test, console2} from "forge-std/Test.sol";
import {JobEscrow} from "../JobEscrow.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";

/// @dev Drives bounded, mostly-valid random sequences of escrow actions across a fixed actor set.
contract JobEscrowHandler is Test {
    JobEscrow public escrow;
    MockUSDC public usdc;

    address[] internal _actors;
    address public initialArbiter;
    uint256 internal _refNonce;

    // success counters (non-vacuity evidence)
    uint256 public nCreate;
    uint256 public nSubmit;
    uint256 public nApprove;
    uint256 public nCancel;
    uint256 public nDecline;
    uint256 public nClaim;
    uint256 public nDispute;
    uint256 public nResolve;
    uint256 public nStale;
    uint256 public nWithdraw;
    uint256 public nDonate;

    constructor(JobEscrow escrow_, MockUSDC usdc_, address initialArbiter_) {
        escrow = escrow_;
        usdc = usdc_;
        initialArbiter = initialArbiter_;
        for (uint256 i; i < 4; ++i) {
            address a = makeAddr(string.concat("actor", vm.toString(i)));
            _actors.push(a);
            usdc.mint(a, 1e15);
            vm.prank(a);
            usdc.approve(address(escrow), type(uint256).max);
        }
    }

    function actors() external view returns (address[] memory) {
        return _actors;
    }

    function _actor(uint256 seed) internal view returns (address) {
        return _actors[seed % _actors.length];
    }

    function _id(uint256 seed) internal view returns (uint256) {
        return bound(seed, 1, escrow.escrowCount());
    }

    function create(uint256 cSeed, uint256 fSeed, uint256 amount, uint256 deadlineOff, uint256 review) external {
        address c = _actor(cSeed);
        address f = _actor(fSeed);
        amount = bound(amount, 1, 1e9);
        uint64 dl = uint64(block.timestamp + bound(deadlineOff, 1 hours, 90 days));
        uint64 rv = uint64(bound(review, 1 hours, 30 days));
        vm.prank(c);
        try escrow.createEscrow(keccak256(abi.encode(++_refNonce)), f, amount, dl, rv) {
            ++nCreate;
        } catch {}
    }

    function submit(uint256 idSeed, bytes32 h) external {
        if (escrow.escrowCount() == 0) return;
        uint256 id = _id(idSeed);
        if (h == bytes32(0)) h = bytes32(uint256(1));
        vm.prank(escrow.getEscrow(id).freelancer);
        try escrow.submitWork(id, h) {
            ++nSubmit;
        } catch {}
    }

    function approve(uint256 idSeed) external {
        if (escrow.escrowCount() == 0) return;
        uint256 id = _id(idSeed);
        vm.prank(escrow.getEscrow(id).client);
        try escrow.approve(id) {
            ++nApprove;
        } catch {}
    }

    function cancel(uint256 idSeed) external {
        if (escrow.escrowCount() == 0) return;
        uint256 id = _id(idSeed);
        vm.prank(escrow.getEscrow(id).client);
        try escrow.cancel(id) {
            ++nCancel;
        } catch {}
    }

    function decline(uint256 idSeed) external {
        if (escrow.escrowCount() == 0) return;
        uint256 id = _id(idSeed);
        vm.prank(escrow.getEscrow(id).freelancer);
        try escrow.decline(id) {
            ++nDecline;
        } catch {}
    }

    function claimAfterTimeout(uint256 idSeed, uint256 callerSeed) external {
        if (escrow.escrowCount() == 0) return;
        vm.prank(_actor(callerSeed));
        try escrow.claimAfterTimeout(_id(idSeed)) {
            ++nClaim;
        } catch {}
    }

    function dispute(uint256 idSeed, bytes32 reason) external {
        if (escrow.escrowCount() == 0) return;
        uint256 id = _id(idSeed);
        if (reason == bytes32(0)) reason = bytes32(uint256(1));
        vm.prank(escrow.getEscrow(id).client);
        try escrow.dispute(id, reason) {
            ++nDispute;
        } catch {}
    }

    function resolve(uint256 idSeed, uint256 fAmountSeed) external {
        if (escrow.escrowCount() == 0) return;
        uint256 id = _id(idSeed);
        uint256 fa = bound(fAmountSeed, 0, escrow.getEscrow(id).amount);
        vm.prank(escrow.arbiter());
        try escrow.resolve(id, fa) {
            ++nResolve;
        } catch {}
    }

    function resolveStale(uint256 idSeed, uint256 callerSeed) external {
        if (escrow.escrowCount() == 0) return;
        vm.prank(_actor(callerSeed));
        try escrow.resolveStale(_id(idSeed)) {
            ++nStale;
        } catch {}
    }

    function withdraw(uint256 callerSeed) external {
        vm.prank(_actor(callerSeed));
        try escrow.withdraw() {
            ++nWithdraw;
        } catch {}
    }

    /// @dev Rotate the arbiter, sometimes to an actor to exercise ArbiterConflict paths.
    function rotateArbiter(uint256 seed) external {
        address next = seed % 8 == 0 ? _actor(seed / 8) : initialArbiter;
        vm.prank(escrow.arbiter());
        try escrow.setArbiter(next) {} catch {}
    }

    /// @dev Anyone can donate USDC directly; this must never create claims.
    function donate(uint256 amount) external {
        amount = bound(amount, 1, 1e8);
        usdc.mint(address(escrow), amount);
        ++nDonate;
    }

    function warp(uint256 dt) external {
        dt = bound(dt, 0, 5 days);
        vm.warp(block.timestamp + dt);
    }
}

contract JobEscrowInvariantTest is Test {
    JobEscrow internal escrow;
    MockUSDC internal usdc;
    JobEscrowHandler internal handler;
    address internal arbiter = makeAddr("arbiter");

    function setUp() public {
        vm.warp(1_700_000_000);
        usdc = new MockUSDC();
        escrow = new JobEscrow(address(usdc), arbiter, 1 days, 1 hours, 1 hours);
        handler = new JobEscrowHandler(escrow, usdc, arbiter);
        targetContract(address(handler));
    }

    /// @dev Token balance always covers every recorded liability (>= because donations are allowed).
    function invariant_BalanceCoversLiabilities() public view {
        assertGe(usdc.balanceOf(address(escrow)), escrow.totalEscrowed() + escrow.totalClaimable());
    }

    /// @dev totalEscrowed == Σ amount over Funded/Submitted/Disputed escrows.
    function invariant_TotalEscrowedMatchesActiveEscrows() public view {
        uint256 sum;
        uint256 n = escrow.escrowCount();
        for (uint256 i = 1; i <= n; ++i) {
            JobEscrow.Escrow memory e = escrow.getEscrow(i);
            if (
                e.status == JobEscrow.Status.Funded || e.status == JobEscrow.Status.Submitted
                    || e.status == JobEscrow.Status.Disputed
            ) sum += e.amount;
        }
        assertEq(escrow.totalEscrowed(), sum);
    }

    /// @dev totalClaimable == Σ claimable[actor] (only actors can ever hold claims).
    function invariant_TotalClaimableMatchesBalances() public view {
        address[] memory a = handler.actors();
        uint256 sum;
        for (uint256 i; i < a.length; ++i) {
            sum += escrow.claimable(a[i]);
        }
        assertEq(escrow.totalClaimable(), sum);
    }

    /// @dev Ids are dense and nextEscrowId tracks the count.
    function invariant_IdsAreDense() public view {
        assertEq(escrow.nextEscrowId(), escrow.escrowCount() + 1);
    }

    function afterInvariant() public view {
        console2.log("create", handler.nCreate());
        console2.log("submit", handler.nSubmit());
        console2.log("approve", handler.nApprove());
        console2.log("cancel", handler.nCancel());
        console2.log("decline", handler.nDecline());
        console2.log("claimTimeout", handler.nClaim());
        console2.log("dispute", handler.nDispute());
        console2.log("resolve", handler.nResolve());
        console2.log("stale", handler.nStale());
        console2.log("withdraw", handler.nWithdraw());
    }
}
