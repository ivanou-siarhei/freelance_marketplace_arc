// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test, console2} from "forge-std/Test.sol";
import {JobEscrow} from "../JobEscrow.sol";
import {MockPermitUSDC} from "./mocks/MockPermitUSDC.sol";
import {PermitSigning} from "./JobEscrow.permit.t.sol";

/// @dev Drives permit-funded and plain escrow creation (incl. front-run, garbage, expired permits) plus lifecycle.
contract PermitHandler is PermitSigning {
    JobEscrow public escrow;
    MockPermitUSDC public token;

    address[] internal _actors;
    uint256[] internal _pks;
    uint256 internal _refNonce;

    uint256 public nValid;
    uint256 public nFrontRun;
    uint256 public nGarbageWithAllowance;
    uint256 public nExpiredRejected;
    uint256 public nPlain;
    uint256 public nSettled;

    constructor(JobEscrow escrow_, MockPermitUSDC token_) {
        escrow = escrow_;
        token = token_;
        for (uint256 i; i < 3; ++i) {
            (address a, uint256 pk) = makeAddrAndKey(string.concat("pactor", vm.toString(i)));
            _actors.push(a);
            _pks.push(pk);
            token.mint(a, 1e15); // deliberately NO approval: funding needs permit or an explicit approve
        }
    }

    function actors() external view returns (address[] memory) {
        return _actors;
    }

    function createWithPermit(uint256 cSeed, uint256 fSeed, uint256 amount, uint256 mode) external {
        uint256 ci = cSeed % 3;
        address c = _actors[ci];
        address f = _actors[fSeed % 3];
        amount = bound(amount, 1, 1e9);
        uint64 dl = uint64(block.timestamp + 7 days);
        uint256 pd = block.timestamp + 1 hours;
        mode = mode % 5;
        if (mode == 4) pd = block.timestamp - 1; // expired
        (uint8 v, bytes32 r, bytes32 s) = _sign(token, _pks[ci], c, address(escrow), amount, pd);

        if (mode == 1) {
            // front-run: someone else lands the identical permit first
            try token.permit(c, address(escrow), amount, pd, v, r, s) {} catch {}
        } else if (mode == 2) {
            // garbage signature, but sufficient pre-existing allowance
            vm.prank(c);
            token.approve(address(escrow), amount);
            (v, r, s) = (27, bytes32(uint256(1)), bytes32(uint256(2)));
        } else if (mode == 3) {
            vm.prank(c);
            token.approve(address(escrow), amount);
            vm.prank(c);
            try escrow.createEscrow(keccak256(abi.encode(++_refNonce)), f, amount, dl, 3 days) {
                ++nPlain;
            } catch {}
            return;
        }

        vm.prank(c);
        try escrow.createEscrowWithPermit(keccak256(abi.encode(++_refNonce)), f, amount, dl, 3 days, pd, v, r, s) {
            if (mode == 0) ++nValid;
            else if (mode == 1) ++nFrontRun;
            else if (mode == 2) ++nGarbageWithAllowance;
        } catch {
            if (mode == 4) ++nExpiredRejected;
        }
    }

    function submit(uint256 idSeed, bytes32 h) external {
        uint256 n = escrow.escrowCount();
        if (n == 0) return;
        uint256 id = bound(idSeed, 1, n);
        if (h == bytes32(0)) h = bytes32(uint256(1));
        vm.prank(escrow.getEscrow(id).freelancer);
        try escrow.submitWork(id, h) {} catch {}
    }

    function approve(uint256 idSeed) external {
        uint256 n = escrow.escrowCount();
        if (n == 0) return;
        uint256 id = bound(idSeed, 1, n);
        vm.prank(escrow.getEscrow(id).client);
        try escrow.approve(id) {
            ++nSettled;
        } catch {}
    }

    function cancel(uint256 idSeed) external {
        uint256 n = escrow.escrowCount();
        if (n == 0) return;
        uint256 id = bound(idSeed, 1, n);
        vm.prank(escrow.getEscrow(id).client);
        try escrow.cancel(id) {
            ++nSettled;
        } catch {}
    }

    function decline(uint256 idSeed) external {
        uint256 n = escrow.escrowCount();
        if (n == 0) return;
        uint256 id = bound(idSeed, 1, n);
        vm.prank(escrow.getEscrow(id).freelancer);
        try escrow.decline(id) {
            ++nSettled;
        } catch {}
    }

    function withdraw(uint256 seed) external {
        vm.prank(_actors[seed % 3]);
        try escrow.withdraw() {} catch {}
    }

    function warp(uint256 dt) external {
        vm.warp(block.timestamp + bound(dt, 0, 10 days));
    }
}

contract JobEscrowPermitInvariantTest is Test {
    JobEscrow internal escrow;
    MockPermitUSDC internal token;
    PermitHandler internal handler;

    function setUp() public {
        vm.warp(1_700_000_000);
        token = new MockPermitUSDC();
        escrow = new JobEscrow(address(token), makeAddr("arbiter"), 1 days, 1 hours, 1 hours);
        handler = new PermitHandler(escrow, token);
        targetContract(address(handler));
    }

    function invariant_BalanceCoversLiabilities() public view {
        assertGe(token.balanceOf(address(escrow)), escrow.totalEscrowed() + escrow.totalClaimable());
    }

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

    function invariant_TotalClaimableMatchesBalances() public view {
        address[] memory a = handler.actors();
        uint256 sum;
        for (uint256 i; i < a.length; ++i) {
            sum += escrow.claimable(a[i]);
        }
        assertEq(escrow.totalClaimable(), sum);
    }

    /// @dev With exact-amount permits/approvals, the escrow's token balance equals liabilities exactly (no donations here).
    function invariant_BalanceEqualsLiabilities() public view {
        assertEq(token.balanceOf(address(escrow)), escrow.totalEscrowed() + escrow.totalClaimable());
    }

    function invariant_IdsAreDense() public view {
        assertEq(escrow.nextEscrowId(), escrow.escrowCount() + 1);
    }

    function afterInvariant() public view {
        console2.log("valid", handler.nValid());
        console2.log("frontRun", handler.nFrontRun());
        console2.log("garbage+allowance", handler.nGarbageWithAllowance());
        console2.log("expiredRejected", handler.nExpiredRejected());
        console2.log("plain", handler.nPlain());
        console2.log("settled", handler.nSettled());
    }
}
