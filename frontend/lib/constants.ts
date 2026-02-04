/**
 * Chain and contract constants
 * Centralized configuration for all supported chains and contract addresses
 */

// ============================================================================
// CHAIN CONFIGURATION
// ============================================================================

export const CHAINS = [
  { value: "APTOS-TESTNET", label: "Aptos Testnet", logo: null },
  { value: "ARB-SEPOLIA", label: "Arbitrum Sepolia Testnet", logo: "arbitrum.png" },
  { value: "ARC-TESTNET", label: "Arc Testnet", logo: null },
  { value: "AVAX-FUJI", label: "Avalanche Fuji Testnet", logo: "avalanche.png" },
  { value: "BASE-SEPOLIA", label: "Base Sepolia Testnet", logo: "base.png" },
  { value: "ETH-SEPOLIA", label: "Ethereum Sepolia Testnet", logo: "ethereum.png" },
  { value: "MONAD-TESTNET", label: "Monad Testnet", logo: null },
  { value: "OP-SEPOLIA", label: "Optimism Sepolia Testnet", logo: "optimism.png" },
  { value: "MATIC-AMOY", label: "Polygon Amoy Testnet", logo: "polygon.png" },
  { value: "SOL-DEVNET", label: "Solana Devnet", logo: null },
  { value: "UNI-SEPOLIA", label: "Unichain Sepolia Testnet", logo: "unichain.png" },
] as const;

// Map Circle blockchain identifiers to Bridge Kit chain names
export const CHAIN_TO_BRIDGE_NAME: Record<string, string> = {
  "BASE-SEPOLIA": "Base_Sepolia",
  "ARB-SEPOLIA": "Arbitrum_Sepolia",
  "AVAX-FUJI": "Avalanche_Fuji",
  "ETH-SEPOLIA": "Ethereum_Sepolia",
  "OP-SEPOLIA": "Optimism_Sepolia",
  "MATIC-AMOY": "Polygon_Amoy",
  "UNI-SEPOLIA": "Unichain_Sepolia",
  "APTOS-TESTNET": "Aptos_Testnet",
  "ARC-TESTNET": "Arc_Testnet",
  "MONAD-TESTNET": "Monad_Testnet",
  "SOL-DEVNET": "Solana_Devnet",
};

// ============================================================================
// CIRCLE USDC ADDRESSES (by chain)
// ============================================================================

export const CIRCLE_USDC_ADDRESSES: Record<string, string> = {
  "ALGORAND-TESTNET": "10458941",
  "APTOS-TESTNET": "0x69091fbab5f7d635ee7ac5098cf0c1efbe31d68fec0f2cd565e8d168daf52832",
  "ARB-SEPOLIA": "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d",
  "ARC-TESTNET": "0x3600000000000000000000000000000000000000",
  "AVAX-FUJI": "0x5425890298aed601595a70AB815c96711a31Bc65",
  "BASE-SEPOLIA": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  "CELO-SEPOLIA": "0x01C5C0122039549AD1493B8220cABEdD739BC44E",
  "CODEX-TESTNET": "0x6d7f141b6819C2c9CC2f818e6ad549E7Ca090F8f",
  "ETH-SEPOLIA": "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
  "HEDERA-TESTNET": "0.0.429274",
  "HYPEREVM-TESTNET": "0x2B3370eE501B4a559b57D449569354196457D8Ab",
  "INK-TESTNET": "0xFabab97dCE620294D2B0b0e46C68964e326300Ac",
  "LINEA-SEPOLIA": "0xFEce4462D57bD51A6A552365A011b95f0E16d9B7",
  "MONAD-TESTNET": "0x534b2f3A21130d7a60830c2Df862319e593943A3",
  "NEAR-TESTNET": "3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af",
  "NOBLE-TESTNET": "uusdc",
  "OP-SEPOLIA": "0x5fd84259d66Cd46123540766Be93DFE6D43130D7",
  "PLUME-TESTNET": "0xcB5f30e335672893c7eb944B374c196392C19D18",
  "POLKADOT-WESTMINT": "Asset ID 31337",
  "MATIC-AMOY": "0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582",
  "SEI-TESTNET": "0x4fCF1784B31630811181f670Aea7A7bEF803eaED",
  "SOL-DEVNET": "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
  "SONIC-TESTNET": "0x0BA304580ee7c9a980CF72e55f5Ed2E9fd30Bc51",
  "SONIC-BLAZE-TESTNET": "0xA4879Fed32Ecbef99399e5cbC247E533421C4eC6",
  "STARKNET-SEPOLIA": "0x0512feAc6339Ff7889822cb5aA2a86C848e9D392bB0E3E237C008674feeD8343",
  "STELLAR-TESTNET": "USDC-GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
  "SUI-TESTNET": "0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC",
  "UNI-SEPOLIA": "0x31d0220469e10c4E71834a79b1f276d740d3768F",
  "WORLD-CHAIN-SEPOLIA": "0x66145f38cBAC35Ca6F1Dfb4914dF98F1614aeA88",
  "XDC-APOTHEM": "0xb5AB69F7bBada22B28e79C8FFAECe55eF1c771D4",
  "XRPL-TESTNET": "5553444300000000000000000000000000000000.rHuGNhqTG32mfmAvWA8hUyWRLV3tCSwKQt",
  "ZKSYNC-ERA-TESTNET": "0xAe045DE5638162fa134807Cb558E15A3F5A7F853",
};

// ============================================================================
// ARC CONTRACT ADDRESSES
// ============================================================================

export const ARC_CONTRACTS = {
  PROTOCOL_REGISTRY: "0x3EA6D1c84481f89aac255a7ABC375fe761653cdA",
  NGO_REGISTRY: "0x1E491de1a08843079AAb4cFA516C717597344e50",
  POLICY_ENGINE: "0x14d42947929F1ECf882aA6a07dd4279ADb49345d",
  OUTCOME_ORACLE: "0xC6Ffc4E56388fFa99EA18503a0Ea518e795ceCC8",
  TREASURY_VAULT: "0x9F0BF4aE6BBfD51eDbff77eA0D17A7bec484bb97",
  BRIDGE_MANAGER: "0x9c3420DAcc57d97cd6E579EDadaD58B332eA9D5E",
  MARKET_FACTORY: "0x459A259d7C27F96051af4F002AB0ae74a90A9d8E",
  PAYOUT_EXECUTOR: "0x08f18d1257C8665fe6DAD689B8E1Acd9120C374b",
  USDC: "0x3600000000000000000000000000000000000000",
} as const;

// ============================================================================
// BASE SEPOLIA CONTRACT ADDRESSES
// ============================================================================

export const BASE_SEPOLIA_CONTRACTS = {
  YIELD_CONTROLLER: "0x52553Bc83e9dc86E980E0ADe632CaFD95f132108",
  CIRCLE_USDC: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  AAVE_USDC: "0xba50Cd2A20f6DA35D788639E581bca8d0B5d4D5f",
  SWAP_ROUTER: "0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4",
  AAVE_POOL: "0x8bAB6d1b75f19e9eD9fCe8b9BD338844fF79aE27",
  AUSDC: "0x10F1A9D11CDf50041f3f8cB7191CBE2f31750ACC",
} as const;

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Get Circle USDC address for a chain
 */
export function getCircleUsdcAddress(chain: string): string | null {
  return CIRCLE_USDC_ADDRESSES[chain] || null;
}

/**
 * Get Arc contract address by name
 */
export function getArcContract(name: keyof typeof ARC_CONTRACTS): string {
  return ARC_CONTRACTS[name];
}

/**
 * Get Base Sepolia contract address by name
 */
export function getBaseSepoliaContract(name: keyof typeof BASE_SEPOLIA_CONTRACTS): string {
  return BASE_SEPOLIA_CONTRACTS[name];
}
