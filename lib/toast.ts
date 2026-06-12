import { toast as sonnerToast } from 'sonner';

export const toast = {
  matchApproved: (amount: string) => 
    sonnerToast.success(`Match approved — ${amount}`, { duration: 3000 }),
  
  matchRejected: () => 
    sonnerToast('Match rejected', { duration: 2000 }),
  
  bulkApproved: (count: number) => 
    sonnerToast.success(`${count} matches approved`, { duration: 4000 }),
  
  matchFailed: (action: 'approve' | 'reject') => 
    sonnerToast.error(`Failed to ${action} — tap to retry`, {
      duration: 8000,
      action: { label: 'Retry', onClick: () => window.location.reload() }
    }),
  
  stripeConnected: () => 
    sonnerToast.success('Stripe connected — fetching transactions...', { duration: 5000 }),
  
  csvParseError: (filename: string, reason: string) => 
    sonnerToast.error(`Could not read ${filename}: ${reason}`, { duration: 10000 }),
  
  reconComplete: (stats: { matched: number; exceptions: number }) =>
    sonnerToast.success(
      `Run complete — ${stats.matched} matched, ${stats.exceptions} exceptions`, 
      { duration: 6000 }
    ),
  
  networkError: () =>
    sonnerToast.error('Connection lost — changes will sync when you reconnect', {
      duration: Infinity,
      id: 'network-error'
    }),
  
  networkRestored: () => {
    sonnerToast.dismiss('network-error');
    sonnerToast.success('Back online', { duration: 2000 });
  }
};
