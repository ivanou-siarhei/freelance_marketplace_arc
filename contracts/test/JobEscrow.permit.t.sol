// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {IERC20Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {JobEscrow} from "../JobEscrow.sol";
import {JobEscrowBase} from "./JobEscrow.Base.t.sol";
import {MockPermitUSDC} from "./mocks/MockPermitUSDC.sol";

/// @dev EIP-2612 signing helper shared by the unit tests and the invariant handler.
abstract contract PermitSigning is Test {
    bytes32 internal constant PERMIT_TYPEHASH =
        keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");

    function _sign(MockPermitUSDC token, uint256 pk, address owner_, address spender, uint256 value, uint256 deadline)
        internal
        view
        returns (uint8 v, bytes32 r, bytes32 s)
    {
        bytes32 structHash =
            keccak256(abi.encode(PERMIT_TYPEHASH, owner_, spender, value, token.nonces(owner_), deadline));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", token.DOMAIN_SEPARATOR(), structHash));
        (v, r, s) = vm.sign(pk, digest);
    }
}

contract JobEscrowPermitTest is JobEscrowBase, PermitSigning {
    struct P {
        bytes32 jobRef;
        address freelancer;
        uint256 amount;
        uint64 deliveryDeadline;
        uint64 reviewPeriod;
        uint256 permitDeadline;
        uint8 v;
        bytes32 r;
        bytes32 s;
    }

    MockPermitUSDC internal ptoken;
    JobEscrow internal pescrow;
    address internal payer;
    uint256 internal payerPk;

    function setUp() public override {
        super.setUp(); // sets T0 and the base fixtures; the permit fixtures below are independent of them
        ptoken = new MockPermitUSDC();
        pescrow = new JobEscrow(address(ptoken), arbiter, ARB_TIMEOUT, MIN_DELIVERY, MIN_REVIEW);
        (payer, payerPk) = makeAddrAndKey("payer");
        ptoken.mint(payer, 1_000_000e6);
        ptoken.mint(stranger, 1_000_000e6);
    }

    // ---------------------------------------------------------------- helpers

    /// @dev Valid params for `payer`, with a fresh signature over the payer's current nonce.
    function _p(uint256 amount) internal view returns (P memory p) {
        p.jobRef = JOB;
        p.freelancer = freelancer;
        p.amount = amount;
        p.deliveryDeadline = uint64(block.timestamp) + DELIVERY;
        p.reviewPeriod = REVIEW;
        p.permitDeadline = block.timestamp + 1 hours;
        (p.v, p.r, p.s) = _sign(ptoken, payerPk, payer, address(pescrow), amount, p.permitDeadline);
    }

    function _call(JobEscrow target, address who, P memory p) internal returns (uint256) {
        vm.prank(who);
        return target.createEscrowWithPermit(
            p.jobRef, p.freelancer, p.amount, p.deliveryDeadline, p.reviewPeriod, p.permitDeadline, p.v, p.r, p.s
        );
    }

    function _insufficientAllowance(uint256 have, uint256 need) internal view returns (bytes memory) {
        return abi.encodeWithSelector(IERC20Errors.ERC20InsufficientAllowance.selector, address(pescrow), have, need);
    }

    // ------------------------------------------------------------- happy path

    function test_Permit_FundsInOneTxAndEmitsEscrowCreated() public {
        P memory p = _p(AMOUNT);
        assertEq(ptoken.allowance(payer, address(pescrow)), 0);
        uint256 before_ = ptoken.balanceOf(payer);

        vm.expectEmit(true, true, true, true, address(pescrow));
        emit JobEscrow.EscrowCreated(1, JOB, payer, freelancer, AMOUNT, p.deliveryDeadline, REVIEW);
        uint256 id = _call(pescrow, payer, p);

        assertEq(id, 1);
        assertEq(ptoken.balanceOf(payer), before_ - AMOUNT);
        assertEq(ptoken.balanceOf(address(pescrow)), AMOUNT);
        assertEq(pescrow.totalEscrowed(), AMOUNT);
        assertEq(pescrow.escrowIdByRef(payer, JOB), 1);
        assertEq(ptoken.allowance(payer, address(pescrow)), 0, "permit allowance fully consumed");
        assertEq(ptoken.nonces(payer), 1);

        JobEscrow.Escrow memory e = pescrow.getEscrow(id);
        assertEq(e.client, payer);
        assertEq(e.freelancer, freelancer);
        assertEq(e.amount, AMOUNT);
        assertEq(e.deliveryDeadline, p.deliveryDeadline);
        assertEq(e.reviewPeriod, REVIEW);
        assertEq(uint8(e.status), uint8(JobEscrow.Status.Funded));
    }

    function test_Permit_FundedEscrowSettlesNormally() public {
        uint256 id = _call(pescrow, payer, _p(AMOUNT));
        vm.prank(freelancer);
        pescrow.submitWork(id, DELIVERY_HASH);
        vm.prank(payer);
        pescrow.approve(id);
        vm.prank(freelancer);
        pescrow.withdraw();
        assertEq(ptoken.balanceOf(freelancer), AMOUNT);
        assertEq(ptoken.balanceOf(address(pescrow)), 0);
        assertEq(pescrow.totalEscrowed(), 0);
        assertEq(pescrow.totalClaimable(), 0);
    }

    function test_Permit_ValidPermitOverridesExistingMaxAllowance() public {
        // A valid permit overwrites the allowance with `amount`; it is then spent entirely.
        vm.prank(payer);
        ptoken.approve(address(pescrow), type(uint256).max);
        _call(pescrow, payer, _p(AMOUNT));
        assertEq(ptoken.allowance(payer, address(pescrow)), 0);
        assertEq(pescrow.totalEscrowed(), AMOUNT);
    }

    // -------------------------------------------------------------- front-run

    function test_Permit_FrontRunPermitDoesNotBlockFunding() public {
        P memory p = _p(AMOUNT);
        // An attacker submits the exact same permit first, consuming the nonce.
        vm.prank(stranger);
        ptoken.permit(payer, address(pescrow), AMOUNT, p.permitDeadline, p.v, p.r, p.s);
        assertEq(ptoken.nonces(payer), 1);
        assertEq(ptoken.allowance(payer, address(pescrow)), AMOUNT);

        // The victim's tx (same, now-stale permit) must still fund the escrow.
        uint256 id = _call(pescrow, payer, p);
        assertEq(id, 1);
        assertEq(pescrow.getEscrow(id).client, payer);
        assertEq(ptoken.balanceOf(address(pescrow)), AMOUNT);
        assertEq(ptoken.allowance(payer, address(pescrow)), 0);
        assertEq(ptoken.nonces(payer), 1, "nonce not consumed twice");
    }

    function test_Permit_ReplayedSignatureCannotFundSecondEscrow() public {
        P memory p = _p(AMOUNT);
        _call(pescrow, payer, p);
        p.jobRef = keccak256("job-2");
        // Same signature, nonce already used and allowance spent -> transferFrom fails.
        vm.expectRevert(_insufficientAllowance(0, AMOUNT));
        _call(pescrow, payer, p);
        assertEq(pescrow.escrowCount(), 1);
    }

    // ----------------------------------------------- invalid / expired permits

    function test_Permit_RevertsWhenSignedByWrongKeyAndNoAllowance() public {
        P memory p = _p(AMOUNT);
        (, uint256 badPk) = makeAddrAndKey("attacker");
        (p.v, p.r, p.s) = _sign(ptoken, badPk, payer, address(pescrow), AMOUNT, p.permitDeadline);
        vm.expectRevert(_insufficientAllowance(0, AMOUNT));
        _call(pescrow, payer, p);
        assertEq(pescrow.escrowCount(), 0);
        assertEq(pescrow.totalEscrowed(), 0);
    }

    function test_Permit_RevertsWhenGarbageSignatureAndNoAllowance() public {
        P memory p = _p(AMOUNT);
        p.v = 27;
        p.r = bytes32(uint256(1));
        p.s = bytes32(uint256(2));
        vm.expectRevert(_insufficientAllowance(0, AMOUNT));
        _call(pescrow, payer, p);
    }

    function test_Permit_RevertsWhenPermitExpiredAndNoAllowance() public {
        P memory p = _p(AMOUNT);
        vm.warp(p.permitDeadline + 1);
        p.deliveryDeadline = uint64(block.timestamp) + DELIVERY; // keep creation params valid
        vm.expectRevert(_insufficientAllowance(0, AMOUNT));
        _call(pescrow, payer, p);
        assertEq(ptoken.nonces(payer), 0);
    }

    function test_Permit_ValidAtExactPermitDeadline() public {
        P memory p = _p(AMOUNT);
        vm.warp(p.permitDeadline);
        p.deliveryDeadline = uint64(block.timestamp) + DELIVERY;
        _call(pescrow, payer, p);
        assertEq(pescrow.totalEscrowed(), AMOUNT);
    }

    function test_Permit_SignedForDifferentSpenderRevertsWithoutAllowance() public {
        P memory p = _p(AMOUNT);
        (p.v, p.r, p.s) = _sign(ptoken, payerPk, payer, stranger, AMOUNT, p.permitDeadline);
        vm.expectRevert(_insufficientAllowance(0, AMOUNT));
        _call(pescrow, payer, p);
    }

    function test_Permit_CannotBeUsedByAnotherCallerToSpendPayersFunds() public {
        P memory p = _p(AMOUNT);
        // Stranger submits the payer's permit as their own createEscrowWithPermit: permit owner != msg.sender.
        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InsufficientAllowance.selector, address(pescrow), 0, AMOUNT));
        _call(pescrow, stranger, p);
        assertEq(ptoken.balanceOf(payer), 1_000_000e6);
    }

    // ---------------------------------- invalid permit + sufficient allowance

    function test_Permit_InvalidPermitWithSufficientAllowanceStillSucceeds() public {
        vm.prank(payer);
        ptoken.approve(address(pescrow), AMOUNT * 2);
        P memory p = _p(AMOUNT);
        p.v = 27;
        p.r = bytes32(uint256(1));
        p.s = bytes32(uint256(2));

        vm.expectEmit(true, true, true, true, address(pescrow));
        emit JobEscrow.EscrowCreated(1, JOB, payer, freelancer, AMOUNT, p.deliveryDeadline, REVIEW);
        uint256 id = _call(pescrow, payer, p);

        assertEq(id, 1);
        assertEq(ptoken.balanceOf(address(pescrow)), AMOUNT);
        assertEq(ptoken.allowance(payer, address(pescrow)), AMOUNT, "pre-existing allowance spent, not replaced");
        assertEq(ptoken.nonces(payer), 0);
    }

    function test_Permit_ExpiredPermitWithSufficientAllowanceStillSucceeds() public {
        vm.prank(payer);
        ptoken.approve(address(pescrow), AMOUNT);
        P memory p = _p(AMOUNT);
        vm.warp(p.permitDeadline + 1 days);
        p.deliveryDeadline = uint64(block.timestamp) + DELIVERY;
        _call(pescrow, payer, p);
        assertEq(pescrow.totalEscrowed(), AMOUNT);
    }

    // ------------------------------------------------ insufficient permit amount

    function test_Permit_InsufficientPermitAmountReverts() public {
        P memory p = _p(AMOUNT);
        // Valid signature, but over AMOUNT - 1 only; the call asks for AMOUNT -> permit signature mismatch.
        (p.v, p.r, p.s) = _sign(ptoken, payerPk, payer, address(pescrow), AMOUNT - 1, p.permitDeadline);
        vm.expectRevert(_insufficientAllowance(0, AMOUNT));
        _call(pescrow, payer, p);
        assertEq(pescrow.escrowCount(), 0);
    }

    function test_Permit_InsufficientPermitAndSmallPreexistingAllowanceReverts() public {
        vm.prank(payer);
        ptoken.approve(address(pescrow), 10);
        P memory p = _p(AMOUNT);
        (p.v, p.r, p.s) = _sign(ptoken, payerPk, payer, address(pescrow), AMOUNT - 1, p.permitDeadline);
        vm.expectRevert(_insufficientAllowance(10, AMOUNT));
        _call(pescrow, payer, p);
    }

    function test_Permit_PayerBalanceShortRevertsEvenWithValidPermit() public {
        uint256 big = 2_000_000e6;
        P memory p = _p(big);
        vm.expectRevert(
            abi.encodeWithSelector(IERC20Errors.ERC20InsufficientBalance.selector, payer, 1_000_000e6, big)
        );
        _call(pescrow, payer, p);
        assertEq(ptoken.nonces(payer), 0, "revert rolls back the permit");
    }

    // ----------------------------------------------------------- duplicate ref

    function test_Permit_DuplicateJobRefReverts() public {
        _call(pescrow, payer, _p(AMOUNT));
        P memory p2 = _p(AMOUNT); // fresh, valid permit for nonce 1
        vm.expectRevert(abi.encodeWithSelector(JobEscrow.DuplicateJobRef.selector, payer, JOB));
        _call(pescrow, payer, p2);
        assertEq(ptoken.nonces(payer), 1, "failed duplicate does not consume the permit");
        assertEq(pescrow.escrowCount(), 1);
    }

    function test_Permit_DuplicateOfPlainCreateEscrowReverts() public {
        vm.prank(payer);
        ptoken.approve(address(pescrow), AMOUNT);
        vm.prank(payer);
        pescrow.createEscrow(JOB, freelancer, AMOUNT, uint64(block.timestamp) + DELIVERY, REVIEW);
        P memory p = _p(AMOUNT);
        vm.expectRevert(abi.encodeWithSelector(JobEscrow.DuplicateJobRef.selector, payer, JOB));
        _call(pescrow, payer, p);
    }

    function test_Permit_SameJobRefDifferentClientsAllowed() public {
        _call(pescrow, payer, _p(AMOUNT));
        (address c2, uint256 pk2) = makeAddrAndKey("payer2");
        ptoken.mint(c2, AMOUNT);
        P memory p = _p(AMOUNT);
        (p.v, p.r, p.s) = _sign(ptoken, pk2, c2, address(pescrow), AMOUNT, p.permitDeadline);
        assertEq(_call(pescrow, c2, p), 2);
    }

    // -------------------------------------- createEscrow validations also apply

    function test_Permit_RevertsZeroFreelancer() public {
        P memory p = _p(AMOUNT);
        p.freelancer = address(0);
        vm.expectRevert(JobEscrow.ZeroAddress.selector);
        _call(pescrow, payer, p);
    }

    function test_Permit_RevertsFreelancerIsCaller() public {
        P memory p = _p(AMOUNT);
        p.freelancer = payer;
        vm.expectRevert(JobEscrow.InvalidFreelancer.selector);
        _call(pescrow, payer, p);
    }

    function test_Permit_RevertsArbiterIsFreelancer() public {
        P memory p = _p(AMOUNT);
        p.freelancer = arbiter;
        vm.expectRevert(JobEscrow.ArbiterConflict.selector);
        _call(pescrow, payer, p);
    }

    function test_Permit_RevertsArbiterIsCaller() public {
        JobEscrow e2 = new JobEscrow(address(ptoken), payer, ARB_TIMEOUT, MIN_DELIVERY, MIN_REVIEW);
        P memory p = _p(AMOUNT);
        (p.v, p.r, p.s) = _sign(ptoken, payerPk, payer, address(e2), AMOUNT, p.permitDeadline);
        vm.expectRevert(JobEscrow.ArbiterConflict.selector);
        _call(e2, payer, p);
    }

    function test_Permit_RevertsZeroAmount() public {
        P memory p = _p(0);
        vm.expectRevert(JobEscrow.ZeroAmount.selector);
        _call(pescrow, payer, p);
    }

    function test_Permit_RevertsZeroJobRef() public {
        P memory p = _p(AMOUNT);
        p.jobRef = bytes32(0);
        vm.expectRevert(JobEscrow.InvalidJobRef.selector);
        _call(pescrow, payer, p);
    }

    function test_Permit_RevertsDeliveryDeadlineTooSoon() public {
        P memory p = _p(AMOUNT);
        p.deliveryDeadline = uint64(block.timestamp) + MIN_DELIVERY - 1;
        vm.expectRevert(abi.encodeWithSelector(JobEscrow.InvalidDeliveryDeadline.selector, p.deliveryDeadline));
        _call(pescrow, payer, p);
    }

    function test_Permit_RevertsDeliveryDeadlineTooLate() public {
        P memory p = _p(AMOUNT);
        p.deliveryDeadline = uint64(block.timestamp) + 90 days + 1;
        vm.expectRevert(abi.encodeWithSelector(JobEscrow.InvalidDeliveryDeadline.selector, p.deliveryDeadline));
        _call(pescrow, payer, p);
    }

    function test_Permit_AcceptsDeliveryDeadlineBoundaries() public {
        P memory p = _p(AMOUNT);
        p.deliveryDeadline = uint64(block.timestamp) + MIN_DELIVERY;
        _call(pescrow, payer, p);

        P memory q = _p(AMOUNT);
        q.jobRef = keccak256("job-max");
        q.deliveryDeadline = uint64(block.timestamp) + 90 days;
        _call(pescrow, payer, q);
        assertEq(pescrow.escrowCount(), 2);
    }

    function test_Permit_RevertsReviewPeriodTooShort() public {
        P memory p = _p(AMOUNT);
        p.reviewPeriod = MIN_REVIEW - 1;
        vm.expectRevert(abi.encodeWithSelector(JobEscrow.InvalidReviewPeriod.selector, p.reviewPeriod));
        _call(pescrow, payer, p);
    }

    function test_Permit_RevertsReviewPeriodTooLong() public {
        P memory p = _p(AMOUNT);
        p.reviewPeriod = 30 days + 1;
        vm.expectRevert(abi.encodeWithSelector(JobEscrow.InvalidReviewPeriod.selector, p.reviewPeriod));
        _call(pescrow, payer, p);
    }

    // ------------------------------------------------------------------- fuzz

    function testFuzz_Permit_FundsAnyValidAmount(uint256 amount, bytes32 ref, uint256 dOff, uint256 review) public {
        amount = bound(amount, 1, 1_000_000e6);
        vm.assume(ref != bytes32(0));
        P memory p = _p(amount);
        p.jobRef = ref;
        p.deliveryDeadline = uint64(block.timestamp + bound(dOff, MIN_DELIVERY, 90 days));
        p.reviewPeriod = uint64(bound(review, MIN_REVIEW, 30 days));
        uint256 id = _call(pescrow, payer, p);
        assertEq(pescrow.getEscrow(id).amount, amount);
        assertEq(ptoken.balanceOf(address(pescrow)), amount);
        assertEq(ptoken.allowance(payer, address(pescrow)), 0);
    }

    function testFuzz_Permit_GarbageSignatureWithAllowanceStillFunds(uint8 v, bytes32 r, bytes32 s, uint256 amount)
        public
    {
        amount = bound(amount, 1, 1_000_000e6);
        vm.prank(payer);
        ptoken.approve(address(pescrow), amount);
        P memory p = _p(amount);
        (p.v, p.r, p.s) = (v, r, s);
        _call(pescrow, payer, p);
        assertEq(pescrow.totalEscrowed(), amount);
    }

    function testFuzz_Permit_GarbageSignatureWithoutAllowanceReverts(uint8 v, bytes32 r, bytes32 s) public {
        P memory p = _p(AMOUNT);
        (p.v, p.r, p.s) = (v, r, s);
        vm.expectRevert(_insufficientAllowance(0, AMOUNT));
        _call(pescrow, payer, p);
    }
}
