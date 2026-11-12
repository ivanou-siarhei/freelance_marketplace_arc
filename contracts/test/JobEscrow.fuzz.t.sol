// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {JobEscrowBase} from "./JobEscrow.Base.t.sol";
import {JobEscrow} from "../JobEscrow.sol";

contract JobEscrowFuzzTest is JobEscrowBase {
    // ───────────────────────── resolve ─────────────────────────

    function testFuzz_Resolve_ConservesFunds(uint256 amount, uint256 fa) public {
        amount = bound(amount, 1, 1e15);
        fa = bound(fa, 0, amount);
        usdc.mint(client, amount);

        vm.prank(client);
        uint256 id = escrow.createEscrow(keccak256("f"), freelancer, amount, uint64(block.timestamp) + DELIVERY, REVIEW);
        vm.prank(freelancer);
        escrow.submitWork(id, DELIVERY_HASH);
        vm.prank(client);
        escrow.dispute(id, REASON);

        vm.expectEmit(true, false, false, true, address(escrow));
        emit JobEscrow.Resolved(id, fa, amount - fa);
        vm.prank(arbiter);
        escrow.resolve(id, fa);

        assertEq(escrow.claimable(freelancer), fa);
        assertEq(escrow.claimable(client), amount - fa);
        assertEq(escrow.claimable(freelancer) + escrow.claimable(client), amount);
        assertEq(escrow.totalEscrowed(), 0);
        assertEq(escrow.totalClaimable(), amount);

        // withdrawing pays the exact amounts and drains the contract
        uint256 clientBefore = usdc.balanceOf(client);
        if (fa > 0) {
            vm.prank(freelancer);
            escrow.withdraw();
        }
        if (amount - fa > 0) {
            vm.prank(client);
            escrow.withdraw();
        }
        assertEq(usdc.balanceOf(freelancer), fa);
        assertEq(usdc.balanceOf(client), clientBefore + amount - fa);
        assertEq(usdc.balanceOf(address(escrow)), 0);
        assertEq(escrow.totalClaimable(), 0);
    }

    function testFuzz_Resolve_RevertsAboveAmount(uint256 amount, uint256 fa) public {
        amount = bound(amount, 1, 1e15);
        fa = bound(fa, amount + 1, type(uint256).max);
        usdc.mint(client, amount);

        vm.prank(client);
        uint256 id = escrow.createEscrow(keccak256("f"), freelancer, amount, uint64(block.timestamp) + DELIVERY, REVIEW);
        vm.prank(freelancer);
        escrow.submitWork(id, DELIVERY_HASH);
        vm.prank(client);
        escrow.dispute(id, REASON);

        vm.prank(arbiter);
        vm.expectRevert(abi.encodeWithSelector(JobEscrow.InvalidFreelancerAmount.selector, fa, amount));
        escrow.resolve(id, fa);
        // still disputed and escrowed
        assertEq(uint8(escrow.getEscrow(id).status), uint8(JobEscrow.Status.Disputed));
        assertEq(escrow.totalEscrowed(), amount);
    }

    function testFuzz_ResolveStale_PaysFullAmount(uint256 amount, uint256 extra) public {
        amount = bound(amount, 1, 1e15);
        extra = bound(extra, 0, 365 days);
        usdc.mint(client, amount);
        vm.prank(client);
        uint256 id = escrow.createEscrow(keccak256("f"), freelancer, amount, uint64(block.timestamp) + DELIVERY, REVIEW);
        vm.prank(freelancer);
        escrow.submitWork(id, DELIVERY_HASH);
        vm.prank(client);
        escrow.dispute(id, REASON);

        vm.warp(block.timestamp + ARB_TIMEOUT + extra);
        escrow.resolveStale(id);
        assertEq(escrow.claimable(freelancer), amount);
        assertEq(escrow.claimable(client), 0);
    }

    // ───────────────────────── reviewPeriod bounds ─────────────────────────

    function _tryCreate(uint64 deadline, uint64 review) internal returns (bool ok, bytes memory ret) {
        vm.prank(client);
        (ok, ret) = address(escrow).call(
            abi.encodeCall(JobEscrow.createEscrow, (keccak256(abi.encode(deadline, review)), freelancer, AMOUNT, deadline, review))
        );
    }

    function test_ReviewPeriod_Edges() public {
        uint64 dl = uint64(block.timestamp) + DELIVERY;
        uint64 maxR = escrow.MAX_REVIEW_PERIOD();

        vm.prank(client);
        vm.expectRevert(abi.encodeWithSelector(JobEscrow.InvalidReviewPeriod.selector, MIN_REVIEW - 1));
        escrow.createEscrow(keccak256("a"), freelancer, AMOUNT, dl, MIN_REVIEW - 1);

        vm.prank(client);
        escrow.createEscrow(keccak256("b"), freelancer, AMOUNT, dl, MIN_REVIEW);

        vm.prank(client);
        escrow.createEscrow(keccak256("c"), freelancer, AMOUNT, dl, maxR);

        vm.prank(client);
        vm.expectRevert(abi.encodeWithSelector(JobEscrow.InvalidReviewPeriod.selector, maxR + 1));
        escrow.createEscrow(keccak256("d"), freelancer, AMOUNT, dl, maxR + 1);
    }

    function testFuzz_ReviewPeriod_AcceptedIffInRange(uint64 review) public {
        uint64 dl = uint64(block.timestamp) + DELIVERY;
        (bool ok, bytes memory ret) = _tryCreate(dl, review);
        bool inRange = review >= MIN_REVIEW && review <= escrow.MAX_REVIEW_PERIOD();
        assertEq(ok, inRange);
        if (!ok) {
            assertEq(bytes4(ret), JobEscrow.InvalidReviewPeriod.selector);
        }
    }

    // ───────────────────────── deliveryDeadline bounds ─────────────────────────

    function test_DeliveryDeadline_Edges() public {
        uint64 nowTs = uint64(block.timestamp);
        uint64 maxD = escrow.MAX_DELIVERY_PERIOD();

        vm.prank(client);
        vm.expectRevert(abi.encodeWithSelector(JobEscrow.InvalidDeliveryDeadline.selector, nowTs + MIN_DELIVERY - 1));
        escrow.createEscrow(keccak256("a"), freelancer, AMOUNT, nowTs + MIN_DELIVERY - 1, REVIEW);

        vm.prank(client);
        escrow.createEscrow(keccak256("b"), freelancer, AMOUNT, nowTs + MIN_DELIVERY, REVIEW);

        vm.prank(client);
        escrow.createEscrow(keccak256("c"), freelancer, AMOUNT, nowTs + maxD, REVIEW);

        vm.prank(client);
        vm.expectRevert(abi.encodeWithSelector(JobEscrow.InvalidDeliveryDeadline.selector, nowTs + maxD + 1));
        escrow.createEscrow(keccak256("d"), freelancer, AMOUNT, nowTs + maxD + 1, REVIEW);
    }

    function test_DeliveryDeadline_PastAndZeroRevert() public {
        vm.prank(client);
        vm.expectRevert(abi.encodeWithSelector(JobEscrow.InvalidDeliveryDeadline.selector, uint64(0)));
        escrow.createEscrow(keccak256("a"), freelancer, AMOUNT, 0, REVIEW);
        vm.prank(client);
        vm.expectRevert(abi.encodeWithSelector(JobEscrow.InvalidDeliveryDeadline.selector, uint64(T0 - 1)));
        escrow.createEscrow(keccak256("b"), freelancer, AMOUNT, uint64(T0 - 1), REVIEW);
    }

    function testFuzz_DeliveryDeadline_AcceptedIffInRange(uint64 offset) public {
        offset = uint64(bound(offset, 0, 200 days));
        uint64 dl = uint64(block.timestamp) + offset;
        (bool ok, bytes memory ret) = _tryCreate(dl, REVIEW);
        bool inRange = offset >= MIN_DELIVERY && offset <= escrow.MAX_DELIVERY_PERIOD();
        assertEq(ok, inRange);
        if (!ok) {
            assertEq(bytes4(ret), JobEscrow.InvalidDeliveryDeadline.selector);
        }
    }

    function testFuzz_DeliveryDeadline_BoundaryScalesWithMinDeliveryPeriod(uint64 minD) public {
        minD = uint64(bound(minD, 1 minutes, 90 days));
        JobEscrow e = new JobEscrow(address(usdc), arbiter, ARB_TIMEOUT, minD, MIN_REVIEW);
        vm.prank(client);
        usdc.approve(address(e), type(uint256).max);
        uint64 nowTs = uint64(block.timestamp);

        vm.prank(client);
        vm.expectRevert(abi.encodeWithSelector(JobEscrow.InvalidDeliveryDeadline.selector, nowTs + minD - 1));
        e.createEscrow(keccak256("a"), freelancer, AMOUNT, nowTs + minD - 1, REVIEW);
        vm.prank(client);
        e.createEscrow(keccak256("b"), freelancer, AMOUNT, nowTs + minD, REVIEW);
    }

    function testFuzz_ReviewPeriod_BoundaryScalesWithMinReviewPeriod(uint64 minR) public {
        minR = uint64(bound(minR, 1 minutes, 30 days));
        JobEscrow e = new JobEscrow(address(usdc), arbiter, ARB_TIMEOUT, MIN_DELIVERY, minR);
        vm.prank(client);
        usdc.approve(address(e), type(uint256).max);
        uint64 dl = uint64(block.timestamp) + DELIVERY;

        vm.prank(client);
        vm.expectRevert(abi.encodeWithSelector(JobEscrow.InvalidReviewPeriod.selector, minR - 1));
        e.createEscrow(keccak256("a"), freelancer, AMOUNT, dl, minR - 1);
        vm.prank(client);
        e.createEscrow(keccak256("b"), freelancer, AMOUNT, dl, minR);
    }

    // ───────────────────────── constructor ─────────────────────────

    function testFuzz_Constructor_AcceptsParamsAboveFloors(uint64 timeout, uint64 minD, uint64 minR) public {
        timeout = uint64(bound(timeout, 5 minutes, 30 days));
        minD = uint64(bound(minD, 1 minutes, 90 days));
        minR = uint64(bound(minR, 1 minutes, 30 days));
        JobEscrow e = new JobEscrow(address(usdc), arbiter, timeout, minD, minR);
        assertEq(e.arbiterTimeout(), timeout);
        assertEq(e.minDeliveryPeriod(), minD);
        assertEq(e.minReviewPeriod(), minR);
        assertEq(e.arbiter(), arbiter);
        assertEq(address(e.usdc()), address(usdc));
    }

    function testFuzz_Constructor_RejectsTimeoutOutOfRange(uint64 timeout) public {
        vm.assume(timeout < 5 minutes || timeout > 30 days);
        vm.expectRevert(abi.encodeWithSelector(JobEscrow.InvalidArbiterTimeout.selector, timeout));
        new JobEscrow(address(usdc), arbiter, timeout, MIN_DELIVERY, MIN_REVIEW);
    }

    function testFuzz_Constructor_RejectsMinDeliveryOutOfRange(uint64 minD) public {
        vm.assume(minD < 1 minutes || minD > 90 days);
        vm.expectRevert(abi.encodeWithSelector(JobEscrow.InvalidMinDeliveryPeriod.selector, minD));
        new JobEscrow(address(usdc), arbiter, ARB_TIMEOUT, minD, MIN_REVIEW);
    }

    function testFuzz_Constructor_RejectsMinReviewOutOfRange(uint64 minR) public {
        vm.assume(minR < 1 minutes || minR > 30 days);
        vm.expectRevert(abi.encodeWithSelector(JobEscrow.InvalidMinReviewPeriod.selector, minR));
        new JobEscrow(address(usdc), arbiter, ARB_TIMEOUT, MIN_DELIVERY, minR);
    }

    // ───────────────────────── time boundaries (fuzzed) ─────────────────────────

    function testFuzz_ResolveStale_BoundaryScalesWithTimeout(uint64 timeout) public {
        timeout = uint64(bound(timeout, 5 minutes, 30 days));
        JobEscrow e = new JobEscrow(address(usdc), arbiter, timeout, MIN_DELIVERY, MIN_REVIEW);
        vm.prank(client);
        usdc.approve(address(e), type(uint256).max);
        vm.prank(client);
        uint256 id = e.createEscrow(JOB, freelancer, AMOUNT, uint64(block.timestamp) + DELIVERY, REVIEW);
        vm.prank(freelancer);
        e.submitWork(id, DELIVERY_HASH);
        vm.prank(client);
        e.dispute(id, REASON);
        uint256 staleAt = block.timestamp + timeout;

        vm.warp(staleAt - 1);
        vm.expectRevert(abi.encodeWithSelector(JobEscrow.TooEarly.selector, staleAt));
        e.resolveStale(id);
        vm.warp(staleAt);
        e.resolveStale(id);
        assertEq(e.claimable(freelancer), AMOUNT);
    }
}
