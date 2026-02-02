// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;
contract OutcomeOracle {
    enum Outcome { PENDING, YES, NO, INVALID }
    
    struct Resolution {
        Outcome outcome;
        uint256 confidence;
        uint256 timestamp;
        string evidence;
        bool isFinalized;
    }
    
    address public admin;
    address public aiSubmitter;
    uint256 public minConfidence = 8000;
    
    mapping(bytes32 => Resolution) public resolutions;
    
    event OutcomeSubmitted(bytes32 indexed marketId, Outcome outcome, uint256 confidence);
    event OutcomeFinalized(bytes32 indexed marketId, Outcome outcome);
    
    modifier onlyAdmin() {
        require(msg.sender == admin, "Only admin");
        _;
    }
    
    modifier onlyAI() {
        require(msg.sender == aiSubmitter, "Only AI");
        _;
    }
    
    constructor(address _aiSubmitter) {
        admin = msg.sender;
        aiSubmitter = _aiSubmitter;
    }
    
    function submitOutcome(
        bytes32 _marketId,
        Outcome _outcome,
        uint256 _confidence,
        string memory _evidence
    ) external onlyAI {
        require(_outcome != Outcome.PENDING, "Invalid outcome");
        require(_confidence >= minConfidence, "Confidence too low");
        
        resolutions[_marketId] = Resolution(_outcome, _confidence, block.timestamp, _evidence, false);
        emit OutcomeSubmitted(_marketId, _outcome, _confidence);
    }
    
    function finalizeOutcome(bytes32 _marketId) external onlyAdmin {
        resolutions[_marketId].isFinalized = true;
        emit OutcomeFinalized(_marketId, resolutions[_marketId].outcome);
    }
    
    function isResolved(bytes32 _marketId) external view returns (bool) {
        return resolutions[_marketId].isFinalized;
    }
    
    function getOutcome(bytes32 _marketId) external view returns (Outcome) {
        require(resolutions[_marketId].isFinalized, "Not finalized");
        return resolutions[_marketId].outcome;
    }
    
    function updateAISubmitter(address _newSubmitter) external onlyAdmin {
        aiSubmitter = _newSubmitter;
    }
}