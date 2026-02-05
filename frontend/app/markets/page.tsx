"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import Navbar from "@/components/navbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Loader2, TrendingUp, TrendingDown, MapPin, Calendar, AlertCircle, ExternalLink } from "lucide-react";
import { ethers } from "ethers";

type Market = {
  id: string;
  question: string;
  category: string | null;
  location: string | null;
  duration_days: number;
  policy_id: string;
  outcome: string | null;
  state: string;
  arc_market_id: string | null;
  arc_market_address: string | null;
};

type TraderSession = {
  traderId: string;
  circleWalletId: string;
  walletAddress: string;
  blockchain: string;
};

type MarketPrices = {
  yesPrice: string;
  noPrice: string;
};

export default function MarketsPage() {
  const [markets, setMarkets] = useState<Market[]>([]);
  const [loadingMarkets, setLoadingMarkets] = useState(true);
  const [marketsError, setMarketsError] = useState<string | null>(null);

  const [session, setSession] = useState<TraderSession | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [showFundModal, setShowFundModal] = useState(false);
  const [balance, setBalance] = useState<string>("0");
  const [checkingBalance, setCheckingBalance] = useState(false);

  // Modal state
  const [selectedMarket, setSelectedMarket] = useState<Market | null>(null);
  const [marketPrices, setMarketPrices] = useState<MarketPrices | null>(null);
  const [loadingPrices, setLoadingPrices] = useState(false);
  const [tradeAmount, setTradeAmount] = useState("1.0");
  const [trading, setTrading] = useState(false);
  const [tradeResult, setTradeResult] = useState<any>(null);
  const [bridgeYieldLogs, setBridgeYieldLogs] = useState<Array<{ step: string; message: string; explorerUrl?: string; txHash?: string }>>([]);
  const [bridgeYieldLoading, setBridgeYieldLoading] = useState(false);

  const refreshBalance = useCallback(async () => {
    if (!session) return;
    setCheckingBalance(true);
    try {
      const res = await fetch("/api/trader/balance", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ circleWalletId: session.circleWalletId }),
      });
      const json = await res.json();
      if (json.error) {
        throw new Error(json.error);
      }
      const balanceValue = json.usdcAmount ?? "0";
      setBalance(String(balanceValue));
    } catch (e: any) {
      setBalance("0");
    } finally {
      setCheckingBalance(false);
    }
  }, [session]);

  useEffect(() => {
    const raw = localStorage.getItem("traderSession");
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        setSession(parsed);
      } catch {
        localStorage.removeItem("traderSession");
      }
    }
  }, []);

  // Refresh balance when session is available
  useEffect(() => {
    if (session) {
      refreshBalance();
    }
  }, [session, refreshBalance]);

  useEffect(() => {
    (async () => {
      setLoadingMarkets(true);
      setMarketsError(null);
      try {
        const res = await fetch("/api/markets", { cache: "no-store" });
        const json = await res.json();
        setMarkets(json.markets || []);
      } catch (e: any) {
        setMarketsError(e?.message ? String(e.message) : "Failed to load markets");
      } finally {
        setLoadingMarkets(false);
      }
    })();
  }, []);

  // Fetch prices when market is selected
  useEffect(() => {
    if (selectedMarket?.arc_market_address && selectedMarket.state === "OPEN") {
      fetchMarketPrices(selectedMarket.id);
    }
  }, [selectedMarket]);

  async function fetchMarketPrices(marketId: string) {
    setLoadingPrices(true);
    setMarketPrices(null);
    try {
      const res = await fetch(`/api/markets/${marketId}/prices`);
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      setMarketPrices({ yesPrice: json.yesPrice, noPrice: json.noPrice });
    } catch (e: any) {
      // Don't show error to user
    } finally {
      setLoadingPrices(false);
    }
  }

  const canTrade = useMemo(() => {
    if (!session) return false;
    const n = Number(tradeAmount);
    return Number.isFinite(n) && n > 0;
  }, [session, tradeAmount]);

  async function connectWallet() {
    setConnecting(true);
    try {
      const res = await fetch("/api/trader/connect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      const next: TraderSession = {
        traderId: json.trader.id,
        circleWalletId: json.wallet.id,
        walletAddress: json.wallet.address,
        blockchain: json.wallet.blockchain,
      };
      setSession(next);
      localStorage.setItem("traderSession", JSON.stringify(next));
      setShowFundModal(true);
    } catch (e: any) {
      alert(e?.message ? String(e.message) : "Connect wallet failed");
    } finally {
      setConnecting(false);
    }
  }

  async function trade(side: "YES" | "NO") {
    if (!session || !selectedMarket) return;
    setTrading(true);
    setTradeResult(null);
    setBridgeYieldLogs([]);
    setBridgeYieldLoading(false);
    
    try {
      // Step 1: Execute trade
      const res = await fetch("/api/trade", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          traderId: session.traderId,
          traderCircleWalletId: session.circleWalletId,
          marketId: selectedMarket.id,
          side,
          amountUsdc: Number(tradeAmount),
        }),
      });
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      setTradeResult(json);
      
      // Step 2: If participation succeeded, trigger bridge and yield deployment
      if (json.participation?.txHash && !json.participation?.error && selectedMarket.arc_market_id) {
        setBridgeYieldLoading(true);
        const amountWei = ethers.parseUnits(tradeAmount, 6).toString();
        
        try {
          const bridgeRes = await fetch("/api/trade/bridge-yield", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              marketId: selectedMarket.arc_market_id,
              amountWei,
            }),
          });
          const bridgeJson = await bridgeRes.json();
          
          if (bridgeJson.logs) {
            setBridgeYieldLogs(bridgeJson.logs);
          }
          
          if (bridgeJson.success) {
            setTradeResult({
              ...json,
              bridgeYield: {
                success: true,
                positionId: bridgeJson.positionId,
                transactions: bridgeJson.transactions,
                logs: bridgeJson.logs,
              },
            });
          } else {
            setTradeResult({
              ...json,
              bridgeYield: {
                success: false,
                error: bridgeJson.error,
                logs: bridgeJson.logs,
              },
            });
          }
        } catch (bridgeErr: any) {
          setTradeResult({
            ...json,
            bridgeYield: {
              success: false,
              error: bridgeErr?.message || "Bridge/yield deployment failed",
            },
          });
        } finally {
          setBridgeYieldLoading(false);
          setTrading(false); // Set trading to false after bridge/yield completes
        }
      }
      
      await refreshBalance();
      // Refresh prices after trade
      if (selectedMarket) {
        await fetchMarketPrices(selectedMarket.id);
      }
    } catch (e: any) {
      alert(e?.message ? String(e.message) : "Trade failed");
      setTrading(false);
      setBridgeYieldLoading(false);
    }
  }

  function openMarketModal(market: Market) {
    setSelectedMarket(market);
    setTradeAmount("1.0");
    setTradeResult(null);
  }

  function closeMarketModal() {
    setSelectedMarket(null);
    setMarketPrices(null);
    setTradeResult(null);
  }

  return (
    <div className="min-h-screen text-white pt-24 pb-12 px-4">
      <Navbar 
        wallet={{
          session,
          balance,
          checkingBalance,
          onRefreshBalance: refreshBalance,
          onConnectWallet: connectWallet,
          connecting,
        }}
      />
      
      <div className="max-w-7xl mx-auto">
        <div className="mb-8 text-center">
          <h1 className="text-4xl font-bold mb-2">Open Markets</h1>
          <p className="text-gray-400">Trade on disaster relief outcomes</p>
        </div>

        {loadingMarkets ? (
          <div className="text-center py-12 text-gray-400">Loading markets...</div>
        ) : marketsError ? (
          <div className="text-center py-12 text-red-500">Error: {marketsError}</div>
        ) : markets.length === 0 ? (
          <div className="text-center py-12 text-gray-400">No markets available</div>
        ) : (
          <div className="grid gap-6 md:grid-cols-2">
            {markets.map((market) => (
              <Card
                key={market.id}
                className="bg-black border-[#28CC95]/30 hover:border-[#28CC95] transition-all cursor-pointer"
                onClick={() => openMarketModal(market)}
              >
                <CardHeader>
                  <div className="flex items-center gap-2 mb-3">
                    <Badge 
                      className={
                        market.state === "OPEN" 
                          ? "bg-[#28CC95] text-black hover:bg-[#28CC95]/90" 
                          : market.state === "RESOLVED"
                          ? "bg-gray-600 text-white"
                          : "bg-gray-700 text-gray-300"
                      }
                    >
                      {market.state}
                    </Badge>
                  </div>
                  <CardTitle className="text-2xl mb-3">{market.question}</CardTitle>
                  <CardDescription className="text-gray-400 space-y-1">
                    {market.category && (
                      <div className="flex items-center gap-2">
                        <AlertCircle className="h-4 w-4" />
                        <span>{market.category}</span>
                      </div>
                    )}
                    {market.location && (
                      <div className="flex items-center gap-2">
                        <MapPin className="h-4 w-4" />
                        <span>{market.location}</span>
                      </div>
                    )}
                    <div className="flex items-center gap-2">
                      <Calendar className="h-4 w-4" />
                      <span>{market.duration_days} days</span>
                    </div>
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {market.outcome && (
                    <div className="mb-4">
                      <Badge variant="outline" className="border-[#28CC95] text-[#28CC95]">
                        Outcome: {market.outcome}
                      </Badge>
                    </div>
                  )}
                  {market.state === "OPEN" && (
                    <div className="text-sm text-gray-400">Click to view prices and trade</div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Fund Wallet Modal */}
      <Dialog open={showFundModal} onOpenChange={setShowFundModal}>
        <DialogContent className="bg-black border-[#28CC95]/30 text-white">
          <DialogHeader>
            <DialogTitle>Fund Your Wallet</DialogTitle>
            <DialogDescription className="text-gray-400">
              Send test USDC to your Circle wallet address to start trading.
            </DialogDescription>
          </DialogHeader>
          {session && (
            <div className="space-y-4">
              <div>
                <Label className="text-gray-300">Wallet Address</Label>
                <div className="mt-1 p-3 bg-black border border-[#28CC95]/30 rounded-md font-mono text-sm break-all">
                  {session.walletAddress}
                </div>
              </div>
              <div className="text-sm text-gray-400">
                You can get test USDC from:{" "}
                <a href="https://faucet.circle.com/" target="_blank" rel="noopener noreferrer" className="text-[#28CC95] hover:underline">
                  https://faucet.circle.com/
                </a>
              </div>
              <Button onClick={() => setShowFundModal(false)} className="w-full bg-[#28CC95] text-black hover:bg-[#28CC95]/90">
                Got it
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Market Trading Modal */}
      <Dialog open={!!selectedMarket} onOpenChange={(open) => !open && closeMarketModal()}>
        <DialogContent className="bg-black border-[#28CC95]/30 text-white !max-w-none w-[calc(100vw-2rem)]">
          <DialogHeader>
            <DialogTitle className="text-2xl">{selectedMarket?.question}</DialogTitle>
            <div className="text-gray-400 space-y-1 pt-2">
              {selectedMarket?.category && (
                <div className="flex items-center gap-2">
                  <AlertCircle className="h-4 w-4" />
                  <span>{selectedMarket.category}</span>
                </div>
              )}
              {selectedMarket?.location && (
                <div className="flex items-center gap-2">
                  <MapPin className="h-4 w-4" />
                  <span>{selectedMarket.location}</span>
                </div>
              )}
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4" />
                <span>{selectedMarket?.duration_days} days duration</span>
              </div>
            </div>
          </DialogHeader>

          {selectedMarket && (
            <div className="grid grid-cols-2 gap-6 mt-4">

              {/* Left Column: Logs */}
              <div className="space-y-4">
                <div className="text-sm font-semibold text-[#28CC95] mb-2">Transaction Logs</div>
                
                {(trading || bridgeYieldLoading || tradeResult) && (
                  <div className="p-4 bg-black border border-[#28CC95]/30 rounded-lg h-[600px] flex flex-col">
                    <div className="text-xs font-semibold text-gray-300 mb-3">
                      {trading || bridgeYieldLoading ? (
                        <>
                          <Loader2 className="h-4 w-4 inline-block mr-2 animate-spin" />
                          Processing transaction...
                        </>
                      ) : (
                        "Transaction Complete"
                      )}
                    </div>
                    
                    <div className="flex-1 overflow-y-auto space-y-2 pr-2">
                      {/* Trade Step */}
                      {trading && (
                        <div className="text-xs text-gray-400">
                          <span className="text-gray-500">[trade]</span> Initiating trade...
                        </div>
                      )}
                      
                      {tradeResult && (
                        <>
                          <div className="text-xs text-gray-400">
                            <span className="text-gray-500">[trade]</span> ✅ Circle transfer created
                            {tradeResult.circle && (
                              <span className="text-gray-500 ml-2">ID: {tradeResult.circle.id}</span>
                            )}
                          </div>
                          {tradeResult.participation?.txHash && (
                            <div className="text-xs text-gray-400">
                              <span className="text-gray-500">[trade]</span> ✅ Participation recorded
                              <a
                                href={`https://testnet.arcscan.app/tx/${tradeResult.participation.txHash}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-[#28CC95] hover:underline ml-2 inline-flex items-center gap-1"
                              >
                                View
                                <ExternalLink className="h-3 w-3" />
                              </a>
                            </div>
                          )}
                        </>
                      )}

                      {/* Bridge & Yield Logs */}
                      {bridgeYieldLogs.length > 0 && (
                        <>
                          {bridgeYieldLogs.map((log, idx) => (
                            <div key={idx} className="text-xs text-gray-400">
                              <span className="text-gray-500">[{log.step}]</span> {log.message}
                              {log.explorerUrl && (
                                <a
                                  href={log.explorerUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-[#28CC95] hover:underline ml-2 inline-flex items-center gap-1"
                                >
                                  View
                                  <ExternalLink className="h-3 w-3" />
                                </a>
                              )}
                            </div>
                          ))}
                        </>
                      )}

                      {bridgeYieldLoading && bridgeYieldLogs.length === 0 && (
                        <div className="text-xs text-gray-400">
                          <span className="text-gray-500">[bridge]</span> Starting bridge and yield deployment...
                        </div>
                      )}

                      {tradeResult?.bridgeYield?.error && (
                        <div className="text-xs text-red-400">
                          <span className="text-red-500">[error]</span> {tradeResult.bridgeYield.error}
                        </div>
                      )}

                      {!trading && !bridgeYieldLoading && !tradeResult && (
                        <div className="text-xs text-gray-500 text-center py-8">
                          No transactions yet. Start a trade to see logs here.
                        </div>
                      )}
                    </div>

                    {/* Transaction URLs Summary */}
                    {tradeResult?.bridgeYield?.transactions && (
                      <div className="mt-4 pt-4 border-t border-[#28CC95]/20">
                        <div className="text-xs font-semibold text-gray-300 mb-2">All Transaction URLs:</div>
                        <div className="space-y-1">
                          {tradeResult.bridgeYield.transactions.withdraw && (
                            <div className="text-xs">
                              <span className="text-gray-400">Withdraw:</span>{" "}
                              <a
                                href={tradeResult.bridgeYield.transactions.withdraw.explorerUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-[#28CC95] hover:underline"
                              >
                                {tradeResult.bridgeYield.transactions.withdraw.hash.slice(0, 12)}...
                                <ExternalLink className="h-3 w-3 inline ml-1" />
                              </a>
                            </div>
                          )}
                          {tradeResult.bridgeYield.transactions.bridge?.map((b: any, idx: number) => (
                            <div key={idx} className="text-xs">
                              <span className="text-gray-400">Bridge {b.name}:</span>{" "}
                              {b.explorerUrl && (
                                <a
                                  href={b.explorerUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-[#28CC95] hover:underline"
                                >
                                  View
                                  <ExternalLink className="h-3 w-3 inline ml-1" />
                                </a>
                              )}
                            </div>
                          ))}
                          {tradeResult.bridgeYield.transactions.swap && (
                            <div className="text-xs">
                              <span className="text-gray-400">Swap:</span>{" "}
                              <a
                                href={tradeResult.bridgeYield.transactions.swap.explorerUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-[#28CC95] hover:underline"
                              >
                                {tradeResult.bridgeYield.transactions.swap.hash.slice(0, 12)}...
                                <ExternalLink className="h-3 w-3 inline ml-1" />
                              </a>
                            </div>
                          )}
                          {tradeResult.bridgeYield.transactions.deploy && (
                            <div className="text-xs">
                              <span className="text-gray-400">Deploy to Aave:</span>{" "}
                              <a
                                href={tradeResult.bridgeYield.transactions.deploy.explorerUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-[#28CC95] hover:underline"
                              >
                                {tradeResult.bridgeYield.transactions.deploy.hash.slice(0, 12)}...
                                <ExternalLink className="h-3 w-3 inline ml-1" />
                              </a>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {!trading && !bridgeYieldLoading && !tradeResult && (
                  <div className="p-4 bg-black border border-[#28CC95]/30 rounded-lg h-[600px] flex items-center justify-center">
                    <div className="text-xs text-gray-500 text-center">
                      Transaction logs will appear here when you make a trade
                    </div>
                  </div>
                )}
              </div>
              {/* Right Column: Trading UI */}
              <div className="space-y-6">
                {/* Prices Display */}
                {selectedMarket.state === "OPEN" && (
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <Label className="text-gray-300 text-base">Token Prices</Label>
                      <Button
                        onClick={() => selectedMarket && fetchMarketPrices(selectedMarket.id)}
                        disabled={loadingPrices}
                        variant="ghost"
                        size="sm"
                        className="text-[#28CC95] hover:text-[#28CC95]/80"
                      >
                        {loadingPrices ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          "Refresh"
                        )}
                      </Button>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="p-4 bg-black border border-[#28CC95]/30 rounded-lg">
                        <div className="flex items-center gap-2 mb-2">
                          <TrendingUp className="h-5 w-5 text-[#28CC95]" />
                          <span className="text-sm text-gray-400">YES Price</span>
                        </div>
                        {loadingPrices ? (
                          <div className="flex items-center gap-2 text-lg">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            <span>Loading...</span>
                          </div>
                        ) : marketPrices ? (
                          <>
                            <div className="text-2xl font-bold text-[#28CC95]">
                              {Number(marketPrices.yesPrice).toFixed(6)} USDC
                            </div>
                            {canTrade && marketPrices.yesPrice && (
                              <div className="text-xs text-gray-500 mt-1">
                                ≈ {Number(tradeAmount) / Number(marketPrices.yesPrice) > 0 
                                  ? (Number(tradeAmount) / Number(marketPrices.yesPrice)).toFixed(2) 
                                  : "0"} tokens
                              </div>
                            )}
                          </>
                        ) : (
                          <div className="text-lg text-gray-500">Unable to load</div>
                        )}
                      </div>
                      <div className="p-4 bg-black border border-[#28CC95]/30 rounded-lg">
                        <div className="flex items-center gap-2 mb-2">
                          <TrendingDown className="h-5 w-5 text-red-400" />
                          <span className="text-sm text-gray-400">NO Price</span>
                        </div>
                        {loadingPrices ? (
                          <div className="flex items-center gap-2 text-lg">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            <span>Loading...</span>
                          </div>
                        ) : marketPrices ? (
                          <>
                            <div className="text-2xl font-bold text-red-400">
                              {Number(marketPrices.noPrice).toFixed(6)} USDC
                            </div>
                            {canTrade && marketPrices.noPrice && (
                              <div className="text-xs text-gray-500 mt-1">
                                ≈ {Number(tradeAmount) / Number(marketPrices.noPrice) > 0 
                                  ? (Number(tradeAmount) / Number(marketPrices.noPrice)).toFixed(2) 
                                  : "0"} tokens
                              </div>
                            )}
                          </>
                        ) : (
                          <div className="text-lg text-gray-500">Unable to load</div>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {selectedMarket.state === "OPEN" && (
                  <>
                    {/* Trade Amount Input */}
                    <div className="space-y-2">
                      <Label htmlFor="trade-amount" className="text-gray-300 text-base">
                        Amount (USDC)
                      </Label>
                      <div className="relative">
                        <Input
                          id="trade-amount"
                          type="number"
                          value={tradeAmount}
                          onChange={(e) => setTradeAmount(e.target.value)}
                          className="bg-black border-[#28CC95]/30 text-white focus:border-[#28CC95] h-16 text-xl font-extrabold pr-16"
                          disabled={trading}
                        />
                        <span className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 font-semibold">
                          USDC
                        </span>
                      </div>
                      <p className="text-xs text-gray-500">
                        Enter the amount of USDC you want to spend on tokens
                      </p>
                    </div>

                    {/* Trade Buttons */}
                    {!session ? (
                      <div className="p-4 bg-[#28CC95]/10 border border-[#28CC95]/30 rounded-lg text-center">
                        <p className="text-[#28CC95] mb-3">Connect your wallet to start trading</p>
                        <Button
                          onClick={connectWallet}
                          disabled={connecting}
                          className="bg-[#28CC95] text-black hover:bg-[#28CC95]/90"
                        >
                          {connecting ? "Connecting..." : "Connect Wallet"}
                        </Button>
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 gap-4">
                        <Button
                          onClick={() => trade("YES")}
                          disabled={!canTrade || trading}
                          className="bg-[#28CC95] text-black hover:bg-[#28CC95]/90 h-14 text-lg font-semibold"
                        >
                          {trading ? (
                            <>
                              <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                              Processing...
                            </>
                          ) : (
                            <>
                              <TrendingUp className="h-5 w-5 mr-2" />
                              Buy YES
                            </>
                          )}
                        </Button>
                        <Button
                          onClick={() => trade("NO")}
                          disabled={!canTrade || trading}
                          className="bg-red-500 text-white hover:bg-red-600 h-14 text-lg font-semibold"
                        >
                          {trading ? (
                            <>
                              <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                              Processing...
                            </>
                          ) : (
                            <>
                              <TrendingDown className="h-5 w-5 mr-2" />
                              Buy NO
                            </>
                          )}
                        </Button>
                      </div>
                    )}

                    {/* Trade Result Summary */}
                    {tradeResult && !trading && (
                      <div className="p-4 bg-[#28CC95]/10 border border-[#28CC95]/30 rounded-lg">
                        <div className="text-sm font-semibold text-[#28CC95] mb-2">Trade Completed</div>
                        <div className="text-xs text-gray-400 space-y-1">
                          {tradeResult.circle && (
                            <div>Circle TX: {tradeResult.circle.id}</div>
                          )}
                          {tradeResult.participation?.txHash && (
                            <div className="flex items-center gap-2">
                              <span>Participation:</span>
                              <a
                                href={`https://testnet.arcscan.app/tx/${tradeResult.participation.txHash}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-[#28CC95] hover:underline flex items-center gap-1"
                              >
                                {tradeResult.participation.txHash.slice(0, 10)}...
                                <ExternalLink className="h-3 w-3" />
                              </a>
                            </div>
                          )}
                          {tradeResult.bridgeYield?.positionId && (
                            <div className="text-[#28CC95] mt-2">
                              ✅ Position ID: {tradeResult.bridgeYield.positionId}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </>
                )}

                {selectedMarket.state !== "OPEN" && (
                  <div className="p-4 bg-gray-800/50 border border-gray-700 rounded-lg text-center">
                    <p className="text-gray-400">This market is {selectedMarket.state.toLowerCase()}</p>
                    {selectedMarket.outcome && (
                      <p className="text-[#28CC95] font-semibold mt-2">Outcome: {selectedMarket.outcome}</p>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}