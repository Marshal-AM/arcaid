"use client";

import { useState } from "react";
import Navbar from "@/components/navbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Search } from "lucide-react";

export default function SearchDisasterPage() {
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function searchForDisaster() {
    setSearching(true);
    setError(null);
    
    try {
      const res = await fetch("/api/admin/search-disaster", {
        method: "POST",
        headers: { "content-type": "application/json" },
      });
      
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error || "Failed to search for disaster");
      }
      
      // Success - show popup
      alert("Disaster identified");
      
      // Optionally redirect to markets page
      window.location.href = "/markets";
    } catch (e: any) {
      const errorMsg = e?.message || "Failed to search for disaster";
      setError(errorMsg);
      alert(`Error: ${errorMsg}`);
    } finally {
      setSearching(false);
    }
  }

  return (
    <div className="min-h-screen text-white pt-24 pb-12 px-4">
      <Navbar />
      
      <div className="max-w-4xl mx-auto">
        <Card className="bg-black border-[#28CC95]/30">
          <CardHeader className="text-center">
            <CardTitle className="text-3xl text-white mb-2">Search for Disaster</CardTitle>
            <CardDescription className="text-gray-400">
              Use AI to automatically identify recent disasters and create prediction markets
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col items-center justify-center py-12">
            {error && (
              <div className="mb-6 p-4 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 w-full max-w-md">
                {error}
              </div>
            )}
            
            <Button
              onClick={searchForDisaster}
              disabled={searching}
              size="lg"
              className="bg-[#28CC95] text-black hover:bg-[#28CC95]/90 h-16 px-8 text-lg font-semibold"
            >
              {searching ? (
                <>
                  <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                  Searching...
                </>
              ) : (
                <>
                  <Search className="h-5 w-5 mr-2" />
                  Search for Disaster
                </>
              )}
            </Button>
            
            <p className="mt-6 text-sm text-gray-400 text-center max-w-md">
              Click the button above to trigger an AI-powered search for recent disasters. 
              The system will automatically create a prediction market for any identified disaster.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
