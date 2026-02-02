// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;
import "./IERC20.sol";

contract BridgeManager {
    address public admin;
    address public treasuryVault;
    IERC20 public usdcToken;
    
    struct BridgeOperation {
        bytes32 marketId;
        uint256 amount;
        uint256 sourceChain;
        uint256 destChain;
        string circleAttestationId;
        bool isCompleted;
    }
    
    mapping(bytes32 => BridgeOperation) public bridgeOps;
    
    event BridgeInitiated(bytes32 indexed opId, bytes32 marketId, uint256 amount, uint256 destChain);
    event BridgeCompleted(bytes32 indexed opId);
    
    modifier onlyAdmin() {
        require(msg.sender == admin, "Only admin");
        _;
    }
    
    constructor(address _usdcToken, address _treasuryVault) {
        admin = msg.sender;
        usdcToken = IERC20(_usdcToken);
        treasuryVault = _treasuryVault;
    }
    
    function initiateBridge(
        bytes32 _marketId,
        uint256 _amount,
        uint256 _destChain,
        string memory _circleAttestationId
    ) external onlyAdmin returns (bytes32) {
        bytes32 opId = keccak256(abi.encodePacked(_marketId, _amount, block.timestamp));
        
        bridgeOps[opId] = BridgeOperation({
            marketId: _marketId,
            amount: _amount,
            sourceChain: block.chainid,
            destChain: _destChain,
            circleAttestationId: _circleAttestationId,
            isCompleted: false
        });
        
        emit BridgeInitiated(opId, _marketId, _amount, _destChain);
        return opId;
    }
    
    function completeBridge(bytes32 _opId) external onlyAdmin {
        bridgeOps[_opId].isCompleted = true;
        emit BridgeCompleted(_opId);
    }
    
    function getBridgeOperation(bytes32 _opId) external view returns (BridgeOperation memory) {
        return bridgeOps[_opId];
    }
}