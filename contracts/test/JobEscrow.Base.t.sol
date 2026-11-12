// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {JobEscrow} from "../JobEscrow.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";

/// @dev Shared fixture. Contains NO test functions.
abstract contract JobEscrowBase is Test {
    JobEscrow internal escrow;
    MockUSDC internal usdc;

    address internal arbiter = makeAddr("arbiter");
    address internal client = makeAddr("client");
    address internal freelancer = makeAddr("freelancer");
    address internal stranger = makeAddr("stranger");
    address internal other = makeAddr("other");

    uint64 internal constant ARB_TIMEOUT = 1 days;
    uint64 internal constant MIN_DELIVERY = 1 hours;
    uint64 internal constant MIN_REVIEW = 1 hours;
    uint64 internal constant DELIVERY = 7 days;
    uint64 internal constant REVIEW = 3 days;
    uint256 internal constant AMOUNT = 1_000e6;
    bytes32 internal constant JOB = keccak256("job-1");
    bytes32 internal constant DELIVERY_HASH = keccak256("delivery");
    bytes32 internal constant REASON = keccak256("reason");
    uint256 internal constant T0 = 1_700_000_000;

    function setUp() public virtual {
        vm.warp(T0);
        usdc = new MockUSDC();
        escrow = new JobEscrow(address(usdc), arbiter, ARB_TIMEOUT, MIN_DELIVERY, MIN_REVIEW);
        _fund(client, 1_000_000e6);
        _fund(stranger, 1_000_000e6);
    }

    function _fund(address who, uint256 amt) internal {
        usdc.mint(who, amt);
        vm.prank(who);
        usdc.approve(address(escrow), type(uint256).max);
    }

    function _create() internal returns (uint256) {
        return _createWith(client, JOB, AMOUNT);
    }

    function _createWith(address who, bytes32 ref, uint256 amt) internal returns (uint256 id) {
        vm.prank(who);
        id = escrow.createEscrow(ref, freelancer, amt, uint64(block.timestamp) + DELIVERY, REVIEW);
    }

    function _createSubmitted() internal returns (uint256 id) {
        id = _create();
        vm.prank(freelancer);
        escrow.submitWork(id, DELIVERY_HASH);
    }

    function _createDisputed() internal returns (uint256 id) {
        id = _createSubmitted();
        vm.prank(client);
        escrow.dispute(id, REASON);
    }
}
