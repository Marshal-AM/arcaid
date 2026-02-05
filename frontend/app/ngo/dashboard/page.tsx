"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Navbar from "@/components/navbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, Building2, Wallet, DollarSign, LogOut, Edit2, Check, X, MapPin, Calendar, ExternalLink, Mail } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import Image from "next/image";
import { CHAINS } from "@/lib/constants";

type NgoProfile = {
  id: string;
  name: string;
  email?: string;
  description?: string;
  location?: string;
  preferred_chain: string;
  wallet_type: string;
  wallet_address: string;
  circle_wallet_id?: string;
  created_at: string;
};

type Payout = {
  id: string;
  market_id: string;
  principal_usdc: string;
  yield_usdc: string;
  total_usdc: string;
  preferred_chain?: string;
  circle_transaction_id?: string;
  circle_transaction_state?: string;
  onchain_tx_hash?: string;
  created_at: string;
  markets: {
    id: string;
    question: string;
    category?: string;
    location?: string;
    outcome?: string;
    resolved_at?: string;
  };
};

interface EditableFieldProps {
  label: string;
  value: string | null | undefined;
  isEditing: boolean;
  onEdit: () => void;
  onSave: (value: string | null) => void;
  onCancel: () => void;
  type?: 'text' | 'textarea';
  icon?: React.ReactNode;
  placeholder?: string;
}

function EditableField({ 
  label, 
  value, 
  isEditing, 
  onEdit, 
  onSave, 
  onCancel,
  type = 'text',
  icon,
  placeholder
}: EditableFieldProps) {
  const [editValue, setEditValue] = useState(value || '');

  useEffect(() => {
    setEditValue(value || '');
  }, [value, isEditing]);

  const handleSave = () => {
    onSave(editValue || null);
  };

  return (
    <div className="flex items-start gap-4 py-4 border-b border-[#28CC95]/20 last:border-0">
      <div className="flex-shrink-0 mt-1">
        {icon && <div className="text-[#28CC95]">{icon}</div>}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-400 mb-2 uppercase tracking-wide">{label}</p>
        {isEditing ? (
          <div className="space-y-2">
            {type === 'textarea' ? (
              <Textarea
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                placeholder={placeholder}
                className="bg-black border-[#28CC95]/30 text-white focus:border-[#28CC95] min-h-24"
              />
            ) : (
              <Input
                type={type}
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                placeholder={placeholder}
                className="bg-black border-[#28CC95]/30 text-white focus:border-[#28CC95] text-lg"
              />
            )}
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={handleSave}
                className="bg-[#28CC95] text-black hover:bg-[#28CC95]/90"
              >
                <Check className="w-4 h-4 mr-1" />
                Save
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={onCancel}
                className="border-[#28CC95]/30 text-gray-300 hover:bg-[#28CC95]/20"
              >
                <X className="w-4 h-4 mr-1" />
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between group">
            <p className="text-xl font-semibold text-white break-words">
              {value || <span className="text-gray-500 italic">Not set</span>}
            </p>
            <Button
              variant="ghost"
              size="sm"
              onClick={onEdit}
              className="opacity-0 group-hover:opacity-100 transition-opacity text-[#28CC95] hover:text-[#28CC95] hover:bg-[#28CC95]/20"
            >
              <Edit2 className="w-4 h-4" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function NgoDashboardPage() {
  const router = useRouter();
  const [ngo, setNgo] = useState<NgoProfile | null>(null);
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [payoutsLoading, setPayoutsLoading] = useState(true);
  const [editingField, setEditingField] = useState<string | null>(null);
  const [selectedPayout, setSelectedPayout] = useState<Payout | null>(null);
  const [walletBalance, setWalletBalance] = useState<string | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);

  // Form state
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [preferredChain, setPreferredChain] = useState("");
  const [walletAddress, setWalletAddress] = useState("");

  useEffect(() => {
    const session = localStorage.getItem("ngoSession");
    if (!session) {
      router.push("/ngo-login");
      return;
    }

    try {
      const ngoData = JSON.parse(session);
      loadProfile(ngoData.id);
      loadPayouts(ngoData.id);
      loadWalletBalance(ngoData.id);
    } catch {
      localStorage.removeItem("ngoSession");
      router.push("/ngo-login");
    }
  }, [router]);

  async function loadProfile(ngoId: string) {
    setLoading(true);
    try {
      const res = await fetch(`/api/ngo/profile?ngoId=${ngoId}`);
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      
      setNgo(json.ngo);
      setName(json.ngo.name || "");
      setDescription(json.ngo.description || "");
      setLocation(json.ngo.location || "");
      setPreferredChain(json.ngo.preferred_chain || "");
      setWalletAddress(json.ngo.wallet_address || "");
    } catch (e: any) {
      alert(e?.message || "Failed to load profile");
    } finally {
      setLoading(false);
    }
  }

  async function loadPayouts(ngoId: string) {
    setPayoutsLoading(true);
    try {
      const res = await fetch(`/api/ngo/payouts?ngoId=${ngoId}`);
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      setPayouts(json.payouts || []);
    } catch (e: any) {
      console.error("Failed to load payouts:", e);
    } finally {
      setPayoutsLoading(false);
    }
  }

  async function loadWalletBalance(ngoId: string) {
    setBalanceLoading(true);
    try {
      const res = await fetch(`/api/ngo/balance?ngoId=${ngoId}`);
      const json = await res.json();
      if (json.error) {
        console.error("Failed to load balance:", json.error);
        setWalletBalance(null);
        return;
      }
      setWalletBalance(json.usdcBalance || "0");
    } catch (e: any) {
      console.error("Failed to load wallet balance:", e);
      setWalletBalance(null);
    } finally {
      setBalanceLoading(false);
    }
  }

  const handleFieldEdit = (field: string) => {
    setEditingField(field);
  };

  const handleFieldCancel = () => {
    setEditingField(null);
    if (ngo) {
      setName(ngo.name || "");
      setDescription(ngo.description || "");
      setLocation(ngo.location || "");
      setWalletAddress(ngo.wallet_address || "");
    }
  };

  const handleFieldSave = async (field: string, value: string | null) => {
    if (!ngo) return;

    try {
      setSaving(true);
      const updateData: any = { ngoId: ngo.id };
      updateData[field === 'name' ? 'name' : field === 'description' ? 'description' : field === 'location' ? 'location' : 'walletAddress'] = value;

      const res = await fetch("/api/ngo/profile", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(updateData),
      });
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      
      setNgo(json.ngo);
      localStorage.setItem("ngoSession", JSON.stringify(json.ngo));
      setEditingField(null);
      
      // Update local state
      if (field === 'name') setName(value || "");
      else if (field === 'description') setDescription(value || "");
      else if (field === 'location') setLocation(value || "");
      else if (field === 'walletAddress') setWalletAddress(value || "");
    } catch (e: any) {
      alert(e?.message || "Failed to update profile");
    } finally {
      setSaving(false);
    }
  };

  function handleLogout() {
    localStorage.removeItem("ngoSession");
    router.push("/ngo-login");
  }

  function getExplorerUrl(txHash: string, chain?: string): string {
    if (chain?.includes("ARC") || chain?.includes("Arc")) {
      return `https://testnet.arcscan.app/tx/${txHash}`;
    }
    if (chain?.includes("BASE") || chain?.includes("Base")) {
      return `https://sepolia.basescan.org/tx/${txHash}`;
    }
    // Default to Arc explorer
    return `https://testnet.arcscan.app/tx/${txHash}`;
  }

  if (loading) {
    return (
      <div className="min-h-screen text-white flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-[#28CC95]" />
      </div>
    );
  }

  if (!ngo) {
    return null;
  }

  return (
    <div className="min-h-screen text-white pt-24 pb-12 px-4">
      <Navbar />
      
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-4xl font-bold mb-2">NGO Dashboard</h1>
            <p className="text-gray-400">Manage your profile and view donations</p>
          </div>
          <div className="flex items-center gap-4">
            {/* USDC Balance Display */}
            <div className="flex items-center gap-3 px-4 py-2 bg-black border border-[#28CC95]/30 rounded-lg">
              {balanceLoading ? (
                <div className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin text-[#28CC95]" />
                  <span className="text-gray-400 text-sm">Loading...</span>
                </div>
              ) : walletBalance !== null ? (
                <>
                  <DollarSign className="h-5 w-5 text-[#28CC95]" />
                  <div className="flex flex-col">
                    <p className="text-lg font-bold text-[#28CC95]">
                      {Number(walletBalance).toFixed(6)} USDC
                    </p>
                    <p className="text-xs text-gray-500">
                      {(() => {
                        const chain = CHAINS.find(c => c.value === ngo.preferred_chain);
                        return chain ? chain.label : ngo.preferred_chain;
                      })()}
                    </p>
                  </div>
                </>
              ) : (
                <div className="flex items-center gap-2">
                  <DollarSign className="h-5 w-5 text-gray-500" />
                  <span className="text-gray-400 text-sm">Balance unavailable</span>
                </div>
              )}
            </div>
            <Button
              onClick={handleLogout}
              variant="outline"
              className="border-[#28CC95]/30 text-gray-300 hover:bg-[#28CC95]/20 hover:text-[#28CC95]"
            >
              <LogOut className="h-4 w-4 mr-2" />
              Logout
            </Button>
          </div>
        </div>

        <Tabs defaultValue="donations" className="w-full">
          <TabsList className="grid w-full max-w-md mx-auto grid-cols-2 mb-8 bg-black border-[#28CC95]/30">
            <TabsTrigger value="donations" className="data-[state=active]:bg-[#28CC95] data-[state=active]:text-black">
              Donations Received
            </TabsTrigger>
            <TabsTrigger value="profile" className="data-[state=active]:bg-[#28CC95] data-[state=active]:text-black">
              My Profile
            </TabsTrigger>
          </TabsList>

          <TabsContent value="profile" className="space-y-6">
            {/* Profile Header Card */}
            <Card className="bg-black border-[#28CC95]/30">
          <CardHeader>
            <div className="flex flex-col items-center gap-6">
              <div className="relative">
                <div className="w-32 h-32 rounded-full bg-[#28CC95]/20 flex items-center justify-center border-4 border-[#28CC95]">
                  <Building2 className="w-16 h-16 text-[#28CC95]" />
                </div>
              </div>
              <div className="text-center">
                <CardTitle className="text-3xl text-white mb-2">{ngo.name}</CardTitle>
                {ngo.email && (
                  <CardDescription className="text-base flex items-center justify-center gap-2">
                    <Mail className="h-4 w-4" />
                    {ngo.email}
                  </CardDescription>
                )}
              </div>
            </div>
          </CardHeader>
        </Card>

        {/* Profile Details Card */}
        <Card className="bg-black border-[#28CC95]/30 mb-6">
          <CardHeader>
            <CardTitle className="text-2xl text-white">Profile Details</CardTitle>
            <CardDescription>Update your NGO information</CardDescription>
          </CardHeader>
          <CardContent className="space-y-0">
            <EditableField
              label="NGO Name"
              value={name}
              isEditing={editingField === 'name'}
              onEdit={() => handleFieldEdit('name')}
              onSave={(value) => handleFieldSave('name', value)}
              onCancel={handleFieldCancel}
              icon={<Building2 className="w-5 h-5" />}
              placeholder="Enter NGO name"
            />

            <EditableField
              label="Location"
              value={location}
              isEditing={editingField === 'location'}
              onEdit={() => handleFieldEdit('location')}
              onSave={(value) => handleFieldSave('location', value)}
              onCancel={handleFieldCancel}
              icon={<MapPin className="w-5 h-5" />}
              placeholder="Enter location"
            />

            <EditableField
              label="Description"
              value={description}
              isEditing={editingField === 'description'}
              onEdit={() => handleFieldEdit('description')}
              onSave={(value) => handleFieldSave('description', value)}
              onCancel={handleFieldCancel}
              type="textarea"
              placeholder="Enter description"
            />

            <div className="flex items-start gap-4 py-4 border-b border-[#28CC95]/20 last:border-0">
              <div className="flex-shrink-0 mt-1">
                <div className="text-[#28CC95]"><Wallet className="w-5 h-5" /></div>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-400 mb-2 uppercase tracking-wide">Preferred Chain</p>
                {preferredChain ? (
                  <div className="flex items-center gap-2">
                    {(() => {
                      const chain = CHAINS.find(c => c.value === preferredChain);
                      return chain ? (
                        <>
                          {chain.logo ? (
                            <Image
                              src={`/chain-logo/${chain.logo}`}
                              alt={chain.label}
                              width={24}
                              height={24}
                              className="rounded-full flex-shrink-0"
                            />
                          ) : (
                            <div className="w-6 h-6 rounded-full bg-gray-600 flex items-center justify-center flex-shrink-0">
                              <Building2 className="h-3 w-3 text-gray-400" />
                            </div>
                          )}
                          <p className="text-xl font-semibold text-white break-words">
                            {chain.label}
                          </p>
                        </>
                      ) : (
                        <p className="text-xl font-semibold text-white break-words">
                          {preferredChain}
                        </p>
                      );
                    })()}
                  </div>
                ) : (
                  <p className="text-xl font-semibold text-white break-words">
                    <span className="text-gray-500 italic">Not set</span>
                  </p>
                )}
                <p className="text-xs text-gray-500 mt-1">Chain cannot be changed after registration</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Wallet Configuration Card */}
        <Card className="bg-black border-[#28CC95]/30 mb-6">
          <CardHeader>
            <CardTitle className="text-2xl text-white flex items-center gap-2">
              <Wallet className="h-5 w-5 text-[#28CC95]" />
              Wallet Configuration
            </CardTitle>
            <CardDescription>Your wallet details</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label className="text-gray-300">Wallet Type</Label>
              <div className="p-3 bg-black border border-[#28CC95]/30 rounded-lg">
                <Badge className={ngo.wallet_type === "CIRCLE_DEV" ? "bg-[#28CC95] text-black" : "bg-gray-600"}>
                  {ngo.wallet_type === "CIRCLE_DEV" ? "Circle Developer Wallet" : "External EVM Wallet"}
                </Badge>
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-gray-300">Wallet Address</Label>
              <div className="p-3 bg-black border border-[#28CC95]/30 rounded-lg font-mono text-sm break-all">
                {ngo.wallet_address}
              </div>
            </div>

            {ngo.wallet_type === "EVM_EXTERNAL" && (
              <EditableField
                label="Update Wallet Address"
                value={walletAddress}
                isEditing={editingField === 'walletAddress'}
                onEdit={() => handleFieldEdit('walletAddress')}
                onSave={(value) => handleFieldSave('walletAddress', value)}
                onCancel={handleFieldCancel}
                icon={<Wallet className="w-5 h-5" />}
                placeholder="0x..."
              />
            )}

            {ngo.circle_wallet_id && (
              <div className="space-y-2">
                <Label className="text-gray-300">Circle Wallet ID</Label>
                <div className="p-3 bg-black border border-[#28CC95]/30 rounded-lg font-mono text-xs break-all text-gray-400">
                  {ngo.circle_wallet_id}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
          </TabsContent>

          <TabsContent value="donations" className="space-y-6">
            {/* Donations Section */}
            <Card className="bg-black border-[#28CC95]/30">
              <CardHeader>
                <CardTitle className="text-2xl text-white flex items-center gap-2">
                  <DollarSign className="h-5 w-5 text-[#28CC95]" />
                  Donations Received
                </CardTitle>
                <CardDescription>View all donations you've received from resolved markets</CardDescription>
              </CardHeader>
          <CardContent>
            {payoutsLoading ? (
              <div className="text-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-[#28CC95] mx-auto" />
              </div>
            ) : payouts.length === 0 ? (
              <div className="text-center py-8 text-gray-400">
                No donations received yet
              </div>
            ) : (
              <div className="rounded-lg border border-[#28CC95]/30 overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="border-[#28CC95]/20 hover:bg-[#28CC95]/5">
                      <TableHead className="text-gray-300">Market</TableHead>
                      <TableHead className="text-gray-300">Category</TableHead>
                      <TableHead className="text-gray-300">Total Amount</TableHead>
                      <TableHead className="text-gray-300">Date</TableHead>
                      <TableHead className="text-gray-300">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {payouts.map((payout) => (
                      <TableRow 
                        key={payout.id}
                        className="border-[#28CC95]/20 hover:bg-[#28CC95]/10 cursor-pointer"
                        onClick={() => setSelectedPayout(payout)}
                      >
                        <TableCell className="font-medium text-white">
                          <div className="max-w-xs truncate">
                            {payout.markets.question}
                          </div>
                        </TableCell>
                        <TableCell className="text-gray-400">
                          {payout.markets.category || "—"}
                        </TableCell>
                        <TableCell className="text-[#28CC95] font-semibold">
                          {Number(payout.total_usdc).toFixed(6)} USDC
                        </TableCell>
                        <TableCell className="text-gray-400">
                          {format(new Date(payout.created_at), 'MMM dd, yyyy')}
                        </TableCell>
                        <TableCell>
                          <Badge className={payout.markets.outcome ? "bg-[#28CC95] text-black" : "bg-gray-600"}>
                            {payout.markets.outcome || "Pending"}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* Donation Details Dialog */}
      <Dialog open={!!selectedPayout} onOpenChange={() => setSelectedPayout(null)}>
        <DialogContent className="bg-black border-[#28CC95]/30 text-white max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-2xl text-white">
              Donation Details
            </DialogTitle>
            <DialogDescription className="text-gray-400">
              Detailed information about this donation
            </DialogDescription>
          </DialogHeader>
          {selectedPayout && (
            <div className="space-y-6">
              <div>
                <h3 className="text-lg font-semibold text-white mb-2">Market Question</h3>
                <p className="text-gray-300">{selectedPayout.markets.question}</p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-gray-400 mb-1">Category</p>
                  <p className="text-white">{selectedPayout.markets.category || "—"}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-400 mb-1">Location</p>
                  <p className="text-white">{selectedPayout.markets.location || "—"}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-400 mb-1">Outcome</p>
                  <Badge className={selectedPayout.markets.outcome ? "bg-[#28CC95] text-black" : "bg-gray-600"}>
                    {selectedPayout.markets.outcome || "Pending"}
                  </Badge>
                </div>
                <div>
                  <p className="text-sm text-gray-400 mb-1">Resolved At</p>
                  <p className="text-white">
                    {selectedPayout.markets.resolved_at 
                      ? format(new Date(selectedPayout.markets.resolved_at), 'MMM dd, yyyy HH:mm')
                      : "—"}
                  </p>
                </div>
              </div>

              <div className="border-t border-[#28CC95]/20 pt-4">
                <h3 className="text-lg font-semibold text-white mb-4">Donation Breakdown</h3>
                <div className="grid grid-cols-3 gap-4">
                  <div className="p-4 bg-black border border-[#28CC95]/30 rounded-lg">
                    <p className="text-xs text-gray-400 mb-2">Principal</p>
                    <p className="text-xl font-bold text-[#28CC95]">
                      {Number(selectedPayout.principal_usdc).toFixed(6)} USDC
                    </p>
                  </div>
                  <div className="p-4 bg-black border border-[#28CC95]/30 rounded-lg">
                    <p className="text-xs text-gray-400 mb-2">Yield</p>
                    <p className="text-xl font-bold text-[#28CC95]">
                      {Number(selectedPayout.yield_usdc).toFixed(6)} USDC
                    </p>
                  </div>
                  <div className="p-4 bg-black border border-[#28CC95]/30 rounded-lg">
                    <p className="text-xs text-gray-400 mb-2">Total</p>
                    <p className="text-xl font-bold text-white">
                      {Number(selectedPayout.total_usdc).toFixed(6)} USDC
                    </p>
                  </div>
                </div>
              </div>

              <div className="border-t border-[#28CC95]/20 pt-4 space-y-3">
                <div className="flex items-center gap-2 text-sm">
                  <Calendar className="h-4 w-4 text-gray-400" />
                  <span className="text-gray-400">Received:</span>
                  <span className="text-white">{format(new Date(selectedPayout.created_at), 'MMMM dd, yyyy HH:mm')}</span>
                </div>

                {selectedPayout.onchain_tx_hash && (
                  <div className="flex items-center gap-2">
                    <ExternalLink className="h-4 w-4 text-gray-400" />
                    <span className="text-gray-400">On-chain Transaction:</span>
                    <a
                      href={getExplorerUrl(selectedPayout.onchain_tx_hash, selectedPayout.preferred_chain)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[#28CC95] hover:underline flex items-center gap-1 font-mono text-sm"
                    >
                      {selectedPayout.onchain_tx_hash.slice(0, 10)}...{selectedPayout.onchain_tx_hash.slice(-8)}
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                )}

                {selectedPayout.circle_transaction_id && (
                  <div className="flex items-center gap-2">
                    <span className="text-gray-400">Circle Transaction ID:</span>
                    <span className="text-white font-mono text-sm">{selectedPayout.circle_transaction_id}</span>
                    {selectedPayout.circle_transaction_state && (
                      <Badge className="bg-gray-600 text-xs">
                        {selectedPayout.circle_transaction_state}
                      </Badge>
                    )}
                  </div>
                )}

                {selectedPayout.preferred_chain && (
                  <div className="flex items-center gap-2">
                    <span className="text-gray-400">Chain:</span>
                    {(() => {
                      const chain = CHAINS.find(c => c.value === selectedPayout.preferred_chain);
                      return chain ? (
                        <div className="flex items-center gap-2">
                          {chain.logo ? (
                            <Image
                              src={`/chain-logo/${chain.logo}`}
                              alt={chain.label}
                              width={20}
                              height={20}
                              className="rounded-full flex-shrink-0"
                            />
                          ) : (
                            <div className="w-5 h-5 rounded-full bg-gray-600 flex items-center justify-center flex-shrink-0">
                              <Building2 className="h-3 w-3 text-gray-400" />
                            </div>
                          )}
                          <span className="text-white">{chain.label}</span>
                        </div>
                      ) : (
                        <span className="text-white">{selectedPayout.preferred_chain}</span>
                      );
                    })()}
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
