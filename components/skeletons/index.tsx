export function MatchTableSkeleton() {
  return (
    <div className="w-full bg-white border border-slate-200 rounded-sm shadow-sm flex-1 flex flex-col overflow-hidden">
      <div className="grid grid-cols-[1fr_120px_1fr] border-b border-slate-200 bg-slate-50 py-2">
        <div className="px-4" />
        <div className="text-center" />
        <div className="px-4" />
      </div>
      <div className="w-full flex-1 w-full bg-white flex flex-col">
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="flex items-center w-full h-[56px] border-b border-slate-100 last:border-b-0 px-4 animate-pulse pr-4"
          >
            {/* Bank Side */}
            <div className="flex-1 flex flex-col justify-center gap-1.5 py-1">
              <div className="w-[120px] h-2 bg-gray-200 dark:bg-gray-700 rounded-md" />
              <div className="w-[80px] h-2 bg-gray-200 dark:bg-gray-700 rounded-md" />
            </div>

            {/* Match Column */}
            <div className="w-[120px] flex items-center justify-center shrink-0">
              <div className="w-[80px] h-[6px] bg-gray-200 dark:bg-gray-700 rounded-full" />
            </div>

            {/* Ledger Side */}
            <div className="flex-1 flex flex-col justify-center items-end gap-1.5 py-1 text-right">
              <div className="w-[120px] h-2 bg-gray-200 dark:bg-gray-700 rounded-md" />
              <div className="w-[80px] h-2 bg-gray-200 dark:bg-gray-700 rounded-md" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function StatCardSkeleton() {
  return (
    <>
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className="bg-white p-4 border border-slate-200 rounded-sm shadow-sm flex flex-col gap-3 animate-pulse"
        >
          <div className="w-[32px] h-[32px] bg-gray-200 dark:bg-gray-700 rounded-full" />
          <div className="w-[60px] h-2 bg-gray-200 dark:bg-gray-700 rounded-md" />
        </div>
      ))}
    </>
  );
}

export function EvidencePanelSkeleton() {
  return (
    <div className="fixed top-0 right-0 h-full w-full sm:w-[420px] bg-white shadow-2xl z-50 flex flex-col animate-pulse">
      <div className="sticky top-0 z-10 bg-white border-b border-slate-100 px-6 py-4 flex flex-col shrink-0">
        <div className="flex items-center justify-between mb-4">
          <div className="w-24 h-3 bg-gray-200 dark:bg-gray-700 rounded-md" />
          <div className="w-4 h-4 bg-gray-200 dark:bg-gray-700 rounded-md" />
        </div>
        <div className="w-28 h-6 bg-gray-200 dark:bg-gray-700 rounded-full" />
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-8">
        <section>
          <div className="w-24 h-2 bg-gray-200 dark:bg-gray-700 rounded-md mb-3" />
          <div className="p-4 border-l-4 border-gray-200 dark:border-gray-700 rounded-r-md bg-gray-50 flex flex-col gap-2">
            <div className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-md" />
            <div className="w-5/6 h-2 bg-gray-200 dark:bg-gray-700 rounded-md" />
            <div className="w-4/6 h-2 bg-gray-200 dark:bg-gray-700 rounded-md" />
          </div>
          <div className="flex flex-wrap items-center gap-2 mt-3">
            <div className="w-16 h-4 bg-gray-200 dark:bg-gray-700 rounded" />
            <div className="w-16 h-4 bg-gray-200 dark:bg-gray-700 rounded" />
            <div className="w-16 h-4 bg-gray-200 dark:bg-gray-700 rounded" />
          </div>
        </section>

        <section>
          <div className="w-32 h-2 bg-gray-200 dark:bg-gray-700 rounded-md mb-3" />
          <div className="border border-slate-200 rounded-md overflow-hidden bg-slate-50">
            <div className="grid grid-cols-2 border-b border-slate-200 bg-slate-100/50">
              <div className="p-2 w-16 h-2 my-1 bg-gray-200 dark:bg-gray-700 rounded-md ml-2" />
              <div className="p-2 w-16 h-2 my-1 bg-gray-200 dark:bg-gray-700 rounded-md border-l border-slate-200 ml-2" />
            </div>
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="grid grid-cols-2 border-b border-slate-200 last:border-b-0 bg-white">
                <div className="p-3">
                  <div className="w-16 h-2 bg-gray-200 dark:bg-gray-700 rounded-md" />
                </div>
                <div className="p-3 border-l border-slate-200">
                  <div className="w-16 h-2 bg-gray-200 dark:bg-gray-700 rounded-md" />
                </div>
              </div>
            ))}
          </div>
        </section>

        <section>
          <div className="w-36 h-2 bg-gray-200 dark:bg-gray-700 rounded-md mb-3" />
          <div className="space-y-4">
            <div className="flex items-start gap-4">
              <div className="w-1/3">
                <div className="w-12 h-2 bg-gray-200 dark:bg-gray-700 rounded-md" />
              </div>
              <div className="w-2/3">
                <div className="w-24 h-2 bg-gray-200 dark:bg-gray-700 rounded-md" />
              </div>
            </div>
            <div className="flex items-start gap-4">
              <div className="w-1/3">
                <div className="w-12 h-2 bg-gray-200 dark:bg-gray-700 rounded-md" />
              </div>
              <div className="w-2/3">
                <div className="w-24 h-2 bg-gray-200 dark:bg-gray-700 rounded-md" />
              </div>
            </div>
          </div>
        </section>
      </div>

      <div className="sticky bottom-0 bg-white border-t border-slate-100 p-6 shrink-0 mt-auto">
        <div className="flex flex-col gap-3">
          <div className="w-full h-11 bg-gray-200 dark:bg-gray-700 rounded-md" />
          <div className="w-16 h-3 bg-gray-200 dark:bg-gray-700 rounded-md mx-auto" />
        </div>
      </div>
    </div>
  );
}

export function ReconRunSkeleton() {
  return (
    <div className="fixed inset-0 bg-white dark:bg-slate-900 z-50 flex flex-col items-center justify-center p-6 animate-pulse">
      <div className="w-full max-w-md space-y-4 text-center">
        <div className="w-full h-2 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
          <div className="w-full h-full bg-gradient-to-r from-gray-200 via-gray-300 to-gray-200 dark:from-gray-700 dark:via-gray-600 dark:to-gray-700 bg-[length:200%_100%] animate-[pulse_2s_cubic-bezier(0.4,0,0.6,1)_infinite,bg-position_2s_linear_infinite]" />
        </div>
        <p className="text-sm font-medium text-slate-500">Matching transactions...</p>
        <p className="text-xs text-slate-400">Processed 0 of 165 transactions</p>
      </div>
    </div>
  );
}
