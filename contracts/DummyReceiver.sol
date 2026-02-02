// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @title DummyReceiver - Simple contract to test ERC20 transfers
 * @notice This contract accepts ERC20 tokens and tracks received amounts
 */
interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
}

contract DummyReceiver {
    address public owner;
    
    // Track total received per token
    mapping(address => uint256) public totalReceived;
    
    // Track received amounts per sender
    mapping(address => mapping(address => uint256)) public receivedFrom; // token => sender => amount
    
    event TokensReceived(address indexed token, address indexed from, uint256 amount);
    event NativeReceived(address indexed from, uint256 amount);
    
    constructor() {
        owner = msg.sender;
    }
    
    /**
     * @notice Accept native tokens (for Arc testnet where USDC is native)
     */
    receive() external payable {
        emit NativeReceived(msg.sender, msg.value);
    }
    
    /**
     * @notice Fallback function
     */
    fallback() external payable {
        emit NativeReceived(msg.sender, msg.value);
    }
    
    /**
     * @notice Get balance of a specific token
     */
    function getTokenBalance(address token) external view returns (uint256) {
        return IERC20(token).balanceOf(address(this));
    }
    
    /**
     * @notice Get total received for a token
     */
    function getTotalReceived(address token) external view returns (uint256) {
        return totalReceived[token];
    }
    
    /**
     * @notice Withdraw tokens (owner only)
     */
    function withdrawToken(address token, address to, uint256 amount) external {
        require(msg.sender == owner, "Only owner");
        require(IERC20(token).transfer(to, amount), "Transfer failed");
    }
    
    /**
     * @notice Withdraw native tokens (owner only)
     */
    function withdrawNative(address payable to, uint256 amount) external {
        require(msg.sender == owner, "Only owner");
        to.transfer(amount);
    }
}
