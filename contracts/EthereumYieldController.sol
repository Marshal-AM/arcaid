// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @title EthereumYieldController
 * @notice Integrates with Aave V3 on Base Sepolia (Ethereum Sepolia USDC supply cap reached)
 * @dev Deploy this on Base Sepolia testnet
 */

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function allowance(address owner, address spender) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
}

interface IAavePool {
    function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode) external;
    function withdraw(address asset, uint256 amount, address to) external returns (uint256);
}

interface IAToken {
    function balanceOf(address account) external view returns (uint256);
}

/**
 * @dev Aave V3 Addresses on Base Sepolia (Ethereum Sepolia USDC supply cap reached):
 * - Pool: 0x8bAB6d1b75f19e9eD9fCe8b9BD338844fF79aE27
 * - aUSDC: 0x10F1A9D11CDf50041f3f8cB7191CBE2f31750ACC
 * - USDC (Aave reserve): 0xba50Cd2A20f6DA35D788639E581bca8d0B5d4D5f
 */
contract EthereumYieldController {
    address public admin;

    // Aave V3 Base Sepolia addresses (checksummed)
    IERC20 public constant USDC = IERC20(0xba50Cd2A20f6DA35D788639E581bca8d0B5d4D5f);
    IAavePool public constant AAVE_POOL = IAavePool(0x8bAB6d1b75f19e9eD9fCe8b9BD338844fF79aE27);
    IAToken public constant aUSDC = IAToken(0x10F1A9D11CDf50041f3f8cB7191CBE2f31750ACC);

    struct YieldPosition {
        uint256 principalDeposited;
        uint256 depositTimestamp;
        bool isDeployed;
        bytes32 arcMarketId;
    }

    mapping(bytes32 => YieldPosition) public yieldPositions;

    event FundsDeployedToAave(bytes32 indexed positionId, bytes32 arcMarketId, uint256 amount);
    event FundsWithdrawnFromAave(bytes32 indexed positionId, uint256 principal, uint256 yield);
    event YieldCalculated(bytes32 indexed positionId, uint256 yieldAmount);

    modifier onlyAdmin() {
        require(msg.sender == admin, "Only admin");
        _;
    }

    constructor() {
        admin = msg.sender;
    }

    /**
     * @notice Receive USDC from admin and deploy to Aave
     * @param _arcMarketId The market ID from Arc testnet
     * @param _amount Amount of USDC to deposit
     */
    function deployToAave(bytes32 _arcMarketId, uint256 _amount) external onlyAdmin returns (bytes32 positionId) {
        require(_amount > 0, "Invalid amount");

        positionId = keccak256(abi.encodePacked(_arcMarketId, block.timestamp));
        require(!yieldPositions[positionId].isDeployed, "Position exists");

        // 1. Pull USDC from admin (admin must have approved this contract)
        require(USDC.transferFrom(msg.sender, address(this), _amount), "Transfer failed");

        // 2. Approve Aave pool to spend this contract's USDC (required before supply)
        // USDC (and some ERC20s) require resetting allowance to 0 before changing to a new value
        uint256 currentAllowance = USDC.allowance(address(this), address(AAVE_POOL));
        if (currentAllowance > 0) {
            require(USDC.approve(address(AAVE_POOL), 0), "Approval reset failed");
        }
        require(USDC.approve(address(AAVE_POOL), _amount), "Approval failed");

        // 3. Supply to Aave V3 (Aave will pull USDC from this contract)
        AAVE_POOL.supply(address(USDC), _amount, address(this), 0);

        yieldPositions[positionId] = YieldPosition({
            principalDeposited: _amount,
            depositTimestamp: block.timestamp,
            isDeployed: true,
            arcMarketId: _arcMarketId
        });

        emit FundsDeployedToAave(positionId, _arcMarketId, _amount);
        return positionId;
    }

    /**
     * @notice Withdraw from Aave and prepare for bridging back to Arc
     */
    function withdrawFromAave(bytes32 _positionId) external onlyAdmin returns (uint256 principal, uint256 yield) {
        YieldPosition storage position = yieldPositions[_positionId];
        require(position.isDeployed, "Not deployed");

        principal = position.principalDeposited;

        uint256 withdrawnAmount = AAVE_POOL.withdraw(address(USDC), type(uint256).max, address(this));

        if (withdrawnAmount > principal) {
            yield = withdrawnAmount - principal;
        } else {
            yield = 0;
        }

        position.isDeployed = false;

        emit FundsWithdrawnFromAave(_positionId, principal, yield);
        emit YieldCalculated(_positionId, yield);

        return (principal, yield);
    }

    function getCurrentYield(bytes32 _positionId) external view returns (uint256) {
        YieldPosition memory position = yieldPositions[_positionId];
        if (!position.isDeployed) {
            return 0;
        }
        uint256 currentBalance = aUSDC.balanceOf(address(this));
        if (currentBalance > position.principalDeposited) {
            return currentBalance - position.principalDeposited;
        }
        return 0;
    }

    function getPosition(bytes32 _positionId) external view returns (YieldPosition memory) {
        return yieldPositions[_positionId];
    }

    function transferUSDC(address _to, uint256 _amount) external onlyAdmin {
        require(USDC.transfer(_to, _amount), "Transfer failed");
    }

    function emergencyWithdraw(bytes32 _positionId, address _to) external onlyAdmin {
        YieldPosition storage position = yieldPositions[_positionId];
        require(position.isDeployed, "Not deployed");

        uint256 withdrawnAmount = AAVE_POOL.withdraw(address(USDC), type(uint256).max, address(this));
        require(USDC.transfer(_to, withdrawnAmount), "Transfer failed");

        position.isDeployed = false;
    }

    function transferAdmin(address _newAdmin) external onlyAdmin {
        require(_newAdmin != address(0), "Invalid address");
        admin = _newAdmin;
    }
}
