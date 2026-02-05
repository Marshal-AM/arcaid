'use client'

import Link from 'next/link'
import Image from 'next/image'
import { usePathname, useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Loader2, Copy, Check } from 'lucide-react'
import { useEffect, useState } from 'react'

type WalletProps = {
  session: {
    traderId: string
    circleWalletId: string
    walletAddress: string
    blockchain: string
  } | null
  balance: string
  checkingBalance: boolean
  onRefreshBalance: () => void
  onConnectWallet: () => void
  connecting: boolean
}

export default function Navbar({ wallet }: { wallet?: WalletProps | null }) {
  const pathname = usePathname()
  const router = useRouter()
  const [ngoLoggedIn, setNgoLoggedIn] = useState(false)
  const [copied, setCopied] = useState(false)

  // Check NGO login state
  useEffect(() => {
    const checkNgoSession = () => {
      const session = localStorage.getItem('ngoSession')
      setNgoLoggedIn(!!session)
    }
    checkNgoSession()
    // Listen for storage changes (in case user logs in/out in another tab)
    window.addEventListener('storage', checkNgoSession)
    return () => window.removeEventListener('storage', checkNgoSession)
  }, [])

  const handleNgoDashboardClick = () => {
    if (ngoLoggedIn) {
      router.push('/ngo/dashboard')
    } else {
      router.push('/ngo-login')
    }
  }

  const handleCopyAddress = async () => {
    if (!wallet?.session?.walletAddress) return
    try {
      await navigator.clipboard.writeText(wallet.session.walletAddress)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy address:', err)
    }
  }

  const formatBalance = (balance: string): string => {
    const num = parseFloat(balance)
    if (isNaN(num)) return '0.00'
    return num.toFixed(2)
  }

  // Don't show navbar on landing page, registration page, and NGO pages
  if (pathname === '/' || pathname === '/ngo-signup' || pathname === '/ngo-login' || pathname?.startsWith('/ngo/')) {
    return null
  }

  const showWallet = pathname === '/markets' && wallet

  return (
    <nav className="fixed top-0 left-0 right-0 z-50">
      {/* Blur backdrop */}
      <div className="absolute inset-0 bg-black/80 backdrop-blur-md"></div>
      
      {/* Navbar content */}
      <div className="relative max-w-6xl mx-auto px-4 py-3">
        <div className="bg-black/90 rounded-full shadow-lg border border-[#28CC95]/20 px-6 py-3 backdrop-blur-sm">
        <div className="flex items-center justify-between">
          {/* Left Side - Logo */}
          <div className="flex items-center">
            <Link 
              href="/" 
              className="flex items-center gap-2 hover:opacity-80 transition-opacity"
            >
              <Image 
                src="/navbar-logo.png" 
                alt="ArcAid" 
                width={120} 
                height={40}
                className="h-8 w-auto"
                priority
              />
            </Link>
          </div>

          {/* Right Side - Wallet Info (only on markets page) or NGO Dashboard */}
          {showWallet ? (
            <div className="flex items-center gap-3">
              {wallet.session ? (
                <>
                  <div className="text-right">
                    <div className="text-xs text-gray-400">Balance</div>
                    <div className="text-sm font-semibold text-[#28CC95]">{formatBalance(wallet.balance)} USDC</div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-gray-400">Wallet</div>
                    <div className="text-sm font-mono text-[#28CC95] flex items-center gap-2">
                      <span>{wallet.session.walletAddress.slice(0, 6)}...{wallet.session.walletAddress.slice(-4)}</span>
                      <button
                        onClick={handleCopyAddress}
                        className="hover:text-[#28CC95]/80 transition-colors p-1"
                        title="Copy wallet address"
                      >
                        {copied ? (
                          <Check className="h-3 w-3 text-[#28CC95]" />
                        ) : (
                          <Copy className="h-3 w-3" />
                        )}
                      </button>
                    </div>
                  </div>
                  <Button
                    onClick={() => window.open("https://faucet.circle.com/", "_blank")}
                    variant="outline"
                    size="sm"
                    className="border-[#28CC95] text-[#28CC95] hover:bg-[#28CC95]/20"
                  >
                    Fund Wallet
                  </Button>
                  <Button
                onClick={handleNgoDashboardClick}
                size="sm"
                className="bg-[#28CC95] text-black hover:bg-[#28CC95]/90 font-semibold"
              >
                NGO Dashboard
                  </Button>
                </>
              ) : (
                <>
                  <Button 
                    onClick={wallet.onConnectWallet} 
                    disabled={wallet.connecting} 
                    size="sm"
                    className="bg-[#28CC95] text-black hover:bg-[#28CC95]/90"
                  >
                    {wallet.connecting ? (
                      <>
                        <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                        Connecting...
                      </>
                    ) : (
                      "Connect Wallet"
                    )}
                  </Button>
                  <Button
                    onClick={handleNgoDashboardClick}
                    size="sm"
                    className="bg-[#28CC95] text-black hover:bg-[#28CC95]/90 font-semibold"
                  >
                    NGO Dashboard
                  </Button>
                </>
              )}
            </div>
          ) : (
            <Button
              onClick={handleNgoDashboardClick}
              size="sm"
              className="bg-[#28CC95] text-black hover:bg-[#28CC95]/90 font-semibold"
            >
              NGO Dashboard
            </Button>
          )}
        </div>
        </div>
      </div>
    </nav>
  )
}
