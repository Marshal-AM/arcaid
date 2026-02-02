// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;
contract NGORegistry {
    struct NGO {
        string name;
        address walletAddress;
        string circleWalletId;
        uint256 preferredChainId;
        bool isVerified;
        bool isActive;
    }
    
    address public admin;
    mapping(bytes32 => NGO) public ngos;
    bytes32[] public ngoList;
    
    event NGORegistered(bytes32 indexed ngoId, string name, string circleWalletId);
    event NGOVerified(bytes32 indexed ngoId);
    
    modifier onlyAdmin() {
        require(msg.sender == admin, "Only admin");
        _;
    }
    
    constructor() {
        admin = msg.sender;
    }
    
    function registerNGO(
        string memory _name,
        address _wallet,
        string memory _circleWalletId,
        uint256 _preferredChainId
    ) external onlyAdmin returns (bytes32) {
        bytes32 ngoId = keccak256(abi.encodePacked(_name, block.timestamp));
        ngos[ngoId] = NGO(_name, _wallet, _circleWalletId, _preferredChainId, false, true);
        ngoList.push(ngoId);
        emit NGORegistered(ngoId, _name, _circleWalletId);
        return ngoId;
    }
    
    function verifyNGO(bytes32 _ngoId) external onlyAdmin {
        ngos[_ngoId].isVerified = true;
        emit NGOVerified(_ngoId);
    }
    
    function isNGOEligible(bytes32 _ngoId) external view returns (bool) {
        return ngos[_ngoId].isVerified && ngos[_ngoId].isActive;
    }
    
    function getNGO(bytes32 _ngoId) external view returns (NGO memory) {
        return ngos[_ngoId];
    }
    
    function getAllNGOs() external view returns (bytes32[] memory) {
        return ngoList;
    }
}