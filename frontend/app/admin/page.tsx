"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Navbar from "@/components/navbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Loader2, AlertCircle, CheckCircle2, XCircle, MapPin, Calendar } from "lucide-react";
import { format } from "date-fns";

type Market = {
  id: string;
  question: string;
  category: string | null;
  location: string | null;
  duration_days: number;
  outcome: string | null;
  state: string;
  arc_market_id: string | null;
  arc_market_address: string | null;
  created_at: string;
};

export default function AdminPage() {
  const router = useRouter();
  const [markets, setMarkets] = useState<Market[]>([]);
  const [loading, setLoading] = useState(true);
  const [resolving, setResolving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadMarkets();
  }, []);

  async function loadMarkets() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/markets", { cache: "no-store" });
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      setMarkets(json.markets || []);
    } catch (e: any) {
      setError(e?.message || "Failed to load markets");
    } finally {
      setLoading(false);
    }
  }

  async function handleResolve(marketId: string) {
    if (!confirm("Are you sure you want to resolve this market? This will trigger the payout process.")) {
      return;
    }

    setResolving(marketId);
    setError(null);

    try {
      const res = await fetch("/api/admin/resolve-market", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ marketId }),
      });

      const json = await res.json();
      if (json.error) {
        throw new Error(json.error);
      }

      alert("Market resolved successfully! Payout process initiated.");
      loadMarkets(); // Refresh markets
    } catch (e: any) {
      setError(e?.message || "Failed to resolve market");
      alert(`Error: ${e?.message || "Failed to resolve market"}`);
    } finally {
      setResolving(null);
    }
  }

  function getStateBadge(state: string) {
    switch (state) {
      case "OPEN":
        return <Badge className="bg-[#28CC95] text-black">OPEN</Badge>;
      case "RESOLVED":
        return <Badge className="bg-blue-600 text-white">RESOLVED</Badge>;
      case "CLOSED":
        return <Badge className="bg-gray-600 text-white">CLOSED</Badge>;
      case "PAID_OUT":
        return <Badge className="bg-green-600 text-white">PAID_OUT</Badge>;
      default:
        return <Badge className="bg-gray-500 text-white">{state}</Badge>;
    }
  }

  function getOutcomeBadge(outcome: string | null) {
    if (!outcome) return <Badge className="bg-gray-600 text-white">Pending</Badge>;
    switch (outcome) {
      case "YES":
        return <Badge className="bg-green-600 text-white">YES</Badge>;
      case "NO":
        return <Badge className="bg-red-600 text-white">NO</Badge>;
      default:
        return <Badge className="bg-gray-600 text-white">{outcome}</Badge>;
    }
  }

  return (
    <div className="min-h-screen text-white pt-24 pb-12 px-4">
      <Navbar />
      
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold mb-2">Admin Dashboard</h1>
          <p className="text-gray-400">Resolve markets and execute payouts</p>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400">
            {error}
          </div>
        )}

        <Card className="bg-black border-[#28CC95]/30">
          <CardHeader>
            <CardTitle className="text-2xl text-white">All Markets</CardTitle>
            <CardDescription>Manage and resolve prediction markets</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="text-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-[#28CC95] mx-auto" />
              </div>
            ) : markets.length === 0 ? (
              <div className="text-center py-8 text-gray-400">
                No markets found
              </div>
            ) : (
              <div className="rounded-lg border border-[#28CC95]/30 overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="border-[#28CC95]/20 hover:bg-[#28CC95]/5">
                      <TableHead className="text-gray-300">Question</TableHead>
                      <TableHead className="text-gray-300">Category</TableHead>
                      <TableHead className="text-gray-300">Location</TableHead>
                      <TableHead className="text-gray-300">State</TableHead>
                      <TableHead className="text-gray-300">Outcome</TableHead>
                      <TableHead className="text-gray-300">Created</TableHead>
                      <TableHead className="text-gray-300">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {markets.map((market) => (
                      <TableRow 
                        key={market.id}
                        className="border-[#28CC95]/20 hover:bg-[#28CC95]/10"
                      >
                        <TableCell className="font-medium text-white">
                          <div className="max-w-md truncate">
                            {market.question}
                          </div>
                        </TableCell>
                        <TableCell className="text-gray-400">
                          {market.category || "—"}
                        </TableCell>
                        <TableCell className="text-gray-400">
                          {market.location || "—"}
                        </TableCell>
                        <TableCell>
                          {getStateBadge(market.state)}
                        </TableCell>
                        <TableCell>
                          {getOutcomeBadge(market.outcome)}
                        </TableCell>
                        <TableCell className="text-gray-400">
                          {format(new Date(market.created_at), 'MMM dd, yyyy')}
                        </TableCell>
                        <TableCell>
                          {market.state === "OPEN" && !market.outcome ? (
                            <Button
                              onClick={() => handleResolve(market.id)}
                              disabled={resolving === market.id}
                              variant="destructive"
                              size="sm"
                              className="bg-red-600 hover:bg-red-700"
                            >
                              {resolving === market.id ? (
                                <>
                                  <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                                  Resolving...
                                </>
                              ) : (
                                "Resolve"
                              )}
                            </Button>
                          ) : (
                            <span className="text-gray-500 text-sm">—</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
