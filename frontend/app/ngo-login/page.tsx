"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Building2, ArrowLeft, Eye, EyeOff } from "lucide-react";
import Link from "next/link";

type LoginResponse = {
  ngo: {
    id: string;
    name: string;
    email: string;
    wallet_type: string;
    wallet_address: string;
    preferred_chain: string;
    description?: string;
    location?: string;
  };
} | { error: string };

export default function NgoLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loggingIn, setLoggingIn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleLogin() {
    if (!email.trim() || !password) {
      setError("Email and password are required");
      return;
    }

    setLoggingIn(true);
    setError(null);

    try {
      const res = await fetch("/api/ngo/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const json = (await res.json()) as LoginResponse;

      if ("error" in json) {
        setError(json.error);
        return;
      }

      // Store NGO session
      localStorage.setItem("ngoSession", JSON.stringify(json.ngo));
      
      // Redirect to dashboard
      router.push("/ngo/dashboard");
    } catch (e: any) {
      setError(e?.message ? String(e.message) : "Login failed");
    } finally {
      setLoggingIn(false);
    }
  }

  return (
    <div className="min-h-screen text-white pt-12 pb-12 px-4">
      <div className="max-w-md mx-auto">
        <Link href="/">
          <Button 
            variant="ghost" 
            className="mb-6 hover:bg-transparent hover:text-[#28CC95] text-gray-400 pl-0"
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to home
          </Button>
        </Link>

        <Card className="border-t-4 border-t-[#28CC95] shadow-lg bg-black border-[#28CC95]/30">
          <CardHeader className="text-center pb-2">
            <CardTitle className="text-3xl text-white">NGO Login</CardTitle>
            <CardDescription className="text-lg text-gray-400 mt-2">
              Access your NGO dashboard
            </CardDescription>
          </CardHeader>

          <CardContent className="p-8 space-y-6">
            <div className="space-y-2">
              <Label htmlFor="email" className="text-gray-300 text-base">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="bg-black border-[#28CC95]/30 text-white focus:border-[#28CC95] h-12"
                placeholder="ngo@example.com"
                autoFocus
                onKeyDown={(e) => e.key === "Enter" && handleLogin()}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password" className="text-gray-300 text-base">Password</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="bg-black border-[#28CC95]/30 text-white focus:border-[#28CC95] h-12 pr-10"
                  placeholder="Enter your password"
                  onKeyDown={(e) => e.key === "Enter" && handleLogin()}
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
            </div>

            {error && (
              <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
                {error}
              </div>
            )}

            <Button
              onClick={handleLogin}
              disabled={loggingIn || !email.trim() || !password}
              className="w-full bg-[#28CC95] text-black hover:bg-[#28CC95]/90 font-semibold py-6 rounded-xl"
            >
              {loggingIn ? (
                <>
                  <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                  Logging in...
                </>
              ) : (
                "Login"
              )}
            </Button>

            <div className="text-center text-sm text-gray-400">
              Don't have an account?{" "}
              <Link href="/ngo-signup" className="text-[#28CC95] hover:underline">
                Register your NGO
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
