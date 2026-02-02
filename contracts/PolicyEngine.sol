// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;
contract PolicyEngine {
    struct PayoutPolicy {
        uint256 ngoPercentage;
        uint256 winnerPercentage;
        uint256 protocolPercentage;
        uint256 maxPayoutPerNGO;
        bool isActive;
    }
    
    address public admin;
    mapping(bytes32 => PayoutPolicy) public policies;
    bytes32 public constant DEFAULT_POLICY = keccak256("DEFAULT");
    
    event PolicyCreated(bytes32 indexed policyId, uint256 ngoPercent, uint256 winnerPercent);
    
    modifier onlyAdmin() {
        require(msg.sender == admin, "Only admin");
        _;
    }
    
    constructor() {
        admin = msg.sender;
        policies[DEFAULT_POLICY] = PayoutPolicy(6000, 3000, 1000, 1000000 * 10**6, true);
        emit PolicyCreated(DEFAULT_POLICY, 6000, 3000);
    }
    
    function validatePayout(
        bytes32 _policyId,
        uint256 _totalYield,
        uint256 _ngoCount
    ) external view returns (
        uint256 ngoAmount,
        uint256 winnerAmount,
        uint256 protocolAmount,
        uint256 amountPerNGO
    ) {
        PayoutPolicy memory policy = policies[_policyId];
        require(policy.isActive, "Policy not active");
        
        ngoAmount = (_totalYield * policy.ngoPercentage) / 10000;
        winnerAmount = (_totalYield * policy.winnerPercentage) / 10000;
        protocolAmount = (_totalYield * policy.protocolPercentage) / 10000;
        
        if (_ngoCount > 0) {
            amountPerNGO = ngoAmount / _ngoCount;
        }
        
        return (ngoAmount, winnerAmount, protocolAmount, amountPerNGO);
    }
}