// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {JobEscrowBase} from "./JobEscrow.Base.t.sol";
import {JobEscrow} from "../JobEscrow.sol";

/// @dev Core flows: constructor, funding, front-run resistance, approve, decline, withdraw, access control, unknown ids.
contract JobEscrowTest is JobEscrowBase {
    // ───────────────────────── constructor ─────────────────────────

    function test_Constructor_SetsState() public view {
        assertEq(address(escrow.usdc()), address(usdc));
        assertEq(escrow.arbiter(), arbiter);
        assertEq(escrow.arbiterTimeout(), ARB_TIMEOUT);
        assertEq(escrow.minDeliveryPeriod(), MIN_DELIVERY);
        assertEq(escrow.minReviewPeriod(), MIN_REVIEW);
        assertEq(escrow.nextEscrowId(), 1);
        assertEq(escrow.escrowCount(), 0);
    }

    function test_Constructor_EmitsArbiterChanged() public {
        vm.expectEmit(true, true, false, true);
        emit JobEscrow.ArbiterChanged(address(0), arbiter);
        new JobEscrow(address(usdc), arbiter, ARB_TIMEOUT, MIN_DELIVERY, MIN_REVIEW);
    }

    function test_Constructor_RevertsZeroUsdc() public {
        vm.expectRevert(JobEscrow.ZeroAddress.selector);
        new JobEscrow(address(0), arbiter, ARB_TIMEOUT, MIN_DELIVERY, MIN_REVIEW);
    }

    function test_Constructor_RevertsZeroArbiter() public {
        vm.expectRevert(JobEscrow.ZeroAddress.selector);
        new JobEscrow(address(usdc), address(0), ARB_TIMEOUT, MIN_DELIVERY, MIN_REVIEW);
    }

    function test_Constructor_ArbiterTimeoutBounds() public {
        uint64 lo = 5 minutes;
        uint64 hi = 30 days;
        vm.expectRevert(abi.encodeWithSelector(JobEscrow.InvalidArbiterTimeout.selector, lo - 1));
        new JobEscrow(address(usdc), arbiter, lo - 1, MIN_DELIVERY, MIN_REVIEW);
        vm.expectRevert(abi.encodeWithSelector(JobEscrow.InvalidArbiterTimeout.selector, hi + 1));
        new JobEscrow(address(usdc), arbiter, hi + 1, MIN_DELIVERY, MIN_REVIEW);
        assertEq(new JobEscrow(address(usdc), arbiter, lo, MIN_DELIVERY, MIN_REVIEW).arbiterTimeout(), lo);
        assertEq(new JobEscrow(address(usdc), arbiter, hi, MIN_DELIVERY, MIN_REVIEW).arbiterTimeout(), hi);
    }

    function test_Constructor_MinDeliveryBounds() public {
        uint64 lo = 1 minutes;
        uint64 hi = 90 days;
        vm.expectRevert(abi.encodeWithSelector(JobEscrow.InvalidMinDeliveryPeriod.selector, uint64(0)));
        new JobEscrow(address(usdc), arbiter, ARB_TIMEOUT, 0, MIN_REVIEW);
        vm.expectRevert(abi.encodeWithSelector(JobEscrow.InvalidMinDeliveryPeriod.selector, lo - 1));
        new JobEscrow(address(usdc), arbiter, ARB_TIMEOUT, lo - 1, MIN_REVIEW);
        vm.expectRevert(abi.encodeWithSelector(JobEscrow.InvalidMinDeliveryPeriod.selector, hi + 1));
        new JobEscrow(address(usdc), arbiter, ARB_TIMEOUT, hi + 1, MIN_REVIEW);
        assertEq(new JobEscrow(address(usdc), arbiter, ARB_TIMEOUT, lo, MIN_REVIEW).minDeliveryPeriod(), lo);
        assertEq(new JobEscrow(address(usdc), arbiter, ARB_TIMEOUT, hi, MIN_REVIEW).minDeliveryPeriod(), hi);
    }

    function test_Constructor_MinReviewBounds() public {
        uint64 lo = 1 minutes;
        uint64 hi = 30 days;
        vm.expectRevert(abi.encodeWithSelector(JobEscrow.InvalidMinReviewPeriod.selector, uint64(0)));
        new JobEscrow(address(usdc), arbiter, ARB_TIMEOUT, MIN_DELIVERY, 0);
        vm.expectRevert(abi.encodeWithSelector(JobEscrow.InvalidMinReviewPeriod.selector, lo - 1));
        new JobEscrow(address(usdc), arbiter, ARB_TIMEOUT, MIN_DELIVERY, lo - 1);
        vm.expectRevert(abi.encodeWithSelector(JobEscrow.InvalidMinReviewPeriod.selector, hi + 1));
        new JobEscrow(address(usdc), arbiter, ARB_TIMEOUT, MIN_DELIVERY, hi + 1);
        assertEq(new JobEscrow(address(usdc), arbiter, ARB_TIMEOUT, MIN_DELIVERY, lo).minReviewPeriod(), lo);
        assertEq(new JobEscrow(address(usdc), arbiter, ARB_TIMEOUT, MIN_DELIVERY, hi).minReviewPeriod(), hi);
    }

    // ───────────────────────── createEscrow / funding ─────────────────────────

    function test_Create_FundsAndStoresEscrow() public {
        uint64 dl = uint64(block.timestamp) + DELIVERY;
        vm.expectEmit(true, true, true, true, address(escrow));
        emit JobEscrow.EscrowCreated(1, JOB, client, freelancer, AMOUNT, dl, REVIEW);
        uint256 id = _create();

        assertEq(id, 1);
        assertEq(escrow.escrowCount(), 1);
        assertEq(escrow.nextEscrowId(), 2);
        assertEq(escrow.escrowIdByRef(client, JOB), 1);
        assertEq(escrow.totalEscrowed(), AMOUNT);
        assertEq(usdc.balanceOf(address(escrow)), AMOUNT);
        assertEq(usdc.balanceOf(client), 1_000_000e6 - AMOUNT);

        JobEscrow.Escrow memory e = escrow.getEscrow(id);
        assertEq(e.client, client);
        assertEq(e.freelancer, freelancer);
        assertEq(e.amount, AMOUNT);
        assertEq(e.deliveryDeadline, dl);
        assertEq(e.reviewPeriod, REVIEW);
        assertEq(e.submittedAt, 0);
        assertEq(e.reviewEndsAt, 0);
        assertEq(e.disputedAt, 0);
        assertEq(e.jobRef, JOB);
        assertEq(e.deliveryHash, bytes32(0));
        assertEq(uint8(e.status), uint8(JobEscrow.Status.Funded));
    }

    function test_Create_RevertsZeroFreelancer() public {
        vm.prank(client);
        vm.expectRevert(JobEscrow.ZeroAddress.selector);
        escrow.createEscrow(JOB, address(0), AMOUNT, uint64(block.timestamp) + DELIVERY, REVIEW);
    }

    function test_Create_RevertsClientIsFreelancer() public {
        vm.prank(client);
        vm.expectRevert(JobEscrow.InvalidFreelancer.selector);
        escrow.createEscrow(JOB, client, AMOUNT, uint64(block.timestamp) + DELIVERY, REVIEW);
    }

    function test_Create_RevertsArbiterIsClient() public {
        _fund(arbiter, AMOUNT);
        vm.prank(arbiter);
        vm.expectRevert(JobEscrow.ArbiterConflict.selector);
        escrow.createEscrow(JOB, freelancer, AMOUNT, uint64(block.timestamp) + DELIVERY, REVIEW);
    }

    function test_Create_RevertsArbiterIsFreelancer() public {
        vm.prank(client);
        vm.expectRevert(JobEscrow.ArbiterConflict.selector);
        escrow.createEscrow(JOB, arbiter, AMOUNT, uint64(block.timestamp) + DELIVERY, REVIEW);
    }

    function test_Create_RevertsZeroAmount() public {
        vm.prank(client);
        vm.expectRevert(JobEscrow.ZeroAmount.selector);
        escrow.createEscrow(JOB, freelancer, 0, uint64(block.timestamp) + DELIVERY, REVIEW);
    }

    function test_Create_RevertsZeroJobRef() public {
        vm.prank(client);
        vm.expectRevert(JobEscrow.InvalidJobRef.selector);
        escrow.createEscrow(bytes32(0), freelancer, AMOUNT, uint64(block.timestamp) + DELIVERY, REVIEW);
    }

    function test_Create_RevertsDuplicateJobRefSameClient() public {
        _create();
        vm.prank(client);
        vm.expectRevert(abi.encodeWithSelector(JobEscrow.DuplicateJobRef.selector, client, JOB));
        escrow.createEscrow(JOB, freelancer, AMOUNT, uint64(block.timestamp) + DELIVERY, REVIEW);
    }

    function test_Create_DuplicateJobRefStaysBlockedAfterSettlement() public {
        uint256 id = _create();
        vm.warp(block.timestamp + DELIVERY + 1);
        vm.prank(client);
        escrow.cancel(id);
        vm.prank(client);
        vm.expectRevert(abi.encodeWithSelector(JobEscrow.DuplicateJobRef.selector, client, JOB));
        escrow.createEscrow(JOB, freelancer, AMOUNT, uint64(block.timestamp) + DELIVERY, REVIEW);
    }

    function test_Create_RevertsWithoutAllowance() public {
        address poor = makeAddr("poor");
        usdc.mint(poor, AMOUNT);
        vm.prank(poor);
        vm.expectRevert();
        escrow.createEscrow(JOB, freelancer, AMOUNT, uint64(block.timestamp) + DELIVERY, REVIEW);
        // state untouched
        assertEq(escrow.escrowCount(), 0);
        assertEq(escrow.totalEscrowed(), 0);
        assertEq(escrow.escrowIdByRef(poor, JOB), 0);
    }

    // ───────────────────────── front-run resistance ─────────────────────────

    function test_FrontRun_ThirdPartyFundingSameJobRefDoesNotBlockClient() public {
        // attacker (stranger) funds the same jobRef first
        uint256 attackerId = _createWith(stranger, JOB, 1e6);
        // real client can still create with the same jobRef
        uint256 clientId = _createWith(client, JOB, AMOUNT);

        assertEq(attackerId, 1);
        assertEq(clientId, 2);
        assertEq(escrow.escrowIdByRef(stranger, JOB), 1);
        assertEq(escrow.escrowIdByRef(client, JOB), 2);
        assertEq(escrow.getEscrow(clientId).client, client);
        assertEq(escrow.getEscrow(clientId).amount, AMOUNT);
    }

    function test_FrontRun_SameClientJobRefTwiceReverts() public {
        _createWith(client, JOB, AMOUNT);
        vm.prank(client);
        vm.expectRevert(abi.encodeWithSelector(JobEscrow.DuplicateJobRef.selector, client, JOB));
        escrow.createEscrow(JOB, other, AMOUNT, uint64(block.timestamp) + DELIVERY, REVIEW);
    }

    // ───────────────────────── submitWork ─────────────────────────

    function test_SubmitWork_SetsReviewWindow() public {
        uint256 id = _create();
        vm.expectEmit(true, false, false, true, address(escrow));
        emit JobEscrow.WorkSubmitted(id, DELIVERY_HASH, uint64(block.timestamp + REVIEW));
        vm.prank(freelancer);
        escrow.submitWork(id, DELIVERY_HASH);

        JobEscrow.Escrow memory e = escrow.getEscrow(id);
        assertEq(uint8(e.status), uint8(JobEscrow.Status.Submitted));
        assertEq(e.submittedAt, block.timestamp);
        assertEq(e.reviewEndsAt, block.timestamp + REVIEW);
        assertEq(e.deliveryHash, DELIVERY_HASH);
    }

    function test_SubmitWork_RevertsZeroHash() public {
        uint256 id = _create();
        vm.prank(freelancer);
        vm.expectRevert(JobEscrow.InvalidDeliveryHash.selector);
        escrow.submitWork(id, bytes32(0));
    }

    function test_SubmitWork_RevertsTwice() public {
        uint256 id = _createSubmitted();
        vm.prank(freelancer);
        vm.expectRevert(
            abi.encodeWithSelector(JobEscrow.InvalidStatus.selector, JobEscrow.Status.Submitted, JobEscrow.Status.Funded)
        );
        escrow.submitWork(id, DELIVERY_HASH);
    }

    // ───────────────────────── approve ─────────────────────────

    function test_Approve_CreditsFreelancer() public {
        uint256 id = _createSubmitted();
        vm.expectEmit(true, false, false, true, address(escrow));
        emit JobEscrow.Approved(id, freelancer, AMOUNT);
        vm.prank(client);
        escrow.approve(id);

        assertEq(uint8(escrow.getEscrow(id).status), uint8(JobEscrow.Status.Released));
        assertEq(escrow.claimable(freelancer), AMOUNT);
        assertEq(escrow.claimable(client), 0);
        assertEq(escrow.totalEscrowed(), 0);
        assertEq(escrow.totalClaimable(), AMOUNT);
        // pull payment: no tokens moved yet
        assertEq(usdc.balanceOf(freelancer), 0);
    }

    function test_Approve_WorksAfterReviewWindowEnded() public {
        uint256 id = _createSubmitted();
        vm.warp(block.timestamp + REVIEW + 10 days);
        vm.prank(client);
        escrow.approve(id);
        assertEq(escrow.claimable(freelancer), AMOUNT);
    }

    function test_Approve_RevertsWhenFunded() public {
        uint256 id = _create();
        vm.prank(client);
        vm.expectRevert(
            abi.encodeWithSelector(JobEscrow.InvalidStatus.selector, JobEscrow.Status.Funded, JobEscrow.Status.Submitted)
        );
        escrow.approve(id);
    }

    function test_Approve_RevertsTwice() public {
        uint256 id = _createSubmitted();
        vm.prank(client);
        escrow.approve(id);
        vm.prank(client);
        vm.expectRevert(
            abi.encodeWithSelector(JobEscrow.InvalidStatus.selector, JobEscrow.Status.Released, JobEscrow.Status.Submitted)
        );
        escrow.approve(id);
    }

    // ───────────────────────── decline ─────────────────────────

    function test_Decline_RefundsClientClaim() public {
        uint256 id = _create();
        vm.expectEmit(true, false, false, true, address(escrow));
        emit JobEscrow.Declined(id, freelancer, client, AMOUNT);
        vm.prank(freelancer);
        escrow.decline(id);

        assertEq(uint8(escrow.getEscrow(id).status), uint8(JobEscrow.Status.Cancelled));
        assertEq(escrow.claimable(client), AMOUNT);
        assertEq(escrow.claimable(freelancer), 0);
        assertEq(escrow.totalEscrowed(), 0);
        assertEq(escrow.totalClaimable(), AMOUNT);
    }

    function test_Decline_RevertsAfterSubmit() public {
        uint256 id = _createSubmitted();
        vm.prank(freelancer);
        vm.expectRevert(
            abi.encodeWithSelector(JobEscrow.InvalidStatus.selector, JobEscrow.Status.Submitted, JobEscrow.Status.Funded)
        );
        escrow.decline(id);
    }

    // ───────────────────────── withdraw ─────────────────────────

    function test_Withdraw_PaysOnlyCaller() public {
        uint256 id = _createSubmitted();
        vm.prank(client);
        escrow.approve(id);

        vm.expectEmit(true, false, false, true, address(escrow));
        emit JobEscrow.Withdrawn(freelancer, AMOUNT);
        vm.prank(freelancer);
        uint256 out = escrow.withdraw();

        assertEq(out, AMOUNT);
        assertEq(usdc.balanceOf(freelancer), AMOUNT);
        assertEq(usdc.balanceOf(address(escrow)), 0);
        assertEq(escrow.claimable(freelancer), 0);
        assertEq(escrow.totalClaimable(), 0);
    }

    function test_Withdraw_StrangerCannotTakeOthersFunds() public {
        uint256 id = _createSubmitted();
        vm.prank(client);
        escrow.approve(id);

        vm.prank(stranger);
        vm.expectRevert(JobEscrow.NothingToWithdraw.selector);
        escrow.withdraw();
        assertEq(escrow.claimable(freelancer), AMOUNT);
    }

    function test_Withdraw_RevertsAtZero() public {
        vm.prank(freelancer);
        vm.expectRevert(JobEscrow.NothingToWithdraw.selector);
        escrow.withdraw();
    }

    function test_Withdraw_RevertsSecondTime() public {
        uint256 id = _createSubmitted();
        vm.prank(client);
        escrow.approve(id);
        vm.startPrank(freelancer);
        escrow.withdraw();
        vm.expectRevert(JobEscrow.NothingToWithdraw.selector);
        escrow.withdraw();
        vm.stopPrank();
    }

    function test_Withdraw_AccumulatesAcrossEscrows() public {
        uint256 a = _createSubmitted();
        bytes32 ref2 = keccak256("job-2");
        uint256 b = _createWith(client, ref2, 500e6);
        vm.prank(freelancer);
        escrow.submitWork(b, DELIVERY_HASH);
        vm.startPrank(client);
        escrow.approve(a);
        escrow.approve(b);
        vm.stopPrank();
        assertEq(escrow.claimable(freelancer), AMOUNT + 500e6);
        vm.prank(freelancer);
        assertEq(escrow.withdraw(), AMOUNT + 500e6);
    }

    // ───────────────────────── access control ─────────────────────────

    function test_Access_SubmitWorkOnlyFreelancer() public {
        uint256 id = _create();
        address[3] memory bad = [client, stranger, arbiter];
        for (uint256 i; i < bad.length; ++i) {
            vm.prank(bad[i]);
            vm.expectRevert(JobEscrow.NotFreelancer.selector);
            escrow.submitWork(id, DELIVERY_HASH);
        }
    }

    function test_Access_ApproveOnlyClient() public {
        uint256 id = _createSubmitted();
        address[3] memory bad = [freelancer, stranger, arbiter];
        for (uint256 i; i < bad.length; ++i) {
            vm.prank(bad[i]);
            vm.expectRevert(JobEscrow.NotClient.selector);
            escrow.approve(id);
        }
    }

    function test_Access_CancelOnlyClient() public {
        uint256 id = _create();
        vm.warp(block.timestamp + DELIVERY + 1);
        address[3] memory bad = [freelancer, stranger, arbiter];
        for (uint256 i; i < bad.length; ++i) {
            vm.prank(bad[i]);
            vm.expectRevert(JobEscrow.NotClient.selector);
            escrow.cancel(id);
        }
    }

    function test_Access_DeclineOnlyFreelancer() public {
        uint256 id = _create();
        address[3] memory bad = [client, stranger, arbiter];
        for (uint256 i; i < bad.length; ++i) {
            vm.prank(bad[i]);
            vm.expectRevert(JobEscrow.NotFreelancer.selector);
            escrow.decline(id);
        }
    }

    function test_Access_DisputeOnlyClient() public {
        uint256 id = _createSubmitted();
        address[3] memory bad = [freelancer, stranger, arbiter];
        for (uint256 i; i < bad.length; ++i) {
            vm.prank(bad[i]);
            vm.expectRevert(JobEscrow.NotClient.selector);
            escrow.dispute(id, REASON);
        }
    }

    function test_Access_ResolveOnlyArbiter() public {
        uint256 id = _createDisputed();
        address[3] memory bad = [client, freelancer, stranger];
        for (uint256 i; i < bad.length; ++i) {
            vm.prank(bad[i]);
            vm.expectRevert(JobEscrow.NotArbiter.selector);
            escrow.resolve(id, 0);
        }
    }

    function test_Access_SetArbiterOnlyArbiter() public {
        vm.prank(stranger);
        vm.expectRevert(JobEscrow.NotArbiter.selector);
        escrow.setArbiter(other);
    }

    function test_Access_ClaimAfterTimeoutAndResolveStaleArePermissionless() public {
        uint256 a = _createSubmitted();
        uint256 b = _createWith(client, keccak256("job-2"), AMOUNT);
        vm.prank(freelancer);
        escrow.submitWork(b, DELIVERY_HASH);
        vm.prank(client);
        escrow.dispute(b, REASON);

        vm.warp(block.timestamp + REVIEW + ARB_TIMEOUT);
        vm.prank(stranger);
        escrow.claimAfterTimeout(a);
        vm.prank(stranger);
        escrow.resolveStale(b);
        assertEq(escrow.claimable(freelancer), 2 * AMOUNT);
    }

    // ───────────────────────── setArbiter ─────────────────────────

    function test_SetArbiter_RotatesAndEmits() public {
        vm.expectEmit(true, true, false, true, address(escrow));
        emit JobEscrow.ArbiterChanged(arbiter, other);
        vm.prank(arbiter);
        escrow.setArbiter(other);
        assertEq(escrow.arbiter(), other);

        // old arbiter lost power
        vm.prank(arbiter);
        vm.expectRevert(JobEscrow.NotArbiter.selector);
        escrow.setArbiter(arbiter);
    }

    function test_SetArbiter_RevertsZero() public {
        vm.prank(arbiter);
        vm.expectRevert(JobEscrow.ZeroAddress.selector);
        escrow.setArbiter(address(0));
    }

    // ───────────────────────── unknown ids ─────────────────────────

    function test_UnknownEscrow_AllEntryPointsRevert() public {
        bytes memory err0 = abi.encodeWithSelector(JobEscrow.UnknownEscrow.selector, uint256(0));
        bytes memory err99 = abi.encodeWithSelector(JobEscrow.UnknownEscrow.selector, uint256(99));

        vm.expectRevert(err0);
        escrow.getEscrow(0);
        vm.expectRevert(err99);
        escrow.getEscrow(99);

        vm.prank(freelancer);
        vm.expectRevert(err99);
        escrow.submitWork(99, DELIVERY_HASH);
        vm.prank(client);
        vm.expectRevert(err99);
        escrow.approve(99);
        vm.prank(client);
        vm.expectRevert(err99);
        escrow.cancel(99);
        vm.prank(freelancer);
        vm.expectRevert(err99);
        escrow.decline(99);
        vm.expectRevert(err99);
        escrow.claimAfterTimeout(99);
        vm.prank(client);
        vm.expectRevert(err99);
        escrow.dispute(99, REASON);
        vm.prank(arbiter);
        vm.expectRevert(err99);
        escrow.resolve(99, 0);
        vm.expectRevert(err99);
        escrow.resolveStale(99);
    }

    function test_UnknownEscrow_IdOnePastLastReverts() public {
        _create();
        vm.expectRevert(abi.encodeWithSelector(JobEscrow.UnknownEscrow.selector, uint256(2)));
        escrow.getEscrow(2);
    }
}
