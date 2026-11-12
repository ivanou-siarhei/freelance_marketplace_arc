// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {JobEscrowBase} from "./JobEscrow.Base.t.sol";
import {JobEscrow} from "../JobEscrow.sol";

/// @dev Exact time boundaries, cancel/dispute/resolve/resolveStale/claim flows, arbiter conflicts, long intervals.
contract JobEscrowBoundaryTest is JobEscrowBase {
    function _invalidStatus(JobEscrow.Status actual, JobEscrow.Status expected) internal pure returns (bytes memory) {
        return abi.encodeWithSelector(JobEscrow.InvalidStatus.selector, actual, expected);
    }

    // ───────────────────────── cancel ─────────────────────────

    function test_Cancel_RevertsAtDeadline() public {
        uint256 id = _create();
        uint64 dl = escrow.getEscrow(id).deliveryDeadline;
        vm.warp(dl);
        vm.prank(client);
        vm.expectRevert(abi.encodeWithSelector(JobEscrow.TooEarly.selector, uint256(dl) + 1));
        escrow.cancel(id);
    }

    function test_Cancel_RevertsWellBeforeDeadline() public {
        uint256 id = _create();
        vm.prank(client);
        vm.expectRevert();
        escrow.cancel(id);
    }

    function test_Cancel_SucceedsAtDeadlinePlusOne() public {
        uint256 id = _create();
        uint64 dl = escrow.getEscrow(id).deliveryDeadline;
        vm.warp(uint256(dl) + 1);
        vm.expectEmit(true, false, false, true, address(escrow));
        emit JobEscrow.Cancelled(id, client, AMOUNT);
        vm.prank(client);
        escrow.cancel(id);

        assertEq(uint8(escrow.getEscrow(id).status), uint8(JobEscrow.Status.Cancelled));
        assertEq(escrow.claimable(client), AMOUNT);
        assertEq(escrow.totalEscrowed(), 0);
        assertEq(escrow.totalClaimable(), AMOUNT);
        vm.prank(client);
        assertEq(escrow.withdraw(), AMOUNT);
        assertEq(usdc.balanceOf(client), 1_000_000e6);
    }

    function test_Cancel_RevertsAfterSubmit() public {
        uint256 id = _createSubmitted();
        vm.warp(block.timestamp + DELIVERY + 1);
        vm.prank(client);
        vm.expectRevert(_invalidStatus(JobEscrow.Status.Submitted, JobEscrow.Status.Funded));
        escrow.cancel(id);
    }

    // ───────────────────────── late submit ─────────────────────────

    function test_SubmitWork_LateAfterDeadlineWorksUntilCancelled() public {
        uint256 id = _create();
        uint64 dl = escrow.getEscrow(id).deliveryDeadline;
        vm.warp(uint256(dl) + 5 days);
        vm.prank(freelancer);
        escrow.submitWork(id, DELIVERY_HASH);
        JobEscrow.Escrow memory e = escrow.getEscrow(id);
        assertEq(uint8(e.status), uint8(JobEscrow.Status.Submitted));
        assertEq(e.reviewEndsAt, block.timestamp + REVIEW);
        // client can no longer cancel
        vm.prank(client);
        vm.expectRevert(_invalidStatus(JobEscrow.Status.Submitted, JobEscrow.Status.Funded));
        escrow.cancel(id);
    }

    function test_SubmitWork_RevertsAfterCancel() public {
        uint256 id = _create();
        uint64 dl = escrow.getEscrow(id).deliveryDeadline;
        vm.warp(uint256(dl) + 1);
        vm.prank(client);
        escrow.cancel(id);
        vm.prank(freelancer);
        vm.expectRevert(_invalidStatus(JobEscrow.Status.Cancelled, JobEscrow.Status.Funded));
        escrow.submitWork(id, DELIVERY_HASH);
    }

    // ───────────────────────── dispute boundary ─────────────────────────

    function test_Dispute_SucceedsAtReviewEndsMinusOne() public {
        uint256 id = _createSubmitted();
        uint64 re = escrow.getEscrow(id).reviewEndsAt;
        vm.warp(uint256(re) - 1);
        vm.expectEmit(true, false, false, true, address(escrow));
        emit JobEscrow.Disputed(id, REASON, re - 1);
        vm.prank(client);
        escrow.dispute(id, REASON);

        JobEscrow.Escrow memory e = escrow.getEscrow(id);
        assertEq(uint8(e.status), uint8(JobEscrow.Status.Disputed));
        assertEq(e.disputedAt, re - 1);
        // funds stay escrowed, not claimable
        assertEq(escrow.totalEscrowed(), AMOUNT);
        assertEq(escrow.totalClaimable(), 0);
    }

    function test_Dispute_EmitsExactEvent() public {
        uint256 id = _createSubmitted();
        vm.expectEmit(true, false, false, true, address(escrow));
        emit JobEscrow.Disputed(id, REASON, uint64(block.timestamp));
        vm.prank(client);
        escrow.dispute(id, REASON);
    }

    function test_Dispute_RevertsAtReviewEndsAt() public {
        uint256 id = _createSubmitted();
        uint64 re = escrow.getEscrow(id).reviewEndsAt;
        vm.warp(re);
        vm.prank(client);
        vm.expectRevert(abi.encodeWithSelector(JobEscrow.TooLate.selector, uint256(re)));
        escrow.dispute(id, REASON);
    }

    function test_Dispute_RevertsZeroReason() public {
        uint256 id = _createSubmitted();
        vm.prank(client);
        vm.expectRevert(JobEscrow.InvalidReasonHash.selector);
        escrow.dispute(id, bytes32(0));
    }

    function test_Dispute_RevertsWhenFunded() public {
        uint256 id = _create();
        vm.prank(client);
        vm.expectRevert(_invalidStatus(JobEscrow.Status.Funded, JobEscrow.Status.Submitted));
        escrow.dispute(id, REASON);
    }

    // ───────────────────────── claimAfterTimeout boundary ─────────────────────────

    function test_ClaimAfterTimeout_RevertsAtReviewEndsMinusOne() public {
        uint256 id = _createSubmitted();
        uint64 re = escrow.getEscrow(id).reviewEndsAt;
        vm.warp(uint256(re) - 1);
        vm.expectRevert(abi.encodeWithSelector(JobEscrow.TooEarly.selector, uint256(re)));
        escrow.claimAfterTimeout(id);
    }

    function test_ClaimAfterTimeout_SucceedsAtReviewEndsAt() public {
        uint256 id = _createSubmitted();
        uint64 re = escrow.getEscrow(id).reviewEndsAt;
        vm.warp(re);
        vm.expectEmit(true, false, false, true, address(escrow));
        emit JobEscrow.TimeoutClaimed(id, freelancer, AMOUNT);
        vm.prank(stranger);
        escrow.claimAfterTimeout(id);

        assertEq(uint8(escrow.getEscrow(id).status), uint8(JobEscrow.Status.Released));
        assertEq(escrow.claimable(freelancer), AMOUNT);
        assertEq(escrow.totalEscrowed(), 0);
    }

    function test_ClaimAfterTimeout_RevertsWhenDisputed() public {
        uint256 id = _createDisputed();
        vm.warp(block.timestamp + REVIEW + 1);
        vm.expectRevert(_invalidStatus(JobEscrow.Status.Disputed, JobEscrow.Status.Submitted));
        escrow.claimAfterTimeout(id);
    }

    function test_ClaimAfterTimeout_RevertsWhenFunded() public {
        uint256 id = _create();
        vm.expectRevert(_invalidStatus(JobEscrow.Status.Funded, JobEscrow.Status.Submitted));
        escrow.claimAfterTimeout(id);
    }

    // ───────────────────────── resolve ─────────────────────────

    function test_Resolve_SplitsFunds() public {
        uint256 id = _createDisputed();
        uint256 fa = 300e6;
        vm.expectEmit(true, false, false, true, address(escrow));
        emit JobEscrow.Resolved(id, fa, AMOUNT - fa);
        vm.prank(arbiter);
        escrow.resolve(id, fa);

        assertEq(uint8(escrow.getEscrow(id).status), uint8(JobEscrow.Status.Resolved));
        assertEq(escrow.claimable(freelancer), fa);
        assertEq(escrow.claimable(client), AMOUNT - fa);
        assertEq(escrow.totalEscrowed(), 0);
        assertEq(escrow.totalClaimable(), AMOUNT);
    }

    function test_Resolve_AllToClient() public {
        uint256 id = _createDisputed();
        vm.prank(arbiter);
        escrow.resolve(id, 0);
        assertEq(escrow.claimable(client), AMOUNT);
        assertEq(escrow.claimable(freelancer), 0);
    }

    function test_Resolve_AllToFreelancer() public {
        uint256 id = _createDisputed();
        vm.prank(arbiter);
        escrow.resolve(id, AMOUNT);
        assertEq(escrow.claimable(freelancer), AMOUNT);
        assertEq(escrow.claimable(client), 0);
    }

    function test_Resolve_RevertsAboveAmount() public {
        uint256 id = _createDisputed();
        vm.prank(arbiter);
        vm.expectRevert(abi.encodeWithSelector(JobEscrow.InvalidFreelancerAmount.selector, AMOUNT + 1, AMOUNT));
        escrow.resolve(id, AMOUNT + 1);
    }

    function test_Resolve_RevertsWhenNotDisputed() public {
        uint256 id = _createSubmitted();
        vm.prank(arbiter);
        vm.expectRevert(_invalidStatus(JobEscrow.Status.Submitted, JobEscrow.Status.Disputed));
        escrow.resolve(id, 0);
    }

    function test_Resolve_RevertsTwice() public {
        uint256 id = _createDisputed();
        vm.prank(arbiter);
        escrow.resolve(id, 0);
        vm.prank(arbiter);
        vm.expectRevert(_invalidStatus(JobEscrow.Status.Resolved, JobEscrow.Status.Disputed));
        escrow.resolve(id, 0);
    }

    function test_Resolve_StillWorksAfterStaleDeadlineUntilResolveStaleCalled() public {
        uint256 id = _createDisputed();
        vm.warp(block.timestamp + ARB_TIMEOUT + 100 days);
        vm.prank(arbiter);
        escrow.resolve(id, 10e6);
        assertEq(escrow.claimable(client), AMOUNT - 10e6);
    }

    function test_Resolve_RevertsAfterResolveStale() public {
        uint256 id = _createDisputed();
        vm.warp(block.timestamp + ARB_TIMEOUT);
        escrow.resolveStale(id);
        vm.prank(arbiter);
        vm.expectRevert(_invalidStatus(JobEscrow.Status.Resolved, JobEscrow.Status.Disputed));
        escrow.resolve(id, 0);
    }

    function test_Resolve_RevertsIfRotatedArbiterIsClient() public {
        uint256 id = _createDisputed();
        vm.prank(arbiter);
        escrow.setArbiter(client);
        vm.prank(client);
        vm.expectRevert(JobEscrow.ArbiterConflict.selector);
        escrow.resolve(id, 0);
    }

    function test_Resolve_RevertsIfRotatedArbiterIsFreelancer() public {
        uint256 id = _createDisputed();
        vm.prank(arbiter);
        escrow.setArbiter(freelancer);
        vm.prank(freelancer);
        vm.expectRevert(JobEscrow.ArbiterConflict.selector);
        escrow.resolve(id, AMOUNT);
    }

    function test_Resolve_ConflictedArbiterStillAllowsResolveStale() public {
        uint256 id = _createDisputed();
        vm.prank(arbiter);
        escrow.setArbiter(client);
        vm.warp(block.timestamp + ARB_TIMEOUT);
        escrow.resolveStale(id);
        assertEq(escrow.claimable(freelancer), AMOUNT);
    }

    function test_Resolve_RotatedNonConflictedArbiterCanResolve() public {
        uint256 id = _createDisputed();
        vm.prank(arbiter);
        escrow.setArbiter(other);
        vm.prank(arbiter);
        vm.expectRevert(JobEscrow.NotArbiter.selector);
        escrow.resolve(id, 0);
        vm.prank(other);
        escrow.resolve(id, AMOUNT / 2);
        assertEq(escrow.claimable(freelancer), AMOUNT / 2);
    }

    // ───────────────────────── resolveStale boundary ─────────────────────────

    function test_ResolveStale_RevertsAtStaleMinusOne() public {
        uint256 id = _createDisputed();
        uint256 staleAt = uint256(escrow.getEscrow(id).disputedAt) + ARB_TIMEOUT;
        vm.warp(staleAt - 1);
        vm.expectRevert(abi.encodeWithSelector(JobEscrow.TooEarly.selector, staleAt));
        escrow.resolveStale(id);
    }

    function test_ResolveStale_SucceedsAtStale_PaysFreelancer100Percent() public {
        uint256 id = _createDisputed();
        uint256 staleAt = uint256(escrow.getEscrow(id).disputedAt) + ARB_TIMEOUT;
        vm.warp(staleAt);
        vm.expectEmit(true, false, false, true, address(escrow));
        emit JobEscrow.StaleResolved(id, freelancer, AMOUNT);
        vm.prank(stranger);
        escrow.resolveStale(id);

        assertEq(uint8(escrow.getEscrow(id).status), uint8(JobEscrow.Status.Resolved));
        assertEq(escrow.claimable(freelancer), AMOUNT);
        assertEq(escrow.claimable(client), 0);
        assertEq(escrow.totalEscrowed(), 0);
        assertEq(escrow.totalClaimable(), AMOUNT);
    }

    function test_ResolveStale_RevertsWhenNotDisputed() public {
        uint256 id = _createSubmitted();
        vm.expectRevert(_invalidStatus(JobEscrow.Status.Submitted, JobEscrow.Status.Disputed));
        escrow.resolveStale(id);
    }

    function test_ResolveStale_RevertsTwice() public {
        uint256 id = _createDisputed();
        vm.warp(block.timestamp + ARB_TIMEOUT);
        escrow.resolveStale(id);
        vm.expectRevert(_invalidStatus(JobEscrow.Status.Resolved, JobEscrow.Status.Disputed));
        escrow.resolveStale(id);
    }

    // ───────────────────────── long intervals ─────────────────────────

    function _longEscrow() internal returns (JobEscrow e) {
        e = new JobEscrow(address(usdc), arbiter, 30 days, 90 days, 30 days);
        vm.prank(client);
        usdc.approve(address(e), type(uint256).max);
    }

    function test_Long_DeliveryDeadline90Days_CancelBoundary() public {
        JobEscrow e = _longEscrow();
        uint64 dl = uint64(block.timestamp + 90 days);
        vm.prank(client);
        uint256 id = e.createEscrow(JOB, freelancer, AMOUNT, dl, 30 days);

        vm.warp(dl);
        vm.prank(client);
        vm.expectRevert(abi.encodeWithSelector(JobEscrow.TooEarly.selector, uint256(dl) + 1));
        e.cancel(id);

        vm.warp(uint256(dl) + 1);
        vm.prank(client);
        e.cancel(id);
        assertEq(e.claimable(client), AMOUNT);
    }

    function test_Long_Review30Days_Boundaries() public {
        JobEscrow e = _longEscrow();
        vm.prank(client);
        uint256 id = e.createEscrow(JOB, freelancer, AMOUNT, uint64(block.timestamp + 90 days), 30 days);
        vm.prank(freelancer);
        e.submitWork(id, DELIVERY_HASH);
        uint256 re = block.timestamp + 30 days;
        assertEq(e.getEscrow(id).reviewEndsAt, re);

        vm.warp(re - 1);
        vm.expectRevert(abi.encodeWithSelector(JobEscrow.TooEarly.selector, re));
        e.claimAfterTimeout(id);

        vm.warp(re);
        e.claimAfterTimeout(id);
        assertEq(e.claimable(freelancer), AMOUNT);
    }

    function test_Long_ArbiterTimeout30Days_ResolveStaleBoundary() public {
        JobEscrow e = _longEscrow();
        vm.prank(client);
        uint256 id = e.createEscrow(JOB, freelancer, AMOUNT, uint64(block.timestamp + 90 days), 30 days);
        vm.prank(freelancer);
        e.submitWork(id, DELIVERY_HASH);
        vm.warp(block.timestamp + 30 days - 1);
        vm.prank(client);
        e.dispute(id, REASON);
        uint256 staleAt = block.timestamp + 30 days;

        vm.warp(staleAt - 1);
        vm.expectRevert(abi.encodeWithSelector(JobEscrow.TooEarly.selector, staleAt));
        e.resolveStale(id);

        vm.warp(staleAt);
        e.resolveStale(id);
        assertEq(e.claimable(freelancer), AMOUNT);
    }
}
