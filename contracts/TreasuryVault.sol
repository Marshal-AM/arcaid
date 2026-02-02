// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;
import "./IERC20.sol";

contract TreasuryVault {
    address public admin;
    address public marketFactory;
    address public bridgeManager;
    IERC20 public usdcToken;
    
    struct MarketBalance {
        uint256 totalPrincipal;
        uint256 totalYield;
        uint256 deployedToEthereum;
        bool isActive;
    }
    
    mapping(bytes32 => MarketBalance) public marketBalances;
    mapping(bytes32 => mapping(address => uint256)) public userPrincipal;
    
    uint256 public totalTreasuryBalance;
    uint256 public protocolFees;
    
    event Deposit(bytes32 indexed marketId, address indexed user, uint256 amount);
    event YieldRecorded(bytes32 indexed marketId, uint256 yieldAmount);
    event FundsDeployedToEthereum(bytes32 indexed marketId, uint256 amount);
    
    modifier onlyAdmin() {
        require(msg.sender == admin, "Only admin");
        _;
    }
    
    modifier onlyAuthorized() {
        require(msg.sender == admin || msg.sender == marketFactory || msg.sender == bridgeManager, "Not authorized");
        _;
    }
    
    constructor(address _usdcToken) {
        admin = msg.sender;
        usdcToken = IERC20(_usdcToken);
    }
    
    function setMarketFactory(address _factory) external onlyAdmin {
        marketFactory = _factory;
    }
    
    function setBridgeManager(address _manager) external onlyAdmin {
        bridgeManager = _manager;
    }
    
    function recordDeposit(bytes32 _marketId, address _user, uint256 _amount) external onlyAuthorized {
        marketBalances[_marketId].totalPrincipal += _amount;
        marketBalances[_marketId].isActive = true;
        userPrincipal[_marketId][_user] += _amount;
        totalTreasuryBalance += _amount;
        emit Deposit(_marketId, _user, _amount);
    }
    
    function recordYield(bytes32 _marketId, uint256 _yieldAmount) external onlyAuthorized {
        marketBalances[_marketId].totalYield += _yieldAmount;
        totalTreasuryBalance += _yieldAmount;
        emit YieldRecorded(_marketId, _yieldAmount);
    }
    
    function recordDeploymentToEthereum(bytes32 _marketId, uint256 _amount) external onlyAuthorized {
        marketBalances[_marketId].deployedToEthereum = _amount;
        emit FundsDeployedToEthereum(_marketId, _amount);
    }
    
    function getTotalYield(bytes32 _marketId) external view returns (uint256) {
        return marketBalances[_marketId].totalYield;
    }
    
    function getUserPrincipal(bytes32 _marketId, address _user) external view returns (uint256) {
        return userPrincipal[_marketId][_user];
    }
    
    function getMarketBalance(bytes32 _marketId) external view returns (MarketBalance memory) {
        return marketBalances[_marketId];
    }
    
    function addProtocolFees(uint256 _amount) external onlyAuthorized {
        protocolFees += _amount;
    }
}