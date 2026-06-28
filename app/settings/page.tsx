"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { signOut, useSession } from "next-auth/react";
import { api } from "@/lib/api-client";

type Section = "General" | "Reconciliation Rules" | "Notifications" | "Team" | "Danger Zone";

const SECTIONS: Section[] = ["General", "Reconciliation Rules", "Notifications", "Team", "Danger Zone"];

export default function SettingsPage() {
  const { data: session } = useSession();
  const userEmail = session?.user?.email || "your email";

  const [activeSection, setActiveSection] = useState<Section>("General");

  // General State
  const [companyName, setCompanyName] = useState("Acme Corp");
  const [fiscalYear, setFiscalYear] = useState("April");
  const [timezone, setTimezone] = useState("Asia/Kolkata (IST +5:30)");

  // Rules State
  const [amountTolerance, setAmountTolerance] = useState([500]);
  const [dateTolerance, setDateTolerance] = useState([3]);
  const [autoApproveMsg, setAutoApproveMsg] = useState([95]);
  const [flagDup, setFlagDup] = useState(true);
  const [alertUnknown, setAlertUnknown] = useState(true);

  // Notifications State
  const [notifyRun, setNotifyRun] = useState(true);
  const [notifyExceptions, setNotifyExceptions] = useState(true);
  const [notifyDigest, setNotifyDigest] = useState(false);
  const [notifyCfo, setNotifyCfo] = useState(false);
  const [cfoEmail, setCfoEmail] = useState("");

  // Team State
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("Viewer");
  const [inviteOpen, setInviteOpen] = useState(false);

  // Danger Zone State
  const [resetInput, setResetInput] = useState("");
  const [deleteEmailInput, setDeleteEmailInput] = useState("");
  const [resetOpen, setResetOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const handleSave = () => {
    toast.success("Settings saved");
  };

  const handleInvite = () => {
    console.log("Inviting", inviteEmail, "as", inviteRole);
    toast.success("Invite sent successfully");
    setInviteOpen(false);
    setInviteEmail("");
  };

  const handleResetData = async () => {
    try {
      await api.settings.reset();
      toast.success("Data reset successfully");
      window.location.href = "/dashboard";
    } catch (error) {
      console.error(error);
      toast.error("Error resetting data");
    } finally {
      setResetOpen(false);
      setResetInput("");
    }
  };

  const handleDeleteAccount = async () => {
    try {
      await api.settings.deleteAccount();
      toast.success("Account deleted successfully");
      signOut({ callbackUrl: "/login" });
    } catch (error) {
      console.error(error);
      toast.error("Error deleting account");
    } finally {
      setDeleteOpen(false);
      setDeleteEmailInput("");
    }
  };

  return (
    <div className="p-4 sm:p-6 sm:px-8 flex flex-col h-full font-sans text-slate-900 mx-auto w-full max-w-6xl">
      <div className="shrink-0 flex flex-col pt-2 sm:pt-4 mb-8">
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">Settings</h1>
        <p className="text-sm text-slate-500 mt-1 font-medium">
          Manage your account preferences and integration settings.
        </p>
      </div>

      <div className="flex flex-col md:flex-row gap-8 flex-1 items-start">
        {/* Mobile Nav */}
        <div className="md:hidden w-full relative mb-4">
          <select 
            value={activeSection}
            onChange={(e) => setActiveSection(e.target.value as Section)}
            className="w-full appearance-none bg-white border border-slate-200 rounded-md py-2 pl-3 pr-8 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-slate-900"
          >
            {SECTIONS.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <div className="absolute right-3 top-3 pointer-events-none text-slate-500">
            <svg width="15" height="15" viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M4.93179 5.43179C4.75605 5.60753 4.75605 5.89245 4.93179 6.06819L7.43179 8.56819C7.60753 8.74393 7.89245 8.74393 8.06819 8.56819L10.5682 6.06819C10.7439 5.89245 10.7439 5.60753 10.5682 5.43179C10.3924 5.25605 10.1075 5.25605 9.93179 5.43179L7.75 7.61358L5.56819 5.43179C5.39245 5.25605 5.10753 5.25605 4.93179 5.43179Z" fill="currentColor" fillRule="evenodd" clipRule="evenodd"></path>
            </svg>
          </div>
        </div>

        {/* Desktop Nav */}
        <nav className="hidden md:flex flex-col w-[200px] shrink-0 sticky top-6 gap-1">
          {SECTIONS.map((section) => (
            <button
              key={section}
              onClick={() => setActiveSection(section)}
              className={cn(
                "text-left px-3 py-2 text-sm font-medium rounded-md transition-colors",
                activeSection === section 
                  ? "bg-slate-100 text-slate-900" 
                  : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
              )}
            >
              {section}
            </button>
          ))}
        </nav>

        {/* Content Area */}
        <div className="flex-1 max-w-2xl w-full bg-white border border-slate-200 rounded-xl p-6 sm:p-8 shadow-sm">
          
          {activeSection === "General" && (
            <div className="space-y-6 animate-in fade-in">
              <h2 className="text-xl font-bold tracking-tight">General Settings</h2>
              
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="companyName">Company name</Label>
                  <Input 
                    id="companyName" 
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                  />
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="fiscalYear">Fiscal year start</Label>
                  <div className="relative">
                    <select 
                      id="fiscalYear"
                      value={fiscalYear}
                      onChange={(e) => setFiscalYear(e.target.value)}
                      className="flex h-10 w-full appearance-none rounded-md border border-slate-200 bg-white px-3 py-2 text-sm ring-offset-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2"
                    >
                      <option value="April">April</option>
                      <option value="January">January</option>
                      <option value="July">July</option>
                    </select>
                    <div className="absolute right-3 top-3 pointer-events-none text-slate-500">
                      <svg width="15" height="15" viewBox="0 0 15 15" fill="none"><path d="M4.93179 5.43179C4.75605 5.60753 4.75605 5.89245 4.93179 6.06819L7.43179 8.56819C7.60753 8.74393 7.89245 8.74393 8.06819 8.56819L10.5682 6.06819C10.7439 5.89245 10.7439 5.60753 10.5682 5.43179C10.3924 5.25605 10.1075 5.25605 9.93179 5.43179L7.75 7.61358L5.56819 5.43179C5.39245 5.25605 5.10753 5.25605 4.93179 5.43179Z" fill="currentColor" fillRule="evenodd" clipRule="evenodd"></path></svg>
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="currency">Currency <span className="text-slate-400 font-normal ml-1" title="Currency is locked to your plan">(Locked)</span></Label>
                  <div className="relative">
                    <select 
                      id="currency"
                      disabled
                      className="flex h-10 w-full appearance-none rounded-md border border-slate-200 bg-slate-50 text-slate-500 px-3 py-2 text-sm cursor-not-allowed opacity-100"
                    >
                      <option value="INR">INR ₹</option>
                    </select>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="timezone">Timezone</Label>
                  <div className="relative">
                    <select 
                      id="timezone"
                      value={timezone}
                      onChange={(e) => setTimezone(e.target.value)}
                      className="flex h-10 w-full appearance-none rounded-md border border-slate-200 bg-white px-3 py-2 text-sm ring-offset-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2"
                    >
                      <option value="Asia/Kolkata (IST +5:30)">Asia/Kolkata (IST +5:30)</option>
                      <option value="UTC">UTC</option>
                      <option value="America/New_York (EST -5:00)">America/New_York (EST -5:00)</option>
                    </select>
                    <div className="absolute right-3 top-3 pointer-events-none text-slate-500">
                      <svg width="15" height="15" viewBox="0 0 15 15" fill="none"><path d="M4.93179 5.43179C4.75605 5.60753 4.75605 5.89245 4.93179 6.06819L7.43179 8.56819C7.60753 8.74393 7.89245 8.74393 8.06819 8.56819L10.5682 6.06819C10.7439 5.89245 10.7439 5.60753 10.5682 5.43179C10.3924 5.25605 10.1075 5.25605 9.93179 5.43179L7.75 7.61358L5.56819 5.43179C5.39245 5.25605 5.10753 5.25605 4.93179 5.43179Z" fill="currentColor" fillRule="evenodd" clipRule="evenodd"></path></svg>
                    </div>
                  </div>
                </div>
              </div>

              <div className="pt-6 border-t border-slate-100 flex justify-end">
                <Button onClick={handleSave} className="bg-slate-900 text-white hover:bg-slate-800">Save changes</Button>
              </div>
            </div>
          )}

          {activeSection === "Reconciliation Rules" && (
            <div className="space-y-8 animate-in fade-in">
              <h2 className="text-xl font-bold tracking-tight">Reconciliation Rules</h2>
              
              <div className="space-y-8">
                <div className="space-y-4">
                  <div className="flex justify-between items-center mb-1">
                    <Label className="text-base">Amount tolerance</Label>
                    <span className="text-sm font-medium text-slate-600">₹{amountTolerance[0]}</span>
                  </div>
                  <Slider 
                    value={amountTolerance} 
                    onValueChange={setAmountTolerance} 
                    max={2000} 
                    step={50} 
                  />
                  <p className="text-sm text-slate-500">
                    Match transactions within ±₹{amountTolerance[0]} of invoice amount
                  </p>
                </div>

                <div className="space-y-4 pt-4 border-t border-slate-100">
                  <div className="flex justify-between items-center mb-1">
                    <Label className="text-base">Date tolerance</Label>
                    <span className="text-sm font-medium text-slate-600">{dateTolerance[0]} days</span>
                  </div>
                  <Slider 
                    value={dateTolerance} 
                    onValueChange={setDateTolerance} 
                    max={7} 
                    step={1} 
                  />
                  <p className="text-sm text-slate-500">
                    Match transactions within ±{dateTolerance[0]} days of invoice date
                  </p>
                </div>

                <div className="space-y-4 pt-4 border-t border-slate-100">
                  <div className="flex justify-between items-center mb-1">
                    <Label className="text-base">Auto-approve threshold</Label>
                    <span className="text-sm font-medium text-slate-600">{autoApproveMsg[0]}%</span>
                  </div>
                  <Slider 
                    value={autoApproveMsg} 
                    onValueChange={setAutoApproveMsg} 
                    min={80}
                    max={100} 
                    step={1} 
                  />
                  <p className="text-sm text-slate-500">
                    Automatically approve matches above {autoApproveMsg[0]}% confidence
                  </p>
                </div>

                <div className="space-y-4 pt-4 border-t border-slate-100">
                  <div className="flex items-center justify-between">
                    <div>
                      <Label className="text-base">Flag duplicate transactions</Label>
                      <p className="text-sm text-slate-500">Identifies identical amounts within close timeframes</p>
                    </div>
                    <Switch checked={flagDup} onCheckedChange={setFlagDup} />
                  </div>
                  
                  <div className="flex items-center justify-between mt-6">
                    <div>
                      <Label className="text-base">Alert on unknown counterparties</Label>
                      <p className="text-sm text-slate-500">Flags senders not present in your vendor master</p>
                    </div>
                    <Switch checked={alertUnknown} onCheckedChange={setAlertUnknown} />
                  </div>
                </div>
              </div>

              <div className="pt-6 border-t border-slate-100 flex justify-end">
                <Button onClick={handleSave} className="bg-slate-900 text-white hover:bg-slate-800">Save changes</Button>
              </div>
            </div>
          )}

          {activeSection === "Notifications" && (
            <div className="space-y-6 animate-in fade-in">
              <h2 className="text-xl font-bold tracking-tight">Notifications</h2>
              
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <Label className="font-normal text-base text-slate-700">Email me when reconciliation run completes</Label>
                  <Switch checked={notifyRun} onCheckedChange={setNotifyRun} />
                </div>
                
                <div className="flex items-center justify-between">
                  <Label className="font-normal text-base text-slate-700">Email me when exceptions exceed 10% of transactions</Label>
                  <Switch checked={notifyExceptions} onCheckedChange={setNotifyExceptions} />
                </div>
                
                <div className="flex items-center justify-between">
                  <Label className="font-normal text-base text-slate-700">Weekly reconciliation health digest</Label>
                  <Switch checked={notifyDigest} onCheckedChange={setNotifyDigest} />
                </div>
                
                <div className="flex items-center justify-between">
                  <Label className="font-normal text-base text-slate-700">Alert CFO when manual approval needed</Label>
                  <Switch checked={notifyCfo} onCheckedChange={setNotifyCfo} />
                </div>

                <div className="space-y-2 pt-2">
                  <Label htmlFor="cfoEmail" className="text-slate-600">CFO email for alerts</Label>
                  <Input 
                    id="cfoEmail" 
                    placeholder="cfo@acme.com" 
                    value={cfoEmail}
                    onChange={(e) => setCfoEmail(e.target.value)}
                  />
                </div>
              </div>

              <div className="pt-6 border-t border-slate-100 flex justify-end">
                <Button onClick={handleSave} className="bg-slate-900 text-white hover:bg-slate-800">Save changes</Button>
              </div>
            </div>
          )}

          {activeSection === "Team" && (
            <div className="space-y-6 animate-in fade-in">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-bold tracking-tight">Team</h2>
                <Button size="sm" onClick={() => setInviteOpen(true)} className="bg-slate-900 text-white hover:bg-slate-800">Invite team member</Button>
                <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Invite external team member</DialogTitle>
                      <DialogDescription>
                        They will receive an email invitation to join this workspace.
                      </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                      <div className="space-y-2">
                        <Label>Email address</Label>
                        <Input value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} placeholder="colleague@acme.com" />
                      </div>
                      <div className="space-y-2">
                        <Label>Role</Label>
                        <div className="relative">
                          <select 
                            value={inviteRole}
                            onChange={(e) => setInviteRole(e.target.value)}
                            className="flex h-10 w-full appearance-none rounded-md border border-slate-200 bg-white px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900"
                          >
                            <option value="Admin">Admin</option>
                            <option value="Accountant">Accountant</option>
                            <option value="Viewer">Viewer</option>
                          </select>
                          <div className="absolute right-3 top-3 pointer-events-none text-slate-500">
                            <svg width="15" height="15" viewBox="0 0 15 15" fill="none"><path d="M4.93179 5.43179C4.75605 5.60753 4.75605 5.89245 4.93179 6.06819L7.43179 8.56819C7.60753 8.74393 7.89245 8.74393 8.06819 8.56819L10.5682 6.06819C10.7439 5.89245 10.7439 5.60753 10.5682 5.43179C10.3924 5.25605 10.1075 5.25605 9.93179 5.43179L7.75 7.61358L5.56819 5.43179C5.39245 5.25605 5.10753 5.25605 4.93179 5.43179Z" fill="currentColor" fillRule="evenodd" clipRule="evenodd"></path></svg>
                          </div>
                        </div>
                      </div>
                    </div>
                    <DialogFooter>
                      <Button variant="outline" onClick={() => setInviteOpen(false)}>Cancel</Button>
                      <Button onClick={handleInvite} className="bg-slate-900 text-white">Send invite</Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </div>
              
              <div className="border border-slate-200 rounded-lg overflow-hidden">
                <table className="w-full text-sm text-left">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
                    <tr>
                      <th className="px-4 py-3 font-medium">Name</th>
                      <th className="px-4 py-3 font-medium">Email</th>
                      <th className="px-4 py-3 font-medium">Role</th>
                      <th className="px-4 py-3 font-medium text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    <tr className="hover:bg-slate-50/50">
                      <td className="px-4 py-3 font-medium text-slate-900">{session?.user?.name || "John Doe"}</td>
                      <td className="px-4 py-3 text-slate-500">{session?.user?.email || "john@acme.com"}</td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-800">Admin (You)</span>
                      </td>
                      <td className="px-4 py-3 text-right"></td>
                    </tr>
                    <tr className="hover:bg-slate-50/50">
                      <td className="px-4 py-3 font-medium text-slate-900">Priya Sharma</td>
                      <td className="px-4 py-3 text-slate-500">priya@acme.com</td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-50 text-blue-700">Accountant</span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Button variant="ghost" size="sm" className="h-7 text-xs text-red-600 hover:text-red-700 hover:bg-red-50">Remove</Button>
                      </td>
                    </tr>
                    <tr className="hover:bg-slate-50/50">
                      <td className="px-4 py-3 font-medium text-slate-900">Rahul Mehta</td>
                      <td className="px-4 py-3 text-slate-500">rahul@acme.com</td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-600">Viewer</span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Button variant="ghost" size="sm" className="h-7 text-xs text-red-600 hover:text-red-700 hover:bg-red-50">Remove</Button>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeSection === "Danger Zone" && (
            <div className="space-y-6 animate-in fade-in">
              <h2 className="text-xl font-bold tracking-tight text-red-600">Danger Zone</h2>
              
              <div className="border border-red-200 rounded-xl p-6 space-y-6 bg-red-50/30">
                
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div>
                    <h3 className="font-semibold text-slate-900">Reset reconciliation data</h3>
                    <p className="text-sm text-slate-500 mt-1 max-w-sm">
                      Delete all matches and run history. Bank transactions and ledger entries will remain intact.
                    </p>
                  </div>
                  <Button variant="outline" onClick={() => setResetOpen(true)} className="border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700 shrink-0">Reset data</Button>
                  <Dialog open={resetOpen} onOpenChange={setResetOpen}>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Reset reconciliation data?</DialogTitle>
                        <DialogDescription>
                          This will delete all matches and run history. Bank transactions and ledger entries will remain. Type <span className="font-mono font-bold text-slate-900">RESET</span> to confirm.
                        </DialogDescription>
                      </DialogHeader>
                      <div className="py-4">
                        <Input value={resetInput} onChange={e => setResetInput(e.target.value)} placeholder="RESET" className="font-mono" />
                      </div>
                      <DialogFooter>
                        <Button variant="outline" onClick={() => setResetOpen(false)}>Cancel</Button>
                        <Button 
                          onClick={handleResetData} 
                          className="bg-red-600 text-white hover:bg-red-700" 
                          disabled={resetInput !== 'RESET'}
                        >
                          Delete data
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                </div>

                <div className="pt-6 border-t border-red-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div>
                    <h3 className="font-semibold text-slate-900">Delete account</h3>
                    <p className="text-sm text-slate-500 mt-1 max-w-sm">
                      Permanently delete your account and all associated data. This action cannot be undone.
                    </p>
                  </div>
                  <Button variant="outline" onClick={() => setDeleteOpen(true)} className="border-red-600 text-red-600 hover:bg-red-50 hover:text-red-700 shrink-0">Delete account</Button>
                  <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Deactivate and delete account?</DialogTitle>
                        <DialogDescription>
                          This cannot be undone. Type your email (<span className="font-medium text-slate-900">{userEmail}</span>) to confirm.
                        </DialogDescription>
                      </DialogHeader>
                      <div className="py-4">
                        <Input value={deleteEmailInput} onChange={e => setDeleteEmailInput(e.target.value)} placeholder="Email to confirm" />
                      </div>
                      <DialogFooter>
                        <Button variant="outline" onClick={() => setDeleteOpen(false)}>Cancel</Button>
                        <Button 
                          onClick={handleDeleteAccount} 
                          className="bg-red-600 text-white hover:bg-red-700" 
                          disabled={deleteEmailInput !== userEmail}
                        >
                          Delete account
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                </div>

              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
