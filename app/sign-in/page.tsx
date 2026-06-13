"use client"

import { useState } from "react"
import { signIn } from "next-auth/react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Activity } from "lucide-react"

export default function SignInPage() {
  const [googleLoading, setGoogleLoading] = useState(false)

  const handleGoogleSignIn = async () => {
    setGoogleLoading(true)
    await signIn("google", { redirectTo: "/dashboard" })
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4 font-sans">
      <div className="w-full max-w-[420px] flex flex-col items-center gap-8">
        
        {/* Logo */}
        <div className="flex items-center gap-2">
          <div className="w-10 h-10 rounded-xl bg-indigo-600 flex items-center justify-center shadow-lg shadow-indigo-200">
            <Activity className="w-6 h-6 text-white" />
          </div>
          <span className="text-2xl font-bold tracking-tight text-slate-900">ReconFlow</span>
        </div>

        <Card className="w-full shadow-xl shadow-slate-200/50 border-slate-200/60 overflow-hidden bg-white">
          <CardHeader className="text-center pb-8 pt-8">
            <CardTitle className="text-xl font-semibold tracking-tight text-slate-900">Sign in to your account</CardTitle>
            <CardDescription className="text-slate-500 mt-2">
              Sign in using your Google account to access your ReconFlow dashboard.
            </CardDescription>
          </CardHeader>
          
          <CardContent className="space-y-6 pb-8 px-8">
            <div className="space-y-3">
              <Button 
                variant="outline" 
                className="w-full h-12 text-base font-medium flex items-center justify-center gap-3 border-slate-200 hover:bg-slate-50 hover:text-slate-900 relative bg-white"
                onClick={handleGoogleSignIn}
                disabled={googleLoading}
              >
                {googleLoading ? (
                  <span className="text-slate-500">Connecting...</span>
                ) : (
                  <>
                    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                    </svg>
                    Continue with Google
                  </>
                )}
              </Button>
              <p className="text-[13px] text-slate-500 leading-tight text-center">
                Securely syncs live data from your Stripe and QuickBooks accounts.
              </p>
            </div>
          </CardContent>
        </Card>
        
        <p className="text-sm text-slate-400 text-center">
          By signing in, you agree to our Terms of Service and Privacy Policy.
        </p>
      </div>
    </div>
  )
}
