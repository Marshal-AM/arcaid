// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;
contract OutcomeToken {
    string public name;
    string public symbol;
    uint8 public constant decimals = 6;
    uint256 public totalSupply;
    
    address public market;
    
    mapping(address => uint256) public balanceOf;
    
    event Transfer(address indexed from, address indexed to, uint256 value);
    
    modifier onlyMarket() {
        require(msg.sender == market, "Only market");
        _;
    }
    
    constructor(string memory _name, string memory _symbol, address _market) {
        name = _name;
        symbol = _symbol;
        market = _market;
    }
    
    /**
     * @notice Set the market address (can only be set once, from address(0))
     * @dev This allows MarketFactory to deploy tokens first, then set market after Market is deployed
     */
    function setMarket(address _market) external {
        require(market == address(0), "Market already set");
        require(_market != address(0), "Invalid market address");
        market = _market;
    }
    
    function mint(address _to, uint256 _amount) external onlyMarket {
        balanceOf[_to] += _amount;
        totalSupply += _amount;
        emit Transfer(address(0), _to, _amount);
    }
    
    function burn(address _from, uint256 _amount) external onlyMarket {
        balanceOf[_from] -= _amount;
        totalSupply -= _amount;
        emit Transfer(_from, address(0), _amount);
    }
}