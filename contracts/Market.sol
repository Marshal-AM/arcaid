// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;
interface IOutcomeToken {
    function mint(address to, uint256 amount) external;
    function balanceOf(address account) external view returns (uint256);
    function totalSupply() external view returns (uint256);
}

interface IOutcomeOracle {
    enum Outcome { PENDING, YES, NO, INVALID }
    function getOutcome(bytes32 marketId) external view returns (Outcome);
    function isResolved(bytes32 marketId) external view returns (bool);
}

contract Market {
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
    
    address public admin;
    address public marketFactory;
    MarketInfo public marketInfo;
    
    IOutcomeToken public yesToken;
    IOutcomeToken public noToken;
    IOutcomeOracle public oracle;
    
    address[] public participants;
    mapping(address => bool) public hasParticipated;
    
    // Dynamic pricing: Virtual AMM reserves
    uint256 public virtualYesShares;
    uint256 public virtualNoShares;
    uint256 public constant INITIAL_LIQUIDITY = 100_000e6; // 100k virtual tokens
    
    // Track capital contribution for hybrid payout
    mapping(address => uint256) public userCapitalContributed;
    
    event MarketCreated(bytes32 indexed marketId, string question);
    event UserParticipated(address indexed user, bool votedYes, uint256 amount);
    event TokensPurchased(address indexed user, bool isYes, uint256 tokens, uint256 price, uint256 usdcSpent);
    event MarketClosed(bytes32 indexed marketId);
    event MarketResolved(bytes32 indexed marketId);
    
    modifier onlyAdmin() {
        require(msg.sender == admin, "Only admin");
        _;
    }
    
    modifier onlyFactory() {
        require(msg.sender == marketFactory, "Only factory");
        _;
    }
    
    constructor(
        bytes32 _marketId,
        string memory _question,
        string memory _disasterType,
        string memory _location,
        uint256 _duration,
        bytes32 _policyId,
        bytes32[] memory _eligibleNGOs,
        address _yesToken,
        address _noToken,
        address _oracle,
        address _marketFactory
    ) {
        admin = msg.sender;
        marketFactory = _marketFactory;
        
        marketInfo.marketId = _marketId;
        marketInfo.question = _question;
        marketInfo.disasterType = _disasterType;
        marketInfo.location = _location;
        marketInfo.startTime = block.timestamp;
        marketInfo.endTime = block.timestamp + _duration;
        marketInfo.state = MarketState.ACTIVE;
        marketInfo.policyId = _policyId;
        marketInfo.eligibleNGOs = _eligibleNGOs;
        
        yesToken = IOutcomeToken(_yesToken);
        noToken = IOutcomeToken(_noToken);
        oracle = IOutcomeOracle(_oracle);
        
        // Initialize virtual reserves for 50/50 pricing (0.50 each)
        virtualYesShares = INITIAL_LIQUIDITY / 2;
        virtualNoShares = INITIAL_LIQUIDITY / 2;
        
        emit MarketCreated(_marketId, _question);
    }
    
    /**
     * @notice Get current YES token price (in USDC, 6 decimals)
     * @dev Price = virtualNoShares / (virtualYesShares + virtualNoShares)
     * @return price in USDC (e.g., 500000 = 0.50 USDC)
     */
    function getYesPrice() public view returns (uint256) {
        uint256 total = virtualYesShares + virtualNoShares;
        return (virtualNoShares * 1e6) / total;
    }
    
    /**
     * @notice Get current NO token price (in USDC, 6 decimals)
     * @dev Price = virtualYesShares / (virtualYesShares + virtualNoShares)
     * @return price in USDC (e.g., 500000 = 0.50 USDC)
     */
    function getNoPrice() public view returns (uint256) {
        uint256 total = virtualYesShares + virtualNoShares;
        return (virtualYesShares * 1e6) / total;
    }
    
    /**
     * @notice Calculate how many tokens you get for a given USDC amount
     * @param usdcAmount Amount of USDC to spend (6 decimals)
     * @param isYes true for YES tokens, false for NO tokens
     * @return tokens Number of tokens that would be minted
     */
    function calculateTokensForUsdc(uint256 usdcAmount, bool isYes) public view returns (uint256) {
        uint256 price = isYes ? getYesPrice() : getNoPrice();
        return (usdcAmount * 1e6) / price;
    }
    
    /**
     * @notice Record participation with dynamic pricing (called by MarketFactory)
     * @param _user User address
     * @param _votedYes true for YES, false for NO
     * @param _amount USDC amount spent (6 decimals)
     */
    function recordParticipation(address _user, bool _votedYes, uint256 _amount) external onlyFactory {
        require(marketInfo.state == MarketState.ACTIVE, "Market not active");
        
        // Track participant
        if (!hasParticipated[_user]) {
            hasParticipated[_user] = true;
            participants.push(_user);
        }
        
        // Get current price
        uint256 currentPrice = _votedYes ? getYesPrice() : getNoPrice();
        
        // Calculate tokens to mint: tokens = usdcAmount / price
        uint256 tokensToMint = (_amount * 1e6) / currentPrice;
        
        // Update virtual reserves (affects future prices)
        if (_votedYes) {
            virtualYesShares -= tokensToMint;
            virtualNoShares += tokensToMint;
            yesToken.mint(_user, tokensToMint);
        } else {
            virtualNoShares -= tokensToMint;
            virtualYesShares += tokensToMint;
            noToken.mint(_user, tokensToMint);
        }
        
        // Track capital contribution for hybrid payout
        userCapitalContributed[_user] += _amount;
        
        emit UserParticipated(_user, _votedYes, _amount);
        emit TokensPurchased(_user, _votedYes, tokensToMint, currentPrice, _amount);
    }
    
    function closeMarket() external onlyAdmin {
        require(block.timestamp >= marketInfo.endTime, "Not expired");
        marketInfo.state = MarketState.CLOSED;
        emit MarketClosed(marketInfo.marketId);
    }
    
    function forceCloseMarket() external onlyAdmin {
        // Force close for testing - bypasses expiration check
        require(marketInfo.state == MarketState.ACTIVE, "Market not active");
        marketInfo.state = MarketState.CLOSED;
        emit MarketClosed(marketInfo.marketId);
    }
    
    function resolveMarket() external onlyAdmin {
        require(marketInfo.state == MarketState.CLOSED, "Not closed");
        require(oracle.isResolved(marketInfo.marketId), "Oracle not resolved");
        marketInfo.state = MarketState.RESOLVED;
        emit MarketResolved(marketInfo.marketId);
    }
    
    function markPaidOut() external onlyFactory {
        marketInfo.state = MarketState.PAID_OUT;
    }
    
    function getWinners() external view returns (address[] memory winners, uint256[] memory amounts) {
        require(marketInfo.state == MarketState.RESOLVED, "Not resolved");
        
        IOutcomeOracle.Outcome outcome = oracle.getOutcome(marketInfo.marketId);
        IOutcomeToken winningToken = (outcome == IOutcomeOracle.Outcome.YES) ? yesToken : noToken;
        
        uint256 winnerCount = 0;
        for (uint256 i = 0; i < participants.length; i++) {
            if (winningToken.balanceOf(participants[i]) > 0) {
                winnerCount++;
            }
        }
        
        winners = new address[](winnerCount);
        amounts = new uint256[](winnerCount);
        uint256 index = 0;
        
        for (uint256 i = 0; i < participants.length; i++) {
            uint256 balance = winningToken.balanceOf(participants[i]);
            if (balance > 0) {
                winners[index] = participants[i];
                amounts[index] = balance;
                index++;
            }
        }
        
        return (winners, amounts);
    }
    
    function getMarketInfo() external view returns (MarketInfo memory) {
        return marketInfo;
    }
    
    function getAllParticipants() external view returns (address[] memory) {
        return participants;
    }
    
    function getUserCapitalContributed(address _user) external view returns (uint256) {
        return userCapitalContributed[_user];
    }
}