// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;
contract ProtocolRegistry {
    address public admin;
    address public treasuryWallet;
    address public outcomeOracle;
    address public marketFactory;
    address public usdcToken;
    address public policyEngine;
    address public payoutExecutor;
    address public ngoRegistry;
    address public bridgeManager;
    address public treasuryVault;
    
    uint256 public ethereumChainId = 11155111; // Sepolia
    address public ethereumYieldController;
    
    mapping(address => bool) public authorizedOperators;
    
    event ConfigUpdated(string key, address value);
    
    modifier onlyAdmin() {
        require(msg.sender == admin, "Only admin");
        _;
    }
    
    constructor() {
        admin = msg.sender;
    }
    
    function setTreasuryWallet(address _wallet) external onlyAdmin {
        treasuryWallet = _wallet;
        emit ConfigUpdated("treasuryWallet", _wallet);
    }
    
    function setOutcomeOracle(address _oracle) external onlyAdmin {
        outcomeOracle = _oracle;
        emit ConfigUpdated("outcomeOracle", _oracle);
    }
    
    function setMarketFactory(address _factory) external onlyAdmin {
        marketFactory = _factory;
        emit ConfigUpdated("marketFactory", _factory);
    }
    
    function setUSDCToken(address _token) external onlyAdmin {
        usdcToken = _token;
        emit ConfigUpdated("usdcToken", _token);
    }
    
    function setPolicyEngine(address _engine) external onlyAdmin {
        policyEngine = _engine;
    }
    
    function setPayoutExecutor(address _executor) external onlyAdmin {
        payoutExecutor = _executor;
    }
    
    function setNGORegistry(address _registry) external onlyAdmin {
        ngoRegistry = _registry;
    }
    
    function setBridgeManager(address _manager) external onlyAdmin {
        bridgeManager = _manager;
    }
    
    function setTreasuryVault(address _vault) external onlyAdmin {
        treasuryVault = _vault;
    }
    
    function setEthereumConfig(uint256 _chainId, address _yieldController) external onlyAdmin {
        ethereumChainId = _chainId;
        ethereumYieldController = _yieldController;
    }
    
    function authorizeOperator(address _operator, bool _status) external onlyAdmin {
        authorizedOperators[_operator] = _status;
    }
}