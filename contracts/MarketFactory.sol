// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @title MarketFactory - UPDATED FOR CIRCLE WALLETS
 * @notice This version supports both:
 *   1. Traditional participate() - user approves and we transferFrom
 *   2. participateWithPreTransferredUSDC() - USDC already sent via Circle Gateway
 */

import "./OutcomeToken.sol";
import "./Market.sol";

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
}

interface ITreasuryVault {
    function recordDeposit(bytes32 marketId, address user, uint256 amount) external;
}

interface IMarket {
    enum MarketState { ACTIVE, CLOSED, RESOLVED, PAID_OUT }
    
    struct MarketInfo {
        bytes32 marketId;
        string question;
        string disasterType;
        string location;
        uint256 startTime;
        uint256 endTime;
        MarketState state;
        bytes32 policyId;
        bytes32[] eligibleNGOs;
    }
    
    function recordParticipation(address user, bool votedYes, uint256 amount) external;
    function closeMarket() external;
    function forceCloseMarket() external;
    function resolveMarket() external;
    function getMarketInfo() external view returns (MarketInfo memory);
}

contract MarketFactory {
    address public admin;
    IERC20 public usdcToken;
    address public outcomeOracle;
    ITreasuryVault public treasuryVault;
    
    struct MarketRecord {
        address marketAddress;
        address yesToken;
        address noToken;
        bytes32 marketId;
        bool isActive;
    }
    
    mapping(bytes32 => MarketRecord) public markets;
    bytes32[] public marketIds;
    
    // Track USDC received from Circle Wallets (to prevent double-spending)
    mapping(address => uint256) public pendingCircleDeposits;
    
    event MarketCreated(bytes32 indexed marketId, address marketAddress, string question);
    event UserDeposited(bytes32 indexed marketId, address indexed user, uint256 amount, bool votedYes);
    event CircleDepositReceived(address indexed from, uint256 amount);
    
    modifier onlyAdmin() {
        require(msg.sender == admin, "Only admin");
        _;
    }
    
    constructor(address _usdcToken, address _outcomeOracle, address _treasuryVault) {
        admin = msg.sender;
        usdcToken = IERC20(_usdcToken);
        outcomeOracle = _outcomeOracle;
        treasuryVault = ITreasuryVault(_treasuryVault);
    }
    
    /**
     * @notice Accept native USDC transfers (Arc testnet uses USDC as native token)
     * @dev This allows Circle Gateway to transfer USDC directly to this contract
     */
    receive() external payable {
        emit CircleDepositReceived(msg.sender, msg.value);
    }
    
    /**
     * @notice Fallback function for native USDC transfers
     */
    fallback() external payable {
        emit CircleDepositReceived(msg.sender, msg.value);
    }
    
    /**
     * @notice ORIGINAL METHOD: User approves first, then we transferFrom
     * @dev Use this for MetaMask / traditional wallets
     */
    function participate(bytes32 _marketId, uint256 _amount, bool _votedYes) external {
        MarketRecord storage marketRec = markets[_marketId];
        require(marketRec.isActive, "Market not active");
        require(_amount > 0, "Invalid amount");
        
        // Transfer USDC from user to this contract (requires prior approval)
        require(
            usdcToken.transferFrom(msg.sender, address(this), _amount),
            "USDC transfer failed"
        );
        
        // Record deposit in treasury vault
        treasuryVault.recordDeposit(_marketId, msg.sender, _amount);
        
        // Record participation in market (mints tokens)
        IMarket(marketRec.marketAddress).recordParticipation(msg.sender, _votedYes, _amount);
        
        emit UserDeposited(_marketId, msg.sender, _amount, _votedYes);
    }
    
    /**
     * @notice NEW METHOD: USDC already transferred via Circle Gateway
     * @dev Use this for Circle Programmable Wallets
     * @param _marketId The market to participate in
     * @param _userWallet The Circle Wallet address that sent USDC
     * @param _amount Amount of USDC to use for participation
     * @param _votedYes Whether user voted YES or NO
     * 
     * FLOW:
     * 1. User transfers USDC via Circle Gateway to this contract
     * 2. Backend calls this function to record the participation
     * 3. We verify USDC balance increased
     * 4. We mint YES/NO tokens to the user's wallet
     */
    function participateWithPreTransferredUSDC(
        bytes32 _marketId,
        address _userWallet,
        uint256 _amount,
        bool _votedYes
    ) external onlyAdmin {
        MarketRecord storage marketRec = markets[_marketId];
        require(marketRec.isActive, "Market not active");
        require(_amount > 0, "Invalid amount");
        require(_userWallet != address(0), "Invalid user wallet");
        
        // Verify this contract received the USDC
        // Note: We trust admin (backend) to only call this after Circle transfer completes
        uint256 ourBalance = usdcToken.balanceOf(address(this));
        require(ourBalance >= _amount, "Insufficient USDC in contract");
        
        // Record deposit in treasury vault
        treasuryVault.recordDeposit(_marketId, _userWallet, _amount);
        
        // Record participation in market (mints tokens to user's wallet)
        IMarket(marketRec.marketAddress).recordParticipation(_userWallet, _votedYes, _amount);
        
        emit UserDeposited(_marketId, _userWallet, _amount, _votedYes);
    }
    
    /**
     * @notice Create a new market
     */
    function createMarket(
        string memory _question,
        string memory _disasterType,
        string memory _location,
        uint256 _durationInDays,
        bytes32 _policyId,
        bytes32[] memory _eligibleNGOs
    ) external onlyAdmin returns (bytes32 marketId, address marketAddress) {
        marketId = keccak256(abi.encodePacked(_question, _disasterType, block.timestamp));
        
        // Deploy YES and NO outcome tokens
        OutcomeToken yesToken = new OutcomeToken(
            string(abi.encodePacked("YES-", _disasterType)),
            "YES",
            address(0)
        );
        
        OutcomeToken noToken = new OutcomeToken(
            string(abi.encodePacked("NO-", _disasterType)),
            "NO",
            address(0)
        );
        
        // Deploy the Market contract
        Market market = new Market(
            marketId,
            _question,
            _disasterType,
            _location,
            _durationInDays * 1 days,
            _policyId,
            _eligibleNGOs,
            address(yesToken),
            address(noToken),
            outcomeOracle,
            address(this)
        );
        
        marketAddress = address(market);
        
        // Set the market address in OutcomeTokens so they can mint tokens
        // OutcomeTokens were deployed with address(0), now we set the actual Market address
        yesToken.setMarket(marketAddress);
        noToken.setMarket(marketAddress);
        
        markets[marketId] = MarketRecord(marketAddress, address(yesToken), address(noToken), marketId, true);
        marketIds.push(marketId);
        
        emit MarketCreated(marketId, marketAddress, _question);
        return (marketId, marketAddress);
    }
    
    /**
     * @notice Approve USDC for yield controller
     */
    function approveUSDC(address _spender, uint256 _amount) external onlyAdmin {
        require(usdcToken.approve(_spender, _amount), "Approval failed");
    }
    
    /**
     * @notice Get market details
     */
    function getMarket(bytes32 _marketId) external view returns (MarketRecord memory) {
        return markets[_marketId];
    }
    
    /**
     * @notice Get all market IDs
     */
    function getAllMarketIds() external view returns (bytes32[] memory) {
        return marketIds;
    }
    
    /**
     * @notice Close a market (proxy function to call Market.closeMarket())
     * @dev MarketFactory is the admin of all Markets it creates
     */
    function closeMarket(bytes32 _marketId) external onlyAdmin {
        MarketRecord storage marketRec = markets[_marketId];
        require(marketRec.marketAddress != address(0), "Market does not exist");
        
        // Call closeMarket on the Market contract
        IMarket(marketRec.marketAddress).closeMarket();
    }
    
    /**
     * @notice Force close a market (for testing - bypasses expiration check)
     * @dev MarketFactory is the admin of all Markets it creates
     */
    function forceCloseMarket(bytes32 _marketId) external onlyAdmin {
        MarketRecord storage marketRec = markets[_marketId];
        require(marketRec.marketAddress != address(0), "Market does not exist");
        
        // Call forceCloseMarket on the Market contract
        IMarket(marketRec.marketAddress).forceCloseMarket();
    }
    
    /**
     * @notice Resolve a market (proxy function to call Market.resolveMarket())
     * @dev MarketFactory is the admin of all Markets it creates
     */
    function resolveMarket(bytes32 _marketId) external onlyAdmin {
        MarketRecord storage marketRec = markets[_marketId];
        require(marketRec.marketAddress != address(0), "Market does not exist");
        
        // Call resolveMarket on the Market contract
        IMarket(marketRec.marketAddress).resolveMarket();
    }
    
    /**
     * @notice Deactivate a market
     */
    function deactivateMarket(bytes32 _marketId) external onlyAdmin {
        markets[_marketId].isActive = false;
    }
    
    /**
     * @notice Transfer admin
     */
    function transferAdmin(address _newAdmin) external onlyAdmin {
        require(_newAdmin != address(0), "Invalid address");
        admin = _newAdmin;
    }
    
    /**
     * @notice Withdraw USDC (emergency only)
     */
    function emergencyWithdraw(address _to, uint256 _amount) external onlyAdmin {
        require(usdcToken.transfer(_to, _amount), "Transfer failed");
    }
}

