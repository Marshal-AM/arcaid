// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

interface IPolicyEngine {
    function validatePayout(bytes32 policyId, uint256 totalYield, uint256 ngoCount) 
        external view returns (uint256, uint256, uint256, uint256);
}

interface INGORegistry {
    struct NGO {
        string name;
        address walletAddress;
        string circleWalletId;
        uint256 preferredChainId;
        bool isVerified;
        bool isActive;
    }
    function getNGO(bytes32 ngoId) external view returns (NGO memory);
    function isNGOEligible(bytes32 ngoId) external view returns (bool);
}

interface ITreasuryVault {
    function recordDeposit(bytes32 marketId, address user, uint256 amount) external;
    function getTotalYield(bytes32 marketId) external view returns (uint256);
    function getUserPrincipal(bytes32 marketId, address user) external view returns (uint256);
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
    function getMarketInfo() external view returns (MarketInfo memory);
    function getWinners() external view returns (address[] memory winners, uint256[] memory amounts);
    function getAllParticipants() external view returns (address[] memory);
    function getUserCapitalContributed(address user) external view returns (uint256);
    function markPaidOut() external;
    function oracle() external view returns (address);
}

contract PayoutExecutor {
    address public admin;
    IPolicyEngine public policyEngine;
    INGORegistry public ngoRegistry;
    ITreasuryVault public treasuryVault;
    
    struct PayoutRecord {
        bytes32 marketId;
        uint256 totalYieldDistributed;
        uint256 ngoPayoutTotal;
        uint256 winnerPayoutTotal;
        uint256 protocolFees;
        bool isExecuted;
    }
    
    struct NGOPayout {
        bytes32 ngoId;
        string circleWalletId;
        uint256 amount;
        uint256 chainId;
    }
    
    struct WinnerPayout {
        address user;
        uint256 principal;
        uint256 reward;
    }
    
    struct LoserPayout {
        address user;
        uint256 principal;
    }
    
    mapping(bytes32 => PayoutRecord) public payoutRecords;
    mapping(bytes32 => NGOPayout[]) public ngoPayouts;
    mapping(bytes32 => WinnerPayout[]) public winnerPayouts;
    mapping(bytes32 => LoserPayout[]) public loserPayouts;
    
    event PayoutCalculated(bytes32 indexed marketId, uint256 totalYield);
    event NGOPayoutScheduled(bytes32 indexed marketId, bytes32 ngoId, uint256 amount, uint256 chainId);
    event WinnerPayoutScheduled(bytes32 indexed marketId, address winner, uint256 reward);
    event LoserPayoutScheduled(bytes32 indexed marketId, address loser, uint256 principal);
    event PayoutExecuted(bytes32 indexed marketId);
    
    modifier onlyAdmin() {
        require(msg.sender == admin, "Only admin");
        _;
    }
    
    constructor(address _policyEngine, address _ngoRegistry, address _treasuryVault) {
        admin = msg.sender;
        policyEngine = IPolicyEngine(_policyEngine);
        ngoRegistry = INGORegistry(_ngoRegistry);
        treasuryVault = ITreasuryVault(_treasuryVault);
    }
    
    function calculatePayouts(address _marketAddress) external returns (bytes32) {
        IMarket market = IMarket(_marketAddress);
        
        IMarket.MarketInfo memory info = market.getMarketInfo();
        bytes32 marketId = info.marketId;
        bytes32 policyId = info.policyId;
        bytes32[] memory eligibleNGOs = info.eligibleNGOs;
        
        uint256 totalYield = treasuryVault.getTotalYield(marketId);
        
        (uint256 ngoAmount, uint256 winnerAmount, uint256 protocolAmount, uint256 amountPerNGO) = 
            policyEngine.validatePayout(policyId, totalYield, eligibleNGOs.length);
        
        // Clear previous payout arrays so we don't append stale data (e.g. from when yield was 0)
        delete ngoPayouts[marketId];
        delete winnerPayouts[marketId];
        delete loserPayouts[marketId];
        
        payoutRecords[marketId] = PayoutRecord({
            marketId: marketId,
            totalYieldDistributed: totalYield,
            ngoPayoutTotal: ngoAmount,
            winnerPayoutTotal: winnerAmount,
            protocolFees: protocolAmount,
            isExecuted: false
        });
        
        // Schedule NGO payouts
        for (uint256 i = 0; i < eligibleNGOs.length; i++) {
            if (ngoRegistry.isNGOEligible(eligibleNGOs[i])) {
                INGORegistry.NGO memory ngo = ngoRegistry.getNGO(eligibleNGOs[i]);
                ngoPayouts[marketId].push(NGOPayout(eligibleNGOs[i], ngo.circleWalletId, amountPerNGO, ngo.preferredChainId));
                emit NGOPayoutScheduled(marketId, eligibleNGOs[i], amountPerNGO, ngo.preferredChainId);
            }
        }
        
        // Schedule winner payouts with HYBRID formula
        (address[] memory winners, uint256[] memory tokenAmounts) = market.getWinners();
        
        // Calculate total winning tokens and total winning capital
        uint256 totalWinningTokens = 0;
        uint256 totalWinningCapital = 0;
        
        for (uint256 i = 0; i < winners.length; i++) {
            totalWinningTokens += tokenAmounts[i];
            totalWinningCapital += market.getUserCapitalContributed(winners[i]);
        }
        
        // Distribute yield using hybrid formula: geometric mean of token share and capital share
        for (uint256 i = 0; i < winners.length; i++) {
            uint256 principal = treasuryVault.getUserPrincipal(marketId, winners[i]);
            
            // Token weight: user's tokens / total winning tokens
            uint256 tokenWeight = (tokenAmounts[i] * 1e18) / totalWinningTokens;
            
            // Capital weight: user's capital / total winning capital
            uint256 capitalWeight = (market.getUserCapitalContributed(winners[i]) * 1e18) / totalWinningCapital;
            
            // Hybrid weight: geometric mean of token and capital weights
            // hybridWeight = sqrt(tokenWeight * capitalWeight)
            uint256 hybridWeight = sqrt((tokenWeight * capitalWeight) / 1e18);
            
            // Reward = winnerAmount * hybridWeight
            uint256 reward = (winnerAmount * hybridWeight) / 1e18;
            
            winnerPayouts[marketId].push(WinnerPayout(winners[i], principal, reward));
            emit WinnerPayoutScheduled(marketId, winners[i], reward);
        }
        
        // Schedule loser payouts (principal refund only)
        address[] memory allParticipants = market.getAllParticipants();
        for (uint256 i = 0; i < allParticipants.length; i++) {
            address participant = allParticipants[i];
            
            // Check if participant is a winner
            bool isWinner = false;
            for (uint256 j = 0; j < winners.length; j++) {
                if (winners[j] == participant) {
                    isWinner = true;
                    break;
                }
            }
            
            // If not a winner, schedule principal refund
            if (!isWinner) {
                uint256 principal = treasuryVault.getUserPrincipal(marketId, participant);
                if (principal > 0) {
                    loserPayouts[marketId].push(LoserPayout(participant, principal));
                    emit LoserPayoutScheduled(marketId, participant, principal);
                }
            }
        }
        
        emit PayoutCalculated(marketId, totalYield);
        return marketId;
    }
    
    function markPayoutsExecuted(bytes32 _marketId, address _marketAddress) external onlyAdmin {
        payoutRecords[_marketId].isExecuted = true;
        IMarket(_marketAddress).markPaidOut();
        emit PayoutExecuted(_marketId);
    }
    
    function getNGOPayouts(bytes32 _marketId) external view returns (NGOPayout[] memory) {
        return ngoPayouts[_marketId];
    }
    
    function getWinnerPayouts(bytes32 _marketId) external view returns (WinnerPayout[] memory) {
        return winnerPayouts[_marketId];
    }
    
    function getLoserPayouts(bytes32 _marketId) external view returns (LoserPayout[] memory) {
        return loserPayouts[_marketId];
    }
    
    /**
     * @notice Calculate square root using Babylonian method
     * @param x Value to calculate square root of
     * @return y Square root of x
     */
    function sqrt(uint256 x) internal pure returns (uint256 y) {
        if (x == 0) return 0;
        uint256 z = (x + 1) / 2;
        y = x;
        while (z < y) {
            y = z;
            z = (x / z + z) / 2;
        }
    }
}
