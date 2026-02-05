"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { Building2, ArrowLeft, ArrowRight, Loader2, CheckCircle2, Eye, EyeOff } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";

type NgoResponse =
  | { ngo: any; wallet?: { id: string; address: string; blockchain: string } }
  | { error: string };

import { CHAINS } from "@/lib/constants";

const STEPS = [
  { id: 'auth', title: 'Account Credentials', fields: ['email', 'password'] },
  { id: 'basic', title: 'Basic Information', fields: ['name'] },
  { id: 'wallet', title: 'Wallet Configuration', fields: ['walletType', 'preferredChain'] },
];

export default function NgoSignupPage() {
  const router = useRouter();
  const [currentStep, setCurrentStep] = useState(0);
  
  const [walletType, setWalletType] = useState<"CIRCLE_DEV" | "EVM_EXTERNAL" | "">("");
  const [preferredChain, setPreferredChain] = useState<string>("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [location, setLocation] = useState("");
  const [description, setDescription] = useState("");
  const [externalWalletAddress, setExternalWalletAddress] = useState("");

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState<NgoResponse | null>(null);

  const canProceedStep1 = useMemo(() => {
    return email.trim().length > 0 && password.length >= 6 && password === confirmPassword;
  }, [email, password, confirmPassword]);

  const canProceedStep2 = useMemo(() => {
    return name.trim().length > 0;
  }, [name]);

  const canProceedStep3 = useMemo(() => {
    if (!walletType) return false;
    if (!preferredChain) return false;
    if (walletType === "EVM_EXTERNAL" && !externalWalletAddress.trim()) return false;
    return true;
  }, [preferredChain, walletType, externalWalletAddress]);

  const canSubmit = useMemo(() => {
    return canProceedStep1 && canProceedStep2 && canProceedStep3;
  }, [canProceedStep1, canProceedStep2, canProceedStep3]);

  const progress = ((currentStep + 1) / STEPS.length) * 100;

  const nextStep = () => {
    if (currentStep < STEPS.length - 1) {
      setCurrentStep(currentStep + 1);
    }
  };

  const prevStep = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  async function submit() {
    // Client-side validation before submission
    if (!walletType) {
      setResult({ error: "Please select a wallet type" });
      return;
    }

    if (!preferredChain) {
      setResult({ error: "Please select a preferred chain" });
      return;
    }

    if (walletType === "EVM_EXTERNAL" && !externalWalletAddress.trim()) {
      setResult({ error: "Please enter your external wallet address" });
      return;
    }

    if (!name.trim()) {
      setResult({ error: "Please enter your NGO name" });
      return;
    }

    if (!email.trim()) {
      setResult({ error: "Please enter your email" });
      return;
    }

    if (password.length < 6) {
      setResult({ error: "Password must be at least 6 characters" });
      return;
    }

    if (password !== confirmPassword) {
      setResult({ error: "Passwords do not match" });
      return;
    }

    setIsSubmitting(true);
    setResult(null);
    try {
      const res = await fetch("/api/ngo/signup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name,
          email,
          password,
          location,
          description,
          preferredChain,
          walletType,
          externalWalletAddress: walletType === "EVM_EXTERNAL" ? externalWalletAddress : undefined,
        }),
      });
      const json = (await res.json()) as NgoResponse;
      setResult(json);
      if (!("error" in json)) {
        setTimeout(() => {
          router.push("/ngo-login");
        }, 2000);
      }
    } catch (e: any) {
      setResult({ error: e?.message ? String(e.message) : "Request failed" });
    } finally {
      setIsSubmitting(false);
    }
  }

  const selectedChain = CHAINS.find(c => c.value === preferredChain);

  return (
    <div className="min-h-screen text-white pt-12 pb-12 px-4">
      
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <Button 
            variant="ghost" 
            onClick={() => router.push("/")} 
            className="hover:bg-transparent hover:text-[#28CC95] text-gray-400 pl-0"
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to home
          </Button>
          <Link href="/ngo-login">
            <Button 
              variant="outline" 
              className="border-[#28CC95]/30 text-[#28CC95] hover:bg-[#28CC95]/20"
            >
              Already have an account? Login
            </Button>
          </Link>
        </div>
        
        <Card className="border-t-4 border-t-[#28CC95] shadow-lg bg-black border-[#28CC95]/30">
          <CardHeader className="text-center pb-2">
            <CardTitle className="text-3xl text-white">
              Register Your NGO
            </CardTitle>
            <CardDescription className="text-lg text-gray-400 mt-2">
              {STEPS[currentStep].title}
            </CardDescription>
          </CardHeader>
          
          {/* Progress Bar */}
          <div className="px-8 pb-4">
            <div className="flex justify-between text-sm font-medium text-gray-500 mb-2">
              <span>Step {currentStep + 1} of {STEPS.length}</span>
              <span>{Math.round(progress)}%</span>
            </div>
            <Progress value={progress} className="h-2 bg-gray-800" />
          </div>

          <CardContent className="p-8">
            {/* Step 1: Account Credentials */}
            <div className={cn("space-y-6", currentStep !== 0 && "hidden")}>
              <div className="space-y-2">
                <Label htmlFor="email" className="text-gray-300 text-base">Email *</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="bg-black border-[#28CC95]/30 text-white focus:border-[#28CC95] h-12"
                  placeholder="ngo@example.com"
                  autoFocus
                />
                <p className="text-xs text-gray-500">Used for login to your NGO dashboard</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="password" className="text-gray-300 text-base">Password *</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="bg-black border-[#28CC95]/30 text-white focus:border-[#28CC95] h-12 pr-10"
                    placeholder="Minimum 6 characters"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-[#28CC95] transition-colors"
                  >
                    {showPassword ? (
                      <EyeOff className="h-5 w-5" />
                    ) : (
                      <Eye className="h-5 w-5" />
                    )}
                  </button>
                </div>
                <p className="text-xs text-gray-500">Minimum 6 characters</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="confirmPassword" className="text-gray-300 text-base">Confirm Password *</Label>
                <div className="relative">
                  <Input
                    id="confirmPassword"
                    type={showConfirmPassword ? "text" : "password"}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className={`bg-black border-[#28CC95]/30 text-white focus:border-[#28CC95] h-12 pr-10 ${
                      confirmPassword && password !== confirmPassword ? "border-red-500/50" : ""
                    }`}
                    placeholder="Confirm your password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-[#28CC95] transition-colors"
                  >
                    {showConfirmPassword ? (
                      <EyeOff className="h-5 w-5" />
                    ) : (
                      <Eye className="h-5 w-5" />
                    )}
                  </button>
                </div>
                {confirmPassword && password !== confirmPassword && (
                  <p className="text-xs text-red-400">Passwords do not match</p>
                )}
                {confirmPassword && password === confirmPassword && password.length >= 6 && (
                  <p className="text-xs text-[#28CC95]">Passwords match</p>
                )}
              </div>

              <div className="flex justify-end pt-4">
                <Button
                  onClick={nextStep}
                  disabled={!canProceedStep1}
                  className="bg-[#28CC95] text-black hover:bg-[#28CC95]/90 font-semibold px-8 py-6"
                >
                  Continue
                  <ArrowRight className="h-4 w-4 ml-2" />
                </Button>
              </div>
            </div>

            {/* Step 2: Basic Information */}
            <div className={cn("space-y-6", currentStep !== 1 && "hidden")}>
              <div className="space-y-2">
                <Label htmlFor="name" className="text-gray-300 text-base">NGO Name *</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="bg-black border-[#28CC95]/30 text-white focus:border-[#28CC95] h-12 text-lg"
                  placeholder="Flood Relief Assam"
                  autoFocus
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="location" className="text-gray-300 text-base">Location</Label>
                <Input
                  id="location"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  className="bg-black border-[#28CC95]/30 text-white focus:border-[#28CC95] h-12"
                  placeholder="Assam, India"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="description" className="text-gray-300 text-base">Description</Label>
                <Textarea
                  id="description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="bg-black border-[#28CC95]/30 text-white focus:border-[#28CC95] min-h-[120px]"
                  placeholder="Short description / mission"
                />
              </div>

              <div className="flex justify-between pt-4">
                <Button
                  onClick={prevStep}
                  variant="outline"
                  className="border-[#28CC95]/30 text-gray-300 hover:bg-[#28CC95]/20"
                >
                  <ArrowLeft className="h-4 w-4 mr-2" />
                  Back
                </Button>
                <Button
                  onClick={nextStep}
                  disabled={!canProceedStep2}
                  className="bg-[#28CC95] text-black hover:bg-[#28CC95]/90 font-semibold px-8 py-6"
                >
                  Continue
                  <ArrowRight className="h-4 w-4 ml-2" />
                </Button>
              </div>
            </div>

            {/* Step 3: Wallet Configuration */}
            <div className={cn("space-y-6", currentStep !== 2 && "hidden")}>
              <div className="space-y-2">
                <Label htmlFor="walletType" className="text-gray-300 text-base">Wallet Type *</Label>
                <Select 
                  value={walletType || ""} 
                  onValueChange={(value) => setWalletType(value as any)}
                >
                  <SelectTrigger className={`bg-black border-[#28CC95]/30 text-white focus:border-[#28CC95] h-12 ${
                    !walletType ? "border-red-500/50" : ""
                  }`}>
                    <SelectValue placeholder="Select a wallet type" />
                  </SelectTrigger>
                  <SelectContent className="bg-black border-[#28CC95]/30">
                    <SelectItem value="CIRCLE_DEV" className="text-white focus:bg-[#28CC95]/20 focus:text-[#28CC95]">
                      Circle Developer-Controlled Wallet
                    </SelectItem>
                    <SelectItem value="EVM_EXTERNAL" className="text-white focus:bg-[#28CC95]/20 focus:text-[#28CC95]">
                      External Wallet (MetaMask)
                    </SelectItem>
                  </SelectContent>
                </Select>
                {!walletType && (
                  <p className="text-xs text-red-400">Please select a wallet type</p>
                )}
                {walletType && (
                  <p className="text-xs text-gray-500 mt-1">
                    {walletType === "CIRCLE_DEV" 
                      ? "Automated wallet managed by Circle. Recommended for seamless payouts."
                      : "Connect your existing MetaMask or other EVM wallet."}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="preferredChain" className="text-gray-300 text-base">Preferred Chain to Receive Funds *</Label>
                <Select 
                  value={preferredChain || ""} 
                  onValueChange={(value) => setPreferredChain(value)}
                >
                  <SelectTrigger className={`bg-black border-[#28CC95]/30 text-white focus:border-[#28CC95] h-12 ${
                    !preferredChain ? "border-red-500/50" : ""
                  }`}>
                    <SelectValue placeholder="Select a chain">
                      {selectedChain ? (
                        <div className="flex items-center gap-2">
                          {selectedChain.logo ? (
                            <Image
                              src={`/chain-logo/${selectedChain.logo}`}
                              alt={selectedChain.label}
                              width={20}
                              height={20}
                              className="rounded-full flex-shrink-0"
                            />
                          ) : (
                            <div className="w-5 h-5 rounded-full bg-gray-600 flex-shrink-0" />
                          )}
                          <span>{selectedChain.label}</span>
                        </div>
                      ) : (
                        <span className="text-gray-500">Select a chain</span>
                      )}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent className="bg-black border-[#28CC95]/30 max-h-[300px] overflow-y-auto [&>*]:py-2 scrollbar-thin scrollbar-thumb-[#28CC95]/50 scrollbar-track-black">
                    {CHAINS.map((chain) => (
                      <SelectItem 
                        key={chain.value} 
                        value={chain.value} 
                        className="text-white focus:bg-[#28CC95]/20 focus:text-[#28CC95] cursor-pointer"
                      >
                        <div className="flex items-center gap-3">
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
                          <span className="flex-1">{chain.label}</span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {walletType === "EVM_EXTERNAL" && (
                <div className="space-y-2">
                  <Label htmlFor="externalWallet" className="text-gray-300 text-base">External Wallet Address *</Label>
                  <Input
                    id="externalWallet"
                    value={externalWalletAddress}
                    onChange={(e) => setExternalWalletAddress(e.target.value)}
                    className="bg-black border-[#28CC95]/30 text-white focus:border-[#28CC95] font-mono text-sm h-12"
                    placeholder="0x..."
                  />
                  <p className="text-xs text-gray-500">
                    Enter your wallet address. MetaMask connection can be added later.
                  </p>
                </div>
              )}

              <div className="flex justify-between pt-4">
                <Button
                  onClick={prevStep}
                  variant="outline"
                  className="border-[#28CC95]/30 text-gray-300 hover:bg-[#28CC95]/20 hover:text-[#28CC95] px-8 py-6"
                >
                  <ArrowLeft className="h-4 w-4 mr-2" />
                  Back
                </Button>
                <Button
                  onClick={submit}
                  disabled={!canSubmit || isSubmitting}
                  className="bg-[#28CC95] text-black hover:bg-[#28CC95]/90 font-semibold px-8 py-6 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Creating...
                    </>
                  ) : (
                    "Create NGO Profile"
                  )}
                </Button>
              </div>
            </div>

            {/* Result Display */}
            {result && (
              <div className={`rounded-xl border p-4 text-sm mt-6 ${
                "error" in result 
                  ? "border-red-500/50 bg-red-500/10 text-red-400" 
                  : "border-[#28CC95]/50 bg-[#28CC95]/10 text-[#28CC95]"
              }`}>
                {"error" in result ? (
                  <div className="flex items-center gap-2">
                    <span className="font-medium">Error:</span>
                    <span>{result.error}</span>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 font-medium">
                      <CheckCircle2 className="h-4 w-4" />
                      NGO Profile Created Successfully!
                    </div>
                    <div className="text-xs space-y-1 mt-3">
                      <div>NGO ID: <span className="font-mono">{result.ngo?.id}</span></div>
                      <div>Preferred Chain: {result.ngo?.preferred_chain}</div>
                      <div>Wallet Type: {result.ngo?.wallet_type}</div>
                      <div>Wallet Address: <span className="font-mono text-xs">{result.ngo?.wallet_address}</span></div>
                      {result.wallet && (
                        <div>Circle Wallet ID: <span className="font-mono text-xs">{result.wallet.id}</span></div>
                      )}
                    </div>
                    <p className="text-xs mt-3 text-gray-400">Redirecting to login...</p>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
